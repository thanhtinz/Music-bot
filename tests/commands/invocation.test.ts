import { describe, expect, it } from 'vitest';

import { invocationPrefix, prefixFor, type CommandContext } from '../../src/application/commands';

describe('invocationPrefix', () => {
  it('answers a slash command with a slash', () => {
    expect(invocationPrefix('slash', { prefix: '?', botName: 'Melody' })).toBe('/');
  });

  it('answers a typed command with the guild’s prefix', () => {
    expect(invocationPrefix('prefix', { prefix: '?', botName: 'Melody' })).toBe('?');
  });

  it('answers a mention with the bot’s name', () => {
    // Somebody who typed `@Melody play` has no prefix in their head, and a
    // card telling them to use `?play` answers a question they did not ask.
    expect(invocationPrefix('mention', { prefix: '?', botName: 'Melody' })).toBe('@Melody ');
  });

  it('keeps the space that separates the mention from the command', () => {
    expect(`${invocationPrefix('mention', { botName: 'Melody' })}play`).toBe('@Melody play');
  });

  it('names a bot it was not told the name of', () => {
    expect(invocationPrefix('mention', { prefix: '?' })).toBe('@Bot ');
    expect(invocationPrefix('mention', { botName: '   ' })).toBe('@Bot ');
  });

  it('falls back to a plain prefix when the guild’s is unknown', () => {
    expect(invocationPrefix('prefix', {})).toBe('!');
  });

  it('reads the source off a context', () => {
    const ctx = { sourceType: 'mention' } as CommandContext;

    expect(prefixFor(ctx, { prefix: '?', botName: 'Melody' })).toBe('@Melody ');
  });
});
