/** Tool system types */
import type { CoreTool } from 'ai';

export type ToolSet = Record<string, CoreTool>;

export type PermissionLevel = 'readOnly' | 'readWrite';

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}
