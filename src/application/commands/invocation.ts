import type { CommandContext } from './context';
import type { SourceType } from './parser';

export interface InvocationOptions {
  /** The guild's message prefix, for a command typed with one. */
  prefix?: string;
  /** The bot's display name, for a command sent as a mention. */
  botName?: string;
}

/** What a mention invocation is called when the bot's name is not to hand. */
const FALLBACK_BOT_NAME = 'Bot';

/**
 * How to write a command back to whoever ran it.
 *
 * A card is an image, so every command it names has to be spelled out — and
 * spelled the way that person reached the bot. Somebody who typed `@Bot play`
 * has no prefix set in their head, and telling them to use `?play` answers a
 * question they did not ask; the same goes the other way for a slash user, who
 * may not know the guild has a prefix at all.
 */
export function invocationPrefix(source: SourceType, options: InvocationOptions = {}): string {
  switch (source) {
    case 'slash':
      return '/';
    case 'mention':
      // The trailing space is part of it: `@Bot play`, not `@Botplay`.
      return `@${options.botName?.trim() || FALLBACK_BOT_NAME} `;
    default:
      return options.prefix ?? '!';
  }
}

/** The same, reading the source straight off a context. */
export function prefixFor(ctx: CommandContext, options: InvocationOptions = {}): string {
  return invocationPrefix(ctx.sourceType, options);
}
