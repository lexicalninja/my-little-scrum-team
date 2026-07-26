import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecutionProfile } from "./types.js";

export interface ProviderOverride {
  concurrency?: number;
  spawnDelayMs?: number;
}

export interface ModelRoutingConfig {
  default?: string;
  build?: string;
  prd?: string;
  coding?: string;
  planning?: string;
  scrumMaster?: string;
  review?: string;
  tests?: string;
  agents?: Record<string, string>;
}

export interface ProjectConfig {
  mode?: string;
  executionProfile?: Partial<ExecutionProfile> & { name?: string };
  providers?: Record<string, ProviderOverride>;
  models?: ModelRoutingConfig;
  /** Top-level humanGates override (merged into the execution profile). */
  humanGates?: string[];
  /** Top-level pipelineMode override (merged into the execution profile). */
  pipelineMode?: string;
}

type AgentModelRole = "coding" | "planning" | "scrumMaster" | "review" | "tests";
type LlmPurpose = "build" | "prd";

const AGENT_MODEL_ROLES: Record<string, AgentModelRole> = {
  "mls-impl-engineer": "coding",
  "mls-infra-engineer": "coding",
  "mls-designer": "coding",
  "mls-spec-writer": "planning",
  "mls-scrum-master": "scrumMaster",
  "mls-code-reviewer": "review",
  "mls-test-runner": "tests",
};

/**
 * Read and parse a single config file. Returns `{}` if the file
 * does not exist or contains invalid JSON.
 */
export function loadConfigFile(configPath: string): ProjectConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Deep-merge two configs. `project` values override `global` values.
 * Nested objects (`models`, `models.agents`, `providers`, `executionProfile`)
 * are merged key-by-key; scalars are replaced outright.
 */
export function mergeConfigs(global: ProjectConfig, project: ProjectConfig): ProjectConfig {
  const merged: ProjectConfig = { ...global, ...project };

  if (global.models || project.models) {
    const gm = global.models ?? {};
    const pm = project.models ?? {};
    merged.models = { ...gm, ...pm };

    if (gm.agents || pm.agents) {
      merged.models.agents = { ...gm.agents, ...pm.agents };
    }
  }

  if (global.providers || project.providers) {
    const gp = global.providers ?? {};
    const pp = project.providers ?? {};
    merged.providers = { ...gp };
    for (const [key, value] of Object.entries(pp)) {
      merged.providers[key] = { ...gp[key], ...value };
    }
  }

  if (global.executionProfile || project.executionProfile) {
    merged.executionProfile = {
      ...global.executionProfile,
      ...project.executionProfile,
    };
  }

  return merged;
}

/**
 * Load MLS configuration by merging global (`~/.mls/config.json`) and
 * project-local (`<cwd>/.mls/config.json`) settings. Project values
 * override global values. Nested objects are merged key-by-key.
 *
 * @param cwd     - Project working directory for the local config.
 * @param homeDir - Home directory override (defaults to `os.homedir()`). Used for testing.
 */
export function loadProjectConfig(cwd: string, homeDir?: string): ProjectConfig {
  const home = homeDir ?? os.homedir();
  const globalConfig = loadConfigFile(path.join(home, ".mls", "config.json"));
  const projectConfig = loadConfigFile(path.join(cwd, ".mls", "config.json"));
  return mergeConfigs(globalConfig, projectConfig);
}

export function resolveAgentModel(
  agentName: string,
  frontmatterModel?: string,
  parentModel?: string,
  models?: ModelRoutingConfig,
): string | undefined {
  const exactMatch = models?.agents?.[agentName];
  if (exactMatch) {
    return exactMatch;
  }

  const role = AGENT_MODEL_ROLES[agentName];
  if (role) {
    const roleModel = getRoleModel(models, role);
    if (roleModel) {
      return roleModel;
    }
  }

  return frontmatterModel || parentModel;
}

export function resolveLlmModel(
  purpose: LlmPurpose,
  sessionModel?: string,
  models?: ModelRoutingConfig,
): string | undefined {
  if (purpose === "build") {
    return models?.build || models?.planning || models?.default || sessionModel;
  }

  return models?.prd || models?.planning || models?.default || sessionModel;
}

function getRoleModel(models: ModelRoutingConfig | undefined, role: AgentModelRole): string | undefined {
  switch (role) {
    case "coding":
      return models?.coding || models?.default;
    case "planning":
      return models?.planning || models?.default;
    case "scrumMaster":
      return models?.scrumMaster || models?.default;
    case "review":
      return models?.review || models?.default;
    case "tests":
      return models?.tests || models?.default;
  }
}