/**
 * Resource integrity.
 *
 * The extension resolves agents, skills, templates and commands by name at
 * runtime, from a `resources/` directory staged at build time. Nothing in the
 * type system connects a `getSkill('bug-detector')` call to a file on disk, so
 * a rename or a missing file surfaces as a thrown FileSystemError in the user's
 * chat window rather than a build failure.
 *
 * This shipped broken once: `team-lead` was declared in AGENT_NAMES and
 * required by /run, /convert-to-extension and the general-question path, but no
 * team-lead.md existed anywhere. These tests read the real call sites out of
 * src/ and assert each one resolves.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const RESOURCES = path.join(PACKAGE_ROOT, 'resources');

/** Concatenated source of every TypeScript file under src/. */
function readAllSource(): string {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.ts')) out.push(fs.readFileSync(p, 'utf-8'));
        }
    };
    walk(path.join(PACKAGE_ROOT, 'src'));
    return out.join('\n');
}

const source = readAllSource();

/** Names passed to a `getX('name')` call anywhere in src/. */
function callSites(method: string): string[] {
    const re = new RegExp(`get${method}\\('([^']+)'\\)`, 'g');
    return [...new Set([...source.matchAll(re)].map((m) => m[1]))].sort();
}

/** String literals from a `const NAME = [...] as const` declaration. */
function declaredNames(constName: string): string[] {
    const block = new RegExp(`${constName}\\s*=\\s*\\[(.*?)\\]`, 's').exec(source);
    if (!block) throw new Error(`${constName} not found in src/`);
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

beforeAll(() => {
    // Stage resources so the suite tests the real build output, not a stale copy.
    execFileSync('node', [path.join(PACKAGE_ROOT, 'scripts', 'copy-resources.js')], {
        cwd: PACKAGE_ROOT,
        stdio: 'pipe',
    });
});

describe('resource staging', () => {
    it('creates every directory the loader reads from', () => {
        for (const dir of ['agents', 'skills', 'templates', 'commands']) {
            expect(fs.existsSync(path.join(RESOURCES, dir)), `resources/${dir}`).toBe(true);
        }
    });

    it('copies the shared resources from the repo root, not a stale local copy', () => {
        const rootSkills = fs.readdirSync(path.join(REPO_ROOT, 'skills')).sort();
        const staged = fs.readdirSync(path.join(RESOURCES, 'skills')).sort();
        expect(staged).toEqual(rootSkills);
    });

    it('overlays package-local agents on top of the shared ones', () => {
        const rootAgents = fs.readdirSync(path.join(REPO_ROOT, 'agents'));
        const localAgents = fs.readdirSync(path.join(PACKAGE_ROOT, 'agents'));
        const staged = fs.readdirSync(path.join(RESOURCES, 'agents'));

        for (const a of [...rootAgents, ...localAgents]) {
            expect(staged, `${a} should be staged`).toContain(a);
        }
    });

    it('stages team-lead, which exists only in this package', () => {
        // team-lead orchestrates via this extension's slash commands, so it is
        // deliberately not in the shared root agents/.
        expect(fs.existsSync(path.join(REPO_ROOT, 'agents', 'team-lead.md'))).toBe(false);
        expect(fs.existsSync(path.join(RESOURCES, 'agents', 'team-lead.md'))).toBe(true);
    });

    it('is reproducible — re-running replaces rather than accumulates', () => {
        const stray = path.join(RESOURCES, 'agents', 'stray-agent.md');
        fs.writeFileSync(stray, '# leftover from a previous build');
        execFileSync('node', [path.join(PACKAGE_ROOT, 'scripts', 'copy-resources.js')], {
            cwd: PACKAGE_ROOT,
            stdio: 'pipe',
        });
        expect(fs.existsSync(stray)).toBe(false);
    });
});

describe('every resource referenced by src/ resolves', () => {
    it('agents', () => {
        const names = callSites('Agent');
        expect(names.length).toBeGreaterThan(0);
        const missing = names.filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'agents', `${n}.md`)),
        );
        expect(missing, 'getAgent() names with no staged file').toEqual([]);
    });

    it('skills', () => {
        const names = callSites('Skill');
        expect(names.length).toBeGreaterThan(0);
        const missing = names.filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'skills', n, 'SKILL.md')),
        );
        expect(missing, 'getSkill() names with no staged SKILL.md').toEqual([]);
    });

    it('commands', () => {
        const missing = callSites('Command').filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'commands', `${n}.md`)),
        );
        expect(missing, 'getCommand() names with no staged file').toEqual([]);
    });

    it('templates', () => {
        const missing = callSites('Template').filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'templates', `${n}.md`)),
        );
        expect(missing, 'getTemplate() names with no staged file').toEqual([]);
    });
});

describe('declared name unions match disk', () => {
    // getAllAgents() iterates AGENT_NAMES, so a single missing entry throws for
    // callers that never asked for that agent by name.
    it('AGENT_NAMES all exist', () => {
        const names = declaredNames('AGENT_NAMES');
        const missing = names.filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'agents', `${n}.md`)),
        );
        expect(missing).toEqual([]);
    });

    it('TEMPLATE_NAMES all exist', () => {
        const names = declaredNames('TEMPLATE_NAMES');
        const missing = names.filter(
            (n) => !fs.existsSync(path.join(RESOURCES, 'templates', `${n}.md`)),
        );
        expect(missing).toEqual([]);
    });

    it('AGENT_NAMES covers every agent actually requested', () => {
        const declared = new Set(declaredNames('AGENT_NAMES'));
        const undeclared = callSites('Agent').filter((n) => !declared.has(n));
        expect(undeclared, 'getAgent() called with a name outside AgentName').toEqual([]);
    });
});

describe('staged content is well formed', () => {
    it('every skill has name and description frontmatter', () => {
        const bad: string[] = [];
        for (const dir of fs.readdirSync(path.join(RESOURCES, 'skills'))) {
            const f = path.join(RESOURCES, 'skills', dir, 'SKILL.md');
            if (!fs.existsSync(f)) {
                bad.push(`${dir} (no SKILL.md)`);
                continue;
            }
            const head = fs.readFileSync(f, 'utf-8').split('\n').slice(0, 8).join('\n');
            if (!/^name:/m.test(head)) bad.push(`${dir} (no name:)`);
            if (!/^description:/m.test(head)) bad.push(`${dir} (no description:)`);
        }
        expect(bad).toEqual([]);
    });

    it('every staged agent is non-empty', () => {
        const empty = fs
            .readdirSync(path.join(RESOURCES, 'agents'))
            .filter((f) => fs.readFileSync(path.join(RESOURCES, 'agents', f), 'utf-8').trim().length === 0);
        expect(empty).toEqual([]);
    });
});
