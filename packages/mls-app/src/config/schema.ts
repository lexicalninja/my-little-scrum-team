/**
 * Configuration schema with zod validation.
 */
import { z } from 'zod';
import { DEFAULT_MODELS } from '../models/types.js';

export const MLSConfigSchema = z.object({
  /** Model ID overrides per agent/role */
  models: z.record(z.string()).default({}),

  /** GitHub Models API settings */
  api: z.object({
    baseURL: z.string().default('https://models.inference.ai.azure.com'),
    token: z.string().optional(),
  }).default({}),

  /** Max tool-use steps per agent invocation */
  maxSteps: z.number().min(1).max(200).default(50),

  /** Max review iterations before escalation */
  maxReviewIterations: z.number().min(1).max(20).default(5),

  /** Directory for persisting build state */
  stateDir: z.string().default('.mls'),

  /** Whether to save decision records to disk */
  saveDecisions: z.boolean().default(true),

  /** Decisions directory path */
  decisionsDir: z.string().default('decisions'),
});

export type MLSConfig = z.infer<typeof MLSConfigSchema>;

export function getDefaultConfig(): MLSConfig {
  return MLSConfigSchema.parse({});
}

export function mergeWithDefaults(partial: Record<string, unknown>): MLSConfig {
  return MLSConfigSchema.parse(partial);
}
