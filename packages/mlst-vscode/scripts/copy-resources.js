/**
 * Stage the resources the extension reads at runtime into ./resources.
 *
 * A VS Code extension can only read files inside its own directory, so the
 * shared agents, skills, templates and commands have to be copied in at build
 * time rather than resolved from the repo root the way the other packages do.
 * `resources/` is generated and gitignored — the repo root stays the single
 * source of truth.
 *
 * Package-local agents are overlaid on top of the shared ones. `team-lead`
 * lives here rather than in the root `agents/` because it orchestrates through
 * this extension's slash commands, which only exist in Copilot Chat.
 */
const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const RESOURCES_ROOT = path.join(PACKAGE_ROOT, 'resources');

/** Shared resources, copied from the repo root. */
const SHARED = ['agents', 'skills', 'templates', 'commands'];

/** Package-local directories overlaid after the shared copy. */
const OVERLAY = ['agents'];

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

fs.rmSync(RESOURCES_ROOT, { recursive: true, force: true });
fs.mkdirSync(RESOURCES_ROOT, { recursive: true });

let failed = false;

for (const name of SHARED) {
    const src = path.join(REPO_ROOT, name);
    if (!fs.existsSync(src)) {
        console.error(`✗ Missing shared resource directory: ${src}`);
        failed = true;
        continue;
    }
    copyRecursive(src, path.join(RESOURCES_ROOT, name));
    const count = fs.readdirSync(path.join(RESOURCES_ROOT, name)).length;
    console.log(`✓ ${name} → resources/${name} (${count})`);
}

for (const name of OVERLAY) {
    const src = path.join(PACKAGE_ROOT, name);
    if (!fs.existsSync(src)) continue;
    const files = fs.readdirSync(src);
    if (files.length === 0) continue;
    copyRecursive(src, path.join(RESOURCES_ROOT, name));
    console.log(`✓ overlaid ${files.length} local ${name}: ${files.join(', ')}`);
}

if (failed) {
    console.error('✗ Resource staging failed.');
    process.exit(1);
}

console.log('✓ Resources staged.');
