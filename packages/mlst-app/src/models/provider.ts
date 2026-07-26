/**
 * GitHub Models API provider setup using Vercel AI SDK's OpenAI-compatible provider.
 * All models (Claude, GPT-4o, Gemini, Llama) are accessed through the same endpoint.
 */
import { createOpenAI } from '@ai-sdk/openai';

let _provider: ReturnType<typeof createOpenAI> | null = null;

export function createGitHubModelsProvider(options?: {
  apiKey?: string;
  baseURL?: string;
}) {
  const apiKey = options?.apiKey ?? process.env.GITHUB_TOKEN;
  const baseURL = options?.baseURL ?? process.env.GITHUB_MODELS_BASE_URL ?? 'https://models.inference.ai.azure.com';

  if (!apiKey) {
    throw new Error(
      'GITHUB_TOKEN is required for GitHub Models API access.\n' +
      'Set it via environment variable or pass it in config.\n' +
      'Get a token at: https://github.com/settings/tokens'
    );
  }

  _provider = createOpenAI({
    baseURL,
    apiKey,
  });

  return _provider;
}

export function getProvider() {
  if (!_provider) {
    return createGitHubModelsProvider();
  }
  return _provider;
}
