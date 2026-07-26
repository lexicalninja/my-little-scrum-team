/**
 * MCP server setup — stdio transport by default, optional HTTP.
 * Exposes MLS tools and resources to MCP-compatible hosts (Claude Code, Cursor).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { MLSConfig } from '../config/schema.js';
import { OrchestrationEngine } from '../orchestrator/engine.js';
import { AutoInteraction } from '../interaction/cli.js';
import { createMCPTools } from './tools.js';
import { listResources, readResource } from './resources.js';
import { logger, setLogLevel } from '../utils/logger.js';

export async function startMCPServer(config: MLSConfig, port?: number): Promise<void> {
  const interaction = new AutoInteraction();
  const engine = new OrchestrationEngine(config, interaction);

  const server = new McpServer({
    name: 'mls',
    version: '1.0.0',
  });

  // Register tools
  const tools = createMCPTools(engine, config);
  for (const toolDef of tools) {
    // Convert inputSchema properties to zod schema
    const props = (toolDef.inputSchema as { properties?: Record<string, { type: string; description?: string }> }).properties ?? {};
    const required = (toolDef.inputSchema as { required?: string[] }).required ?? [];
    const zodShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(props)) {
      let schema: z.ZodTypeAny;
      if (prop.type === 'number') {
        schema = z.number().describe(prop.description ?? '');
      } else {
        schema = z.string().describe(prop.description ?? '');
      }
      if (!required.includes(key)) {
        schema = schema.optional();
      }
      zodShape[key] = schema;
    }

    const handler = toolDef.handler;
    server.tool(
      toolDef.name,
      toolDef.description,
      zodShape,
      async (args) => {
        try {
          const result = await handler(args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: result }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      },
    );
  }

  // Register resource templates
  server.resource(
    'build-status',
    'mls://runs/{runId}/status',
    { description: 'Build run status' },
    async (uri) => {
      const content = await readResource(uri.href, config.stateDir);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: content }] };
    },
  );

  server.resource(
    'build-specification',
    'mls://runs/{runId}/specification',
    { description: 'Generated specification' },
    async (uri) => {
      const content = await readResource(uri.href, config.stateDir);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: content }] };
    },
  );

  server.resource(
    'build-tasks',
    'mls://runs/{runId}/tasks',
    { description: 'Task breakdown' },
    async (uri) => {
      const content = await readResource(uri.href, config.stateDir);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: content }] };
    },
  );

  // Start transport
  if (port) {
    // HTTP transport — for network-accessible servers
    logger.info(`MCP server starting on HTTP port ${port}...`);
    // Note: SSE/HTTP transport requires additional setup
    // For now, fall back to stdio
    logger.warn('HTTP transport not yet implemented, falling back to stdio');
  }

  // Default: stdio transport — suppress logger since stderr is used by MCP
  setLogLevel('error');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
