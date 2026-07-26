/**
 * TypeScript interfaces for all build artifacts and state.
 */

export type InputType = 'bug' | 'impl-spec' | 'requirements' | 'plan' | 'epic' | 'feature';

export type BuildPhase = 'refinement' | 'specification' | 'breakdown' | 'execution' | 'complete';

export type TaskStatus = 'pending' | 'in-progress' | 'testing' | 'reviewing' | 'approved' | 'complete' | 'failed' | 'escalated';

export type TaskType = 'implementation' | 'testing' | 'documentation' | 'infrastructure' | 'deployment' | 'design';

export type FeedbackCategory = 'must-fix' | 'should-fix' | 'nice-to-have' | 'out-of-scope' | 'needs-discussion';

export interface TaskState {
  id: string;
  title: string;
  type: TaskType;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  canRunInParallelWith: string[];
  assignedAgent: string;
  status: TaskStatus;
  filesAffected: string[];
  complexity: 'low' | 'medium' | 'high';
  reviewIterations: number;
  output?: string;
  error?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface BuildState {
  id: string;
  input: string;
  inputType: InputType;
  phase: BuildPhase;
  startedAt: string;
  updatedAt: string;

  /** Phase 0 output */
  decisionRecord?: string;

  /** Phase 1 output */
  specification?: string;

  /** Phase 2 output */
  taskBreakdown?: string;
  tasks: Map<string, TaskState>;

  /** Per-model token tracking */
  tokenUsage: Record<string, TokenUsage>;

  /** Estimated cost in USD */
  costEstimate: number;

  /** Resume context — additional instructions for resumed builds */
  resumeContext?: string;

  /** Error state */
  error?: string;
}

/** Events emitted during build execution */
export type BuildEvent =
  | { type: 'phase_start'; phase: string; description: string }
  | { type: 'phase_complete'; phase: string; summary: string }
  | { type: 'agent_start'; agent: string; task: string; model: string }
  | { type: 'agent_thinking'; agent: string; content: string }
  | { type: 'agent_tool_use'; agent: string; tool: string; input: string }
  | { type: 'agent_complete'; agent: string; summary: string; tokens: number }
  | { type: 'quality_gate'; gate: string; result: 'pass' | 'fail'; reason: string }
  | { type: 'user_input_needed'; question: string; options?: string[] }
  | { type: 'artifact_created'; name: string; preview: string }
  | { type: 'iteration'; agent: string; iteration: number; maxIterations: number; reason: string }
  | { type: 'build_complete'; summary: string }
  | { type: 'error'; message: string; recoverable: boolean };

export type BuildEventCallback = (event: BuildEvent) => void;

export interface BuildResult {
  success: boolean;
  state: BuildState;
  summary: string;
  needs_clarification?: boolean;
  clarification_question?: string;
}
