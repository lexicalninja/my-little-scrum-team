/**
 * Input classifier — implements the decision tree from build.md:123-138.
 * Uses a fast model (gpt-4o-mini) to classify input type.
 */
import { generateText } from 'ai';
import { getModelForRole } from '../models/router.js';
import type { InputType } from '../state/types.js';
import type { ModelConfig } from '../models/types.js';
import { logger } from '../utils/logger.js';

const CLASSIFICATION_PROMPT = `You are an input classifier for a software development pipeline. Classify the user's input into exactly one of these categories:

- "bug" — A defect report with expected vs. actual behavior
- "impl-spec" — A complete implementation spec that lists specific files to create/modify AND includes step-by-step implementation instructions
- "requirements" — Complete requirements document (but without file-level implementation details)
- "plan" — Broad scope covering multiple epics/features
- "epic" — A large body of work (bigger than a single feature)
- "feature" — A single piece of functionality

Decision tree:
1. Is it a defect (expected vs. actual behavior)? → "bug"
2. Does it list specific files AND include step-by-step implementation instructions? → "impl-spec"
3. Does it provide complete requirements (without file-level details)? → "requirements"
4. How broad? Multiple epics → "plan", Large body → "epic", Single functionality → "feature"

Respond with ONLY the category name, nothing else.`;

export async function classifyInput(
  input: string,
  modelOverrides?: ModelConfig,
): Promise<InputType> {
  logger.info('Classifying input...');

  try {
    const model = getModelForRole('classifier', modelOverrides);
    const { text } = await generateText({
      model,
      system: CLASSIFICATION_PROMPT,
      prompt: input,
      maxSteps: 1,
    });

    const classification = text.trim().toLowerCase().replace(/[^a-z-]/g, '') as InputType;
    const validTypes: InputType[] = ['bug', 'impl-spec', 'requirements', 'plan', 'epic', 'feature'];

    if (validTypes.includes(classification)) {
      logger.info(`Classified as: ${classification}`);
      return classification;
    }

    // Fallback: try to extract from response
    for (const type of validTypes) {
      if (text.toLowerCase().includes(type)) {
        logger.info(`Classified as: ${type} (extracted)`);
        return type;
      }
    }

    logger.warn(`Could not classify input, defaulting to 'feature'`);
    return 'feature';
  } catch (error) {
    logger.error(`Classification failed: ${error}`);
    return 'feature';
  }
}
