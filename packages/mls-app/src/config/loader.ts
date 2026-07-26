/**
 * Config loader — merges CLI flags + env + project config + global config.
 * Priority: CLI flags > env vars > project config > global config > defaults
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { MLSConfigSchema, type MLSConfig } from './schema.js';

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export interface ConfigSources {
  cliFlags?: Record<string, unknown>;
  envOverrides?: Record<string, string>;
  projectDir?: string;
}

export async function loadConfig(sources: ConfigSources = {}): Promise<MLSConfig> {
  const { cliFlags = {}, projectDir = process.cwd() } = sources;

  // 1. Global config (~/.mls/config.json)
  const globalConfig = await readJsonFile(join(homedir(), '.mls', 'config.json'));

  // 2. Project config (.mls/config.json)
  const projectConfig = await readJsonFile(resolve(projectDir, '.mls', 'config.json'));

  // 3. Env-specified config file
  const envConfigPath = process.env.MLS_CONFIG_PATH;
  const envFileConfig = envConfigPath ? await readJsonFile(envConfigPath) : null;

  // 4. Env var overrides
  const envOverrides: Record<string, unknown> = {};
  if (process.env.GITHUB_TOKEN) {
    envOverrides.api = { token: process.env.GITHUB_TOKEN };
  }
  if (process.env.GITHUB_MODELS_BASE_URL) {
    envOverrides.api = {
      ...(envOverrides.api as Record<string, unknown> ?? {}),
      baseURL: process.env.GITHUB_MODELS_BASE_URL,
    };
  }

  // Merge: global < project < env file < env vars < CLI flags
  const merged = {
    ...(globalConfig ?? {}),
    ...(projectConfig ?? {}),
    ...(envFileConfig ?? {}),
    ...envOverrides,
    ...cliFlags,
  };

  // Deep merge models
  if (globalConfig?.models || projectConfig?.models || cliFlags?.models) {
    merged.models = {
      ...(globalConfig?.models as Record<string, string> ?? {}),
      ...(projectConfig?.models as Record<string, string> ?? {}),
      ...(envFileConfig?.models as Record<string, string> ?? {}),
      ...(cliFlags.models as Record<string, string> ?? {}),
    };
  }

  return MLSConfigSchema.parse(merged);
}
