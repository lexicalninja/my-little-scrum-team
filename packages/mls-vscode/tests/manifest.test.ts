/**
 * package.json and the code that backs it.
 *
 * VS Code builds the `@mls /command` menu from `contributes`, but the switch in
 * participant.ts is what actually runs. Nothing checks the two agree: a command
 * declared and not routed appears in the UI and silently falls through to the
 * general handler, and a command routed but not declared is unreachable.
 *
 * Also guards the packaging manifest — resources/ must ship in the .vsix or the
 * extension throws on first use.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const participantSrc = fs.readFileSync(path.join(ROOT, 'src', 'participant.ts'), 'utf-8');

const declared: string[] = pkg.contributes.chatParticipants[0].commands.map(
    (c: { name: string }) => c.name,
);
const routed = [...participantSrc.matchAll(/case '([a-zA-Z-]+)':/g)].map((m) => m[1]);

describe('command wiring', () => {
    it('declares at least the documented workflow commands', () => {
        for (const c of ['run', 'refine', 'spec', 'tasks', 'implement', 'design', 'review', 'test']) {
            expect(declared, `${c} should be declared`).toContain(c);
        }
    });

    it('routes every declared command', () => {
        expect(declared.filter((c) => !routed.includes(c))).toEqual([]);
    });

    it('declares every routed command', () => {
        expect(routed.filter((c) => !declared.includes(c))).toEqual([]);
    });

    it('imports a handler for every routed command', () => {
        const imported = [...participantSrc.matchAll(/import \{ (handle\w+) \}/g)].map((m) => m[1]);
        expect(imported.length).toBeGreaterThanOrEqual(routed.length);
        for (const h of imported) {
            expect(participantSrc, `${h} imported but never called`).toContain(`${h}(`);
        }
    });

    it('has no duplicate command names', () => {
        expect(new Set(declared).size).toBe(declared.length);
    });
});

describe('command handler files exist', () => {
    // participant.ts imports these by path; a rename breaks the build, but a
    // handler file that was never created fails only when the command is used.
    it('every import from ./commands/ resolves to a file', () => {
        const paths = [...participantSrc.matchAll(/from '\.\/commands\/([\w-]+)'/g)].map((m) => m[1]);
        expect(paths.length).toBeGreaterThan(0);
        const missing = paths.filter(
            (p) => !fs.existsSync(path.join(ROOT, 'src', 'commands', `${p}.ts`)),
        );
        expect(missing).toEqual([]);
    });
});

describe('packaging manifest', () => {
    const vscodeignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf-8');
    const ignored = vscodeignore
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

    it('does not exclude resources/, which is read at runtime', () => {
        // resources/ is gitignored (it is generated) but must be in the .vsix.
        expect(ignored.some((l) => l.startsWith('resources'))).toBe(false);
    });

    it('excludes the source overlay so it is not duplicated in the package', () => {
        expect(ignored).toContain('agents/**');
    });

    it('excludes src/ and scripts/ from the package', () => {
        expect(ignored).toContain('src/**');
        expect(ignored).toContain('scripts/**');
    });

    it('points main at the compiled entry the build produces', () => {
        expect(pkg.main).toBe('./out/extension.js');
        expect(pkg.main.replace('./out/', '').replace('.js', '')).toBe('extension');
        expect(fs.existsSync(path.join(ROOT, 'src', 'extension.ts'))).toBe(true);
    });

    it('compiles before publishing, and stages resources before compiling', () => {
        expect(pkg.scripts['vscode:prepublish']).toContain('compile');
        expect(pkg.scripts.compile).toContain('prebuild');
        expect(pkg.scripts.prebuild).toContain('copy-resources');
    });

    it('declares an engine range and a chat participant id', () => {
        expect(pkg.engines.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
        expect(pkg.contributes.chatParticipants[0].id).toBe('my-little-scrum-team.participant');
    });

    it('is marked private so it cannot be npm-published by accident', () => {
        expect(pkg.private).toBe(true);
    });
});
