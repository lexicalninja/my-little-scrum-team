import * as vscode from 'vscode';

export class WorkspaceFiles {
    private workspaceRoot: vscode.Uri;

    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new Error('No workspace folder is open. Open a folder first.');
        }
        this.workspaceRoot = folders[0].uri;
    }

    uri(...segments: string[]): vscode.Uri {
        return vscode.Uri.joinPath(this.workspaceRoot, ...segments);
    }

    async exists(relativePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(this.uri(relativePath));
            return true;
        } catch {
            return false;
        }
    }

    async readFile(relativePath: string): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(this.uri(relativePath));
        return Buffer.from(bytes).toString('utf-8');
    }

    async readDir(relativePath: string): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(this.uri(relativePath));
        } catch {
            return result;
        }
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File) {
                try {
                    result[name] = await this.readFile(`${relativePath}/${name}`);
                } catch {
                    // skip unreadable files
                }
            }
        }
        return result;
    }

    async readDirRecursive(relativePath: string): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(this.uri(relativePath));
        } catch {
            return result;
        }
        for (const [name, type] of entries) {
            const childPath = `${relativePath}/${name}`;
            if (type === vscode.FileType.File) {
                try {
                    result[childPath] = await this.readFile(childPath);
                } catch {
                    // skip
                }
            } else if (type === vscode.FileType.Directory) {
                const nested = await this.readDirRecursive(childPath);
                Object.assign(result, nested);
            }
        }
        return result;
    }

    async writeFile(relativePath: string, content: string): Promise<void> {
        const parts = relativePath.split('/');
        if (parts.length > 1) {
            await this.createDirectory(parts.slice(0, -1).join('/'));
        }
        await vscode.workspace.fs.writeFile(
            this.uri(relativePath),
            Buffer.from(content, 'utf-8')
        );
    }

    async createDirectory(relativePath: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.uri(relativePath));
    }

    async listFiles(relativePath: string): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.uri(relativePath));
            return entries
                .filter(([, type]) => type === vscode.FileType.File)
                .map(([name]) => name);
        } catch {
            return [];
        }
    }

    async listDirs(relativePath: string): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.uri(relativePath));
            return entries
                .filter(([, type]) => type === vscode.FileType.Directory)
                .map(([name]) => name);
        } catch {
            return [];
        }
    }
}
