/**
 * Model router — selects the right model for each agent/role based on config.
 * Users can override any agent's model in project config.
 */
import type { LanguageModel } from 'ai';
import { getProvider } from './provider.js';
import { DEFAULT_MODELS, type ModelConfig, type ModelRole } from './types.js';

export function getModelForRole(role: ModelRole, overrides?: ModelConfig): LanguageModel {
  const modelId = overrides?.[role] ?? DEFAULT_MODELS[role];
  if (!modelId) {
    throw new Error(`No model configured for role: ${role}`);
  }
  const provider = getProvider();
  return provider(modelId);
}

export function getModelId(role: ModelRole, overrides?: ModelConfig): string {
  return overrides?.[role] ?? DEFAULT_MODELS[role];
}
