import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// .mts rather than .ts: the package is CommonJS (as a VS Code extension must
// be), so a .ts config gets require()d and fails on vitest's ESM-only deps.
const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        globals: false,
        alias: {
            // The real `vscode` module is only injected by the editor host, so
            // importing src/ outside VS Code fails to resolve. Point it at the
            // mock in tests/mocks/vscode.ts.
            vscode: fileURLToPath(new URL('tests/mocks/vscode.ts', import.meta.url)),
        },
        root: here,
    },
});
