/** How a command reached the bot (spec §4.1). */
export type SourceType = 'slash' | 'prefix' | 'mention';

export interface ParsedCommand {
  /** Lowercased command name, e.g. `play`. */
  name: string;
  /** Remaining tokens after the command name, quotes already resolved. */
  args: string[];
  /** Everything after the command name, verbatim — handy for search queries. */
  rest: string;
  source: Extract<SourceType, 'prefix' | 'mention'>;
}

export interface ParseOptions {
  /** Guild prefix, e.g. `!`. */
  prefix: string;
  /** The bot's user id, used to recognise `@Bot play …`. */
  botUserId: string;
}

/** Matches `<@id>` and the legacy nickname form `<@!id>` at the start of a message. */
const MENTION_PATTERN = /^<@!?(\d+)>/;

/**
 * Turns a raw message into a command, or `null` when it is not addressed to us.
 *
 * Prefix and mention share one parser so the two interfaces can never drift
 * apart in how they tokenise arguments (spec §4.1).
 */
export function parseMessage(content: string, options: ParseOptions): ParsedCommand | null {
  const raw = content.trim();
  if (!raw) return null;

  const mention = raw.match(MENTION_PATTERN);
  if (mention && mention[1] === options.botUserId) {
    // The mention is stripped before tokenising, so `@Bot play x` and `!play x`
    // reach the command layer as the exact same tokens (spec §4.3).
    return build(raw.slice(mention[0].length).trim(), 'mention');
  }

  const prefix = options.prefix;
  if (prefix && raw.toLowerCase().startsWith(prefix.toLowerCase())) {
    return build(raw.slice(prefix.length).trim(), 'prefix');
  }

  return null;
}

function build(body: string, source: 'prefix' | 'mention'): ParsedCommand | null {
  if (!body) return null;

  const tokens = tokenize(body);
  const name = tokens.shift();
  if (!name) return null;

  // `rest` is recovered from the original body rather than by re-joining the
  // tokens, so a quoted search query keeps its original spacing.
  const rest = body.slice(firstTokenLength(body)).trim();

  return { name: name.toLowerCase(), args: tokens, rest, source };
}

/** Length of the first whitespace-delimited token, including surrounding quotes. */
function firstTokenLength(body: string): number {
  const match = body.match(/^\s*("[^"]*"|'[^']*'|\S+)/);
  return match ? match[0].length : body.length;
}

/**
 * Splits on whitespace while honouring single and double quotes.
 *
 * Unterminated quotes are treated as running to the end of the string rather
 * than as an error — a user typing `!play "chạy ngay đi` still gets a query.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

/** True when the message is nothing but a mention of the bot, e.g. `@Bot`. */
export function isBareMention(content: string, botUserId: string): boolean {
  const raw = content.trim();
  const mention = raw.match(MENTION_PATTERN);
  return Boolean(mention && mention[1] === botUserId && !raw.slice(mention[0].length).trim());
}
