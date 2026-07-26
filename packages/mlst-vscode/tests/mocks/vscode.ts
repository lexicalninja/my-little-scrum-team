/**
 * Minimal stand-in for the `vscode` module.
 *
 * The real module only exists inside the editor host, so vitest aliases
 * `vscode` to this file (see vitest.config.ts). The filesystem surface is
 * backed by real `node:fs` against a temp directory rather than an in-memory
 * fake, so directory recursion, missing-path errors and encoding behave the way
 * they do in production.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class Uri {
    private constructor(public readonly fsPath: string) {}

    static file(p: string): Uri {
        return new Uri(p);
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
        return new Uri(path.join(base.fsPath, ...segments));
    }

    get path(): string {
        return this.fsPath;
    }

    toString(): string {
        return this.fsPath;
    }
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

/** Mirrors vscode.FileSystemError closely enough for catch-based control flow. */
export class FileSystemError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileSystemError';
    }
}

const fileSystem = {
    async readFile(uri: Uri): Promise<Uint8Array> {
        try {
            return new Uint8Array(fs.readFileSync(uri.fsPath));
        } catch {
            throw new FileSystemError(`File not found: ${uri.fsPath}`);
        }
    },

    async stat(uri: Uri): Promise<{ type: FileType; size: number }> {
        try {
            const s = fs.statSync(uri.fsPath);
            return {
                type: s.isDirectory() ? FileType.Directory : FileType.File,
                size: s.size,
            };
        } catch {
            throw new FileSystemError(`Not found: ${uri.fsPath}`);
        }
    },

    async readDirectory(uri: Uri): Promise<[string, FileType][]> {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
        } catch {
            throw new FileSystemError(`Not a directory: ${uri.fsPath}`);
        }
        return entries.map((e) => [
            e.name,
            e.isDirectory() ? FileType.Directory : FileType.File,
        ]);
    },

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        fs.writeFileSync(uri.fsPath, content);
    },

    async createDirectory(uri: Uri): Promise<void> {
        fs.mkdirSync(uri.fsPath, { recursive: true });
    },
};

export const workspace = {
    workspaceFolders: undefined as { uri: Uri }[] | undefined,
    fs: fileSystem,
};

/** Point the mock workspace at a directory; pass undefined for "no folder open". */
export function setWorkspaceRoot(root: string | undefined): void {
    workspace.workspaceFolders = root ? [{ uri: Uri.file(root) }] : undefined;
}

export class LanguageModelChatMessage {
    private constructor(
        public readonly role: string,
        public readonly content: string,
    ) {}

    static User(content: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage('user', content);
    }
}

export const lm = {
    /** Overwrite in a test to control model selection. */
    selectChatModels: async (): Promise<unknown[]> => [],
};

export class ThemeIcon {
    constructor(public readonly id: string) {}
}

export const chat = {
    createChatParticipant: (id: string, handler: unknown) => ({
        id,
        handler,
        iconPath: undefined as unknown,
        dispose() {},
    }),
};
