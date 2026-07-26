/**
 * Agent-to-skill mapping — defines which skills each agent has access to.
 * Translated from the agent markdown files.
 */
import type { AgentName } from '../models/types.js';

/** Skills available to each agent */
export const AGENT_SKILLS: Record<AgentName, string[]> = {
  'specification-writer': [
    'requirement-analyzer',
    'technical-spec-writer',
  ],
  'scrum-master': [
    'implementation-planner',
  ],
  'implementation-engineer': [
    'api-implementer',
    'database-implementer',
    'component-implementer',
    'utility-implementer',
    'config-setup',
    'git-commit-helper',
    'changelog-generator',
    'code-documentation',
    'import-formatter',
  ],
  'test-runner': [
    'test-writer',
  ],
  'code-reviewer': [
    'bug-detector',
    'security-scanner',
    'specification-checker',
    'code-style-analyzer',
    'performance-analyzer',
    'accessibility-checker',
    'architecture-reviewer',
    'best-practices-checker',
  ],
  'ui-ux-designer': [
    'layout-designer',
    'component-designer',
    'color-system-designer',
    'typography-designer',
    'spacing-system-designer',
    'interaction-designer',
    'responsive-design-planner',
    'accessibility-design-checker',
  ],
  'infrastructure-engineer': [
    'config-setup',
    'security-scanner',
    'git-commit-helper',
  ],
};

/** Coordination skills used by the orchestrator */
export const ORCHESTRATOR_SKILLS: string[] = [
  'idea-refiner',
  'resource-allocation-optimizer',
  'agent-capability-assessor',
  'task-to-agent-matcher',
  'agent-creator',
  'escalation-handler',
  'conflict-resolver',
  'quality-gate-manager',
  'team-health-checker',
];
