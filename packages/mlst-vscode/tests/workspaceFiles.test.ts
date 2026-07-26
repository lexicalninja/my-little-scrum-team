/**
 * WorkspaceFiles reads and writes the user's project.
 *
 * Almost every method swallows errors and returns an empty result, which is the
 * right call for a chat extension — but it means a wrong path produces "no work
 * found" rather than an error. /run branches on exactly those empty results to
 * decide which phase the feature is in, so the difference between "directory is
 * missing" and "directory is empty" drives user-visible behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setWorkspaceRoot } from './mocks/vscode';
import { WorkspaceFiles } from '../src/workspaceFiles';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mlst-ws-'));
    setWorkspaceRoot(root);
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    setWorkspaceRoot(undefined);
});

const write = (rel: string, content: string) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
};

describe('constructor', () => {
    it('throws a actionable error when no folder is open', () => {
        setWorkspaceRoot(undefined);
        expect(() => new WorkspaceFiles()).toThrow(/No workspace folder is open/);
    });

    it('succeeds when a folder is open', () => {
        expect(() => new WorkspaceFiles()).not.toThrow();
    });
});

describe('exists', () => {
    it('is true for a file and for a directory', async () => {
        write('specs/SPEC-1.md', 'x');
        const ws = new WorkspaceFiles();
        expect(await ws.exists('specs/SPEC-1.md')).toBe(true);
        expect(await ws.exists('specs')).toBe(true);
    });

    it('is false for a missing path rather than throwing', async () => {
        expect(await new WorkspaceFiles().exists('nope/missing.md')).toBe(false);
    });
});

describe('readFile', () => {
    it('decodes as utf-8, including non-ASCII', async () => {
        write('notes.md', '# Café — 日本語');
        expect(await new WorkspaceFiles().readFile('notes.md')).toBe('# Café — 日本語');
    });

    it('propagates the error for a missing file', async () => {
        // Unlike the directory readers, readFile does not swallow — callers
        // that want tolerance go through readDir.
        await expect(new WorkspaceFiles().readFile('gone.md')).rejects.toThrow();
    });
});

describe('readDir', () => {
    it('returns filename -> contents for files only', async () => {
        write('specs/a.md', 'A');
        write('specs/b.md', 'B');
        fs.mkdirSync(path.join(root, 'specs', 'nested'));

        const out = await new WorkspaceFiles().readDir('specs');
        expect(out).toEqual({ 'a.md': 'A', 'b.md': 'B' });
        expect(out).not.toHaveProperty('nested');
    });

    it('returns {} for a missing directory instead of throwing', async () => {
        // /run relies on this: a missing specs/ must read as "phase not reached".
        expect(await new WorkspaceFiles().readDir('specs')).toEqual({});
    });

    it('returns {} for an empty directory', async () => {
        fs.mkdirSync(path.join(root, 'specs'));
        expect(await new WorkspaceFiles().readDir('specs')).toEqual({});
    });

    it('is not recursive', async () => {
        write('specs/top.md', 'T');
        write('specs/deep/inner.md', 'I');
        const out = await new WorkspaceFiles().readDir('specs');
        expect(Object.keys(out)).toEqual(['top.md']);
    });
});

describe('readDirRecursive', () => {
    it('walks nested directories and keys by relative path', async () => {
        write('tasks/a.md', 'A');
        write('tasks/sub/b.md', 'B');
        write('tasks/sub/deeper/c.md', 'C');

        expect(await new WorkspaceFiles().readDirRecursive('tasks')).toEqual({
            'tasks/a.md': 'A',
            'tasks/sub/b.md': 'B',
            'tasks/sub/deeper/c.md': 'C',
        });
    });

    it('returns {} for a missing directory', async () => {
        expect(await new WorkspaceFiles().readDirRecursive('tasks')).toEqual({});
    });
});

describe('writeFile', () => {
    it('creates missing parent directories', async () => {
        // Commands write to docs/design/... into a fresh workspace, so this
        // has to work without an explicit mkdir.
        await new WorkspaceFiles().writeFile('docs/design/DESIGN-1.md', 'content');
        expect(fs.readFileSync(path.join(root, 'docs/design/DESIGN-1.md'), 'utf-8')).toBe('content');
    });

    it('writes at the root without a parent path', async () => {
        await new WorkspaceFiles().writeFile('top.md', 'x');
        expect(fs.existsSync(path.join(root, 'top.md'))).toBe(true);
    });

    it('overwrites an existing file', async () => {
        write('a.md', 'old');
        await new WorkspaceFiles().writeFile('a.md', 'new');
        expect(fs.readFileSync(path.join(root, 'a.md'), 'utf-8')).toBe('new');
    });

    it('round-trips through readFile', async () => {
        const ws = new WorkspaceFiles();
        await ws.writeFile('specs/SPEC.md', '# Spec\n\nBody — ünïcode');
        expect(await ws.readFile('specs/SPEC.md')).toBe('# Spec\n\nBody — ünïcode');
    });
});

describe('listFiles / listDirs', () => {
    beforeEach(() => {
        write('mixed/file.md', 'x');
        fs.mkdirSync(path.join(root, 'mixed', 'adir'));
    });

    it('listFiles returns only files', async () => {
        expect(await new WorkspaceFiles().listFiles('mixed')).toEqual(['file.md']);
    });

    it('listDirs returns only directories', async () => {
        expect(await new WorkspaceFiles().listDirs('mixed')).toEqual(['adir']);
    });

    it('both return [] for a missing directory', async () => {
        const ws = new WorkspaceFiles();
        expect(await ws.listFiles('nope')).toEqual([]);
        expect(await ws.listDirs('nope')).toEqual([]);
    });

    it('listFiles drives phase detection in /run', async () => {
        // wsHasFiles() is `listFiles(dir).length > 0`, so an existing but empty
        // decisions/ must still count as "phase not started".
        fs.mkdirSync(path.join(root, 'decisions'));
        expect(await new WorkspaceFiles().listFiles('decisions')).toEqual([]);
    });
});
