/**
 * Tool registry — groups tools into permission sets for agent access control.
 */
import type { ToolSet, PermissionLevel } from './types.js';
import { readFileTool } from './file-read.js';
import { writeFileTool } from './file-write.js';
import { editFileTool } from './file-edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';

const READ_ONLY_TOOLS: ToolSet = {
  readFile: readFileTool,
  glob: globTool,
  grep: grepTool,
};

const READ_WRITE_TOOLS: ToolSet = {
  ...READ_ONLY_TOOLS,
  writeFile: writeFileTool,
  editFile: editFileTool,
  bash: bashTool,
};

export function getToolsForPermission(level: PermissionLevel): ToolSet {
  switch (level) {
    case 'readOnly':
      return { ...READ_ONLY_TOOLS };
    case 'readWrite':
      return { ...READ_WRITE_TOOLS };
  }
}

/** Agent-to-permission mapping from the plan */
export const AGENT_PERMISSIONS: Record<string, PermissionLevel> = {
  'specification-writer': 'readOnly',
  'scrum-master': 'readOnly',
  'ui-ux-designer': 'readOnly',
  'implementation-engineer': 'readWrite',
  'test-runner': 'readWrite',
  'code-reviewer': 'readOnly',
  'infrastructure-engineer': 'readWrite',
};
