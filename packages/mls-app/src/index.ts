/**
 * Public API for @lexicalninja/mls
 *
 * Usage:
 *   import { OrchestrationEngine, loadConfig } from '@lexicalninja/mls';
 */

// Core engine
export { OrchestrationEngine, type BuildOptions } from './orchestrator/engine.js';

// Config
export { loadConfig } from './config/loader.js';
export { MLSConfigSchema, type MLSConfig, getDefaultConfig } from './config/schema.js';

// State types
export type {
  BuildState,
  BuildResult,
  BuildEvent,
  BuildEventCallback,
  TaskState,
  InputType,
  BuildPhase,
  TaskType,
  TaskStatus,
} from './state/types.js';

// Model types
export type { AgentName, ModelRole, ModelConfig } from './models/types.js';
export { DEFAULT_MODELS } from './models/types.js';
export { createGitHubModelsProvider } from './models/provider.js';

// Interaction interface
export type { UserInteraction } from './interaction/interface.js';
export { CLIInteraction } from './interaction/cli.js';

// Agents (for custom orchestration)
export { BaseAgent, type AgentContext, type AgentResult } from './agents/base-agent.js';
export { SpecificationWriterAgent } from './agents/specification-writer.js';
export { ScrumMasterAgent } from './agents/scrum-master.js';
export { ImplementationEngineerAgent } from './agents/implementation-engineer.js';
export { TestRunnerAgent } from './agents/test-runner.js';
export { CodeReviewerAgent } from './agents/code-reviewer.js';
export { UIUXDesignerAgent } from './agents/ui-ux-designer.js';
export { InfrastructureEngineerAgent } from './agents/infrastructure-engineer.js';

// MCP server
export { startMCPServer } from './mcp/server.js';
