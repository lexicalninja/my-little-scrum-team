import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPInteraction, ClarificationNeeded } from '../src/interaction/mcp-interaction.js';

describe('ClarificationNeeded', () => {
  it('is an Error with the right name', () => {
    const err = new ClarificationNeeded('What kind of site?');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClarificationNeeded');
    expect(err.question).toBe('What kind of site?');
    expect(err.message).toContain('What kind of site?');
  });
});

describe('MCPInteraction', () => {
  describe('ask()', () => {
    it('throws ClarificationNeeded when no pending answer', async () => {
      const interaction = new MCPInteraction();
      await expect(interaction.ask('What should this do?')).rejects.toBeInstanceOf(ClarificationNeeded);
    });

    it('thrown error carries the question text', async () => {
      const interaction = new MCPInteraction();
      const err = await interaction.ask('What colour?').catch((e) => e);
      expect(err.question).toBe('What colour?');
    });

    it('returns the pending answer when one is provided', async () => {
      const interaction = new MCPInteraction('A blue button');
      const answer = await interaction.ask('What colour?');
      expect(answer).toBe('A blue button');
    });

    it('consumes the pending answer on first call, then throws on second', async () => {
      const interaction = new MCPInteraction('first answer');
      await expect(interaction.ask('Q1')).resolves.toBe('first answer');
      await expect(interaction.ask('Q2')).rejects.toBeInstanceOf(ClarificationNeeded);
    });
  });

  describe('choose()', () => {
    it('always returns the first option', async () => {
      const interaction = new MCPInteraction();
      const result = await interaction.choose('Pick one', ['alpha', 'beta', 'gamma']);
      expect(result).toBe('alpha');
    });
  });

  describe('confirm()', () => {
    it('always returns true', async () => {
      const interaction = new MCPInteraction();
      expect(await interaction.confirm('Are you sure?')).toBe(true);
    });
  });

  describe('display() / close()', () => {
    it('display is a no-op', () => {
      const interaction = new MCPInteraction();
      expect(() => interaction.display('hello')).not.toThrow();
    });

    it('close is a no-op', () => {
      const interaction = new MCPInteraction();
      expect(() => interaction.close()).not.toThrow();
    });
  });
});
