/**
 * ResourceLoader reads the staged resources/ directory.
 *
 * It caches by path and never invalidates, which is correct for an extension
 * whose resources are frozen at package time — but it means a cache keyed
 * incorrectly would serve one agent's prompt in place of another's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Uri } from './mocks/vscode';
import { ResourceLoader } from '../src/resourceLoader';

let extRoot: string;

/** Lay out a fake extension directory with a resources/ tree inside it. */
function stage(files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
        const p = path.join(extRoot, 'resources', rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
    }
}

const loader = () => new ResourceLoader(Uri.file(extRoot) as never);

beforeEach(() => {
    extRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mlst-ext-'));
});

afterEach(() => {
    fs.rmSync(extRoot, { recursive: true, force: true });
});

describe('path construction', () => {
    it('reads agents from resources/agents/<name>.md', async () => {
        stage({ 'agents/scrum-master.md': 'SCRUM' });
        expect(await loader().getAgent('scrum-master')).toBe('SCRUM');
    });

    it('reads skills from resources/skills/<name>/SKILL.md', async () => {
        stage({ 'skills/bug-detector/SKILL.md': 'BUG' });
        expect(await loader().getSkill('bug-detector')).toBe('BUG');
    });

    it('reads templates from resources/templates/<name>.md', async () => {
        stage({ 'templates/specification.md': 'TPL' });
        expect(await loader().getTemplate('specification')).toBe('TPL');
    });

    it('reads commands from resources/commands/<name>.md', async () => {
        stage({ 'commands/convert-to-extension.md': 'CMD' });
        expect(await loader().getCommand('convert-to-extension')).toBe('CMD');
    });
});

describe('missing resources', () => {
    it('rejects rather than returning empty content', async () => {
        // This is the failure users saw when team-lead.md was absent: the
        // command throws instead of degrading, so the error is loud.
        await expect(loader().getAgent('team-lead')).rejects.toThrow();
    });

    it('rejects for a skill directory with no SKILL.md', async () => {
        fs.mkdirSync(path.join(extRoot, 'resources', 'skills', 'hollow'), { recursive: true });
        await expect(loader().getSkill('hollow')).rejects.toThrow();
    });
});

describe('caching', () => {
    it('serves the cached copy after the file changes on disk', async () => {
        stage({ 'agents/scrum-master.md': 'FIRST' });
        const l = loader();
        expect(await l.getAgent('scrum-master')).toBe('FIRST');

        fs.writeFileSync(path.join(extRoot, 'resources', 'agents', 'scrum-master.md'), 'SECOND');
        expect(await l.getAgent('scrum-master')).toBe('FIRST');
    });

    it('keys the cache per resource kind and name', async () => {
        // A cache keyed only on the last segment would collide here: an agent
        // and a command that share a name.
        stage({
            'agents/convert-to-extension.md': 'AGENT',
            'commands/convert-to-extension.md': 'COMMAND',
        });
        const l = loader();
        expect(await l.getAgent('convert-to-extension' as never)).toBe('AGENT');
        expect(await l.getCommand('convert-to-extension')).toBe('COMMAND');
    });

    it('does not leak between loader instances', async () => {
        stage({ 'agents/scrum-master.md': 'FIRST' });
        expect(await loader().getAgent('scrum-master')).toBe('FIRST');

        fs.writeFileSync(path.join(extRoot, 'resources', 'agents', 'scrum-master.md'), 'SECOND');
        expect(await loader().getAgent('scrum-master')).toBe('SECOND');
    });
});

describe('bulk accessors', () => {
    const ALL = [
        'code-reviewer-feedback', 'implementation-engineer', 'infrastructure-engineer',
        'scrum-master', 'specification-writer', 'team-lead', 'test-runner', 'ui-ux-designer',
    ];

    it('getAllAgents returns every declared agent', async () => {
        stage(Object.fromEntries(ALL.map((n) => [`agents/${n}.md`, n.toUpperCase()])));
        const all = await loader().getAllAgents();
        expect(Object.keys(all).sort()).toEqual([...ALL].sort());
        expect(all['scrum-master']).toBe('SCRUM-MASTER');
    });

    it('getAllAgents rejects if a single declared agent is missing', async () => {
        // The exact shipped bug: participant.ts asks for the full roster, so one
        // absent file breaks every general question, not just /run.
        stage(Object.fromEntries(
            ALL.filter((n) => n !== 'team-lead').map((n) => [`agents/${n}.md`, n]),
        ));
        await expect(loader().getAllAgents()).rejects.toThrow();
    });

    it('getCoreAgents returns the six execution-path agents', async () => {
        stage(Object.fromEntries(ALL.map((n) => [`agents/${n}.md`, n])));
        const core = await loader().getCoreAgents();
        expect(Object.keys(core).sort()).toEqual([
            'code-reviewer-feedback', 'implementation-engineer', 'scrum-master',
            'specification-writer', 'team-lead', 'test-runner',
        ]);
        // ui-ux-designer and infrastructure-engineer are opt-in, not core.
        expect(core).not.toHaveProperty('ui-ux-designer');
        expect(core).not.toHaveProperty('infrastructure-engineer');
    });
});
