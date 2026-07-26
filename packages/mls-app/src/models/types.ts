/** Model configuration types for multi-provider routing */

export type AgentName =
  | 'specification-writer'
  | 'scrum-master'
  | 'implementation-engineer'
  | 'test-runner'
  | 'code-reviewer'
  | 'ui-ux-designer'
  | 'infrastructure-engineer';

export type SpecialRole =
  | 'classifier'
  | 'idea-refinement'
  | 'quality-gate';

export type ModelRole = AgentName | SpecialRole;

export interface ModelConfig {
  /** Model ID overrides keyed by agent name or special role */
  [key: string]: string;
}

/** Default model assignments per agent/role.
 *  Uses models available on GitHub Models (models.inference.ai.azure.com).
 *  Override per-agent in .mls/config.json or via CLI flags.
 */
export const DEFAULT_MODELS: Record<ModelRole, string> = {
  // Fast/cheap for routing decisions
  'classifier': 'gpt-4o-mini',
  'quality-gate': 'gpt-4o-mini',

  // Reasoning + user collaboration
  'idea-refinement': 'gpt-4o',

  // Strong reasoning + code generation
  'specification-writer': 'gpt-4o',
  'scrum-master': 'gpt-4o-mini',
  'ui-ux-designer': 'gpt-4o-mini',
  'implementation-engineer': 'gpt-4o',
  'test-runner': 'gpt-4o-mini',
  'infrastructure-engineer': 'gpt-4o',

  // Deepest reasoning for catching bugs
  'code-reviewer': 'gpt-4o',
};
