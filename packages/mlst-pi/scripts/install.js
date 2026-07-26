#!/usr/bin/env node
/**
 * MLST Pi Extension installer.
 *
 * Installs the runtime into ~/.pi/agent/extensions/mlst so the extension,
 * its prompts, and its native dependencies stay self-contained.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_NAME = "mlst";
const MLST_DEPENDENCY = "better-sqlite3";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const extensionSource = join(pluginRoot, ".pi", "extensions", EXTENSION_NAME);
const installMode = readInstallMode(process.argv);
const piHome = getPiHome();
const extensionTarget = join(piHome, "agent", "extensions", EXTENSION_NAME);

if (installMode === "uninstall") {
  uninstallExtension(extensionTarget);
  process.exit(0);
}

installExtension();

function installExtension() {
  ensureDirectory(join(piHome, "agent", "extensions"));
  resetDirectory(extensionTarget);

  copyDirectory(extensionSource, extensionTarget);
  copyResourceDirectory("agents");
  copyResourceDirectory("skills");
  copyResourceDirectory("templates");
  installRuntimeDependencies(extensionTarget);

  console.log(`MLST extension installed at ${extensionTarget}`);
  console.log("Commands: /build, /mlst-status");
}

function uninstallExtension(targetDir) {
  if (!existsSync(targetDir)) {
    console.log("MLST extension is not installed.");
    return;
  }

  rmSync(targetDir, { recursive: true, force: true });
  console.log("MLST extension uninstalled.");
}

/**
 * Copy a resource directory into the installed extension so it stays
 * self-contained.
 *
 * Resources live in one of two places: pi-specific ones (`agents/`) sit in this
 * package, while `skills/` and `templates/` are shared with the Claude Code
 * plugin and the CLI at the repo root. Mirrors the resolution order in
 * `.pi/extensions/mlst/index.ts`.
 */
function copyResourceDirectory(name) {
  const repoRoot = resolve(pluginRoot, "..", "..");
  const sourceDir = [join(pluginRoot, name), join(repoRoot, name)].find(existsSync);

  if (!sourceDir) {
    console.warn(`Skipping ${name}/ — not found in package or repo root.`);
    return;
  }

  copyDirectory(sourceDir, join(extensionTarget, name));
}

function installRuntimeDependencies(targetDir) {
  writeRuntimePackageJson(targetDir);
  console.log("Installing runtime dependencies...");
  execFileSync("npm", ["install", "--omit=dev"], {
    cwd: targetDir,
    stdio: "inherit",
  });

  // Ensure the native addon is compiled. prebuild-install may not find a
  // prebuilt binary for the current Node.js version, in which case the .node
  // file is simply absent. Fall back to node-gyp to build from source.
  const bindingPath = join(targetDir, "node_modules", MLST_DEPENDENCY, "build", "Release", `${MLST_DEPENDENCY.replace(/-/g, "_")}.node`);
  if (!existsSync(bindingPath)) {
    console.log(`No prebuilt binary found for ${MLST_DEPENDENCY}, building from source...`);
    execFileSync("node-gyp", ["rebuild"], {
      cwd: join(targetDir, "node_modules", MLST_DEPENDENCY),
      stdio: "inherit",
    });
  }
}

function writeRuntimePackageJson(targetDir) {
  const packageJsonPath = join(targetDir, "package.json");
  const dependencyVersion = readDependencyVersion(MLST_DEPENDENCY) ?? "^11.0.0";

  writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name: "@lexicalninja/mlst-pi-runtime",
        private: true,
        type: "module",
        dependencies: {
          [MLST_DEPENDENCY]: dependencyVersion,
        },
      },
      null,
      2,
    ),
  );
}

function readDependencyVersion(name) {
  const packageJsonPath = join(pluginRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson?.dependencies?.[name] ?? null;
  } catch {
    return null;
  }
}

function copyDirectory(sourceDir, targetDir) {
  ensureDirectory(dirname(targetDir));
  cpSync(sourceDir, targetDir, { recursive: true });
}

function resetDirectory(dir) {
  rmSync(dir, { recursive: true, force: true });
  ensureDirectory(dir);
}

function ensureDirectory(dir) {
  mkdirSync(dir, { recursive: true });
}

function getPiHome() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set. Cannot determine ~/.pi path.");
  }

  return join(home, ".pi");
}

function readInstallMode(argv) {
  return argv.includes("--uninstall") ? "uninstall" : "install";
}
