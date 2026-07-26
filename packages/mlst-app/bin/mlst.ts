#!/usr/bin/env node
/**
 * MLST CLI entry point — multi-agent scrum team.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/loader.js';
import { OrchestrationEngine } from '../src/orchestrator/engine.js';
import { CLIInteraction, AutoInteraction } from '../src/interaction/cli.js';
import { createGitHubModelsProvider } from '../src/models/provider.js';
import { listRuns } from '../src/state/persistence.js';
import { setLogLevel } from '../src/utils/logger.js';
import type { BuildEvent } from '../src/state/types.js';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const program = new Command();

program
  .name('mlst')
  .description('Multi-agent scrum team — orchestrates specialist AI agents to build software')
  .version(version);

// ─── build ──────────────────────────────────────────────────────────
program
  .command('build')
  .description('Start a new build from a description, issue, or file')
  .argument('[description...]', 'What to build')
  .option('--from-issue <number>', 'Build from a GitHub issue number')
  .option('--from-file <path>', 'Build from a specification file')
  .option('--resume <id>', 'Resume an interrupted build')
  .option('--context <text>', 'Additional context for resumed builds')
  .option('--verbose', 'Enable debug logging')
  .option('--yes', 'Auto-accept all prompts (non-interactive mode)')
  .action(async (descriptionParts: string[], opts) => {
    if (opts.verbose) setLogLevel('debug');

    const config = await loadConfig();
    createGitHubModelsProvider({ apiKey: config.api.token, baseURL: config.api.baseURL });

    const interaction = (opts.yes || !process.stdin.isTTY)
      ? new AutoInteraction()
      : new CLIInteraction();

    let input: string;
    if (opts.fromFile) {
      input = await readFile(resolve(opts.fromFile), 'utf-8');
    } else if (opts.fromIssue) {
      const { fetchGitHubIssue, inferRepoFromGitRemote, GithubIssueError } =
        await import('../src/utils/github-issue.js');
      try {
        const { owner, repo } = await inferRepoFromGitRemote(process.cwd());
        input = await fetchGitHubIssue(
          { owner, repo, number: parseInt(opts.fromIssue, 10) },
          process.cwd(),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `\nError: ${
              err instanceof GithubIssueError ? err.message : String(err)
            }`,
          ),
        );
        process.exit(1);
      }
    } else if (descriptionParts.length > 0) {
      const rawInput = descriptionParts.join(' ');
      const { resolveIssueReference, GithubIssueError } =
        await import('../src/utils/github-issue.js');
      try {
        input = await resolveIssueReference(rawInput, process.cwd());
      } catch (err) {
        console.error(
          chalk.red(
            `\nError: ${
              err instanceof GithubIssueError ? err.message : String(err)
            }`,
          ),
        );
        process.exit(1);
      }
    } else {
      input = await interaction.ask('What would you like to build?');
    }

    const engine = new OrchestrationEngine(config, interaction);

    // Handle Ctrl+C for graceful shutdown
    let cancelCount = 0;
    process.on('SIGINT', () => {
      cancelCount++;
      if (cancelCount === 1) {
        console.error(chalk.yellow('\nCancelling... saving state.'));
        engine.cancel();
      } else {
        console.error(chalk.red('\nForce exit.'));
        process.exit(1);
      }
    });

    const result = await engine.build(input, renderEvent, {
      resumeId: opts.resume,
      resumeContext: opts.context,
      fromIssue: opts.fromIssue ? parseInt(opts.fromIssue) : undefined,
      fromFile: opts.fromFile,
    });

    interaction.close();

    if (!result.success) {
      console.error(chalk.red('\n' + result.summary));
      process.exit(1);
    }
  });

// ─── status ─────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show status of current or recent builds')
  .option('--id <id>', 'Show status of a specific build')
  .action(async (opts) => {
    const config = await loadConfig();
    const runs = await listRuns(config.stateDir);

    if (runs.length === 0) {
      console.error('No build runs found.');
      return;
    }

    console.error(chalk.bold('\nRecent builds:\n'));
    for (const run of runs.slice(0, 10)) {
      const statusColor = run.phase === 'complete' ? chalk.green : chalk.yellow;
      console.error(
        `  ${chalk.gray(run.id)} ${statusColor(run.phase.padEnd(14))} ${run.input}${run.input.length >= 100 ? '...' : ''}`
      );
    }
    console.error('');
  });

// ─── config ─────────────────────────────────────────────────────────
program
  .command('config')
  .description('View or update project configuration')
  .argument('[action]', 'init | set | get')
  .argument('[key]', 'Config key (e.g., models.code-reviewer)')
  .argument('[value]', 'Config value')
  .action(async (action, key, value) => {
    const config = await loadConfig();

    if (!action || action === 'get') {
      console.error(JSON.stringify(config, null, 2));
    } else if (action === 'init') {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir('.mlst', { recursive: true });
      await writeFile('.mlst/config.json', JSON.stringify({
        models: {},
        maxSteps: 50,
        maxReviewIterations: 5,
      }, null, 2));
      console.error(chalk.green('Created .mlst/config.json'));
    } else if (action === 'set' && key && value) {
      console.error(`Set ${key} = ${value}`);
      console.error(chalk.gray('(Edit .mlst/config.json directly for now)'));
    }
  });

// ─── serve ──────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start MCP server for agent integration')
  .option('--port <number>', 'HTTP port (default: stdio transport)')
  .action(async (opts) => {
    const { startMCPServer } = await import('../src/mcp/server.js');
    const config = await loadConfig();
    // Defer provider creation — don't crash the MCP server if GITHUB_TOKEN
    // isn't set at startup. The provider will be created on first tool call.
    if (config.api.token) {
      createGitHubModelsProvider({ apiKey: config.api.token, baseURL: config.api.baseURL });
    }
    await startMCPServer(config, opts.port ? parseInt(opts.port) : undefined);
  });

program.parse();

// ─── Event renderer ─────────────────────────────────────────────────
function renderEvent(event: BuildEvent): void {
  switch (event.type) {
    case 'phase_start':
      console.error(chalk.bold.white(`\n[${event.phase}] ${event.description}`));
      break;
    case 'phase_complete':
      console.error(chalk.gray(`  ${event.summary}`));
      break;
    case 'agent_start':
      console.error(chalk.cyan(`  [${event.agent}]`) + ` Starting (${chalk.gray(event.model)})`);
      break;
    case 'agent_tool_use':
      console.error(chalk.gray(`  [${event.agent}] Tool: ${event.tool}`));
      break;
    case 'agent_complete':
      console.error(chalk.cyan(`  [${event.agent}]`) + ` Complete (${event.tokens} tokens)`);
      break;
    case 'quality_gate':
      const status = event.result === 'pass' ? chalk.green('PASS') : chalk.red('FAIL');
      console.error(`  ${event.gate}: ${status}${event.reason ? chalk.gray(` — ${event.reason}`) : ''}`);
      break;
    case 'artifact_created':
      console.error(chalk.blue(`  ${event.name}: `) + event.preview.slice(0, 80));
      break;
    case 'iteration':
      console.error(chalk.yellow(`  [${event.agent}] Iteration ${event.iteration}/${event.maxIterations}: ${event.reason}`));
      break;
    case 'build_complete':
      console.error(chalk.green.bold(`\n${event.summary}`));
      break;
    case 'error':
      console.error(chalk.red(`  Error: ${event.message}`));
      break;
    case 'user_input_needed':
      // Handled by interaction interface
      break;
    case 'agent_thinking':
      // Verbose only — handled by logger
      break;
  }
}
