import type { CommandContext, PermissionTier } from './context';

/** Grouping used by the help card (spec §5). */
export type CommandCategory =
  'playback' | 'queue' | 'playlist' | 'filters' | 'settings' | 'general';

export interface CommandOption {
  name: string;
  description: string;
  required?: boolean;
  /** Consumes every remaining token — used for search queries. */
  rest?: boolean;
  /**
   * What kind of value this option carries. Text unless stated.
   *
   * `attachment` is an uploaded file: Discord registers it as its own option
   * type, and both interfaces hand the command the file's URL, so a handler
   * reads an upload the same way whether it was attached to a slash command or
   * to a typed message.
   */
  type?: 'string' | 'attachment';
}

export interface Command {
  name: string;
  description: string;
  category: CommandCategory;
  /** Alternative names accepted by prefix and mention, e.g. `np` for `nowplaying`. */
  aliases?: string[];
  /** Positional options; slash options use the same names. */
  options?: CommandOption[];
  /** Minimum tier required to run it (spec §14.1). */
  tier?: PermissionTier;
  /** Per-user cooldown in milliseconds (spec §26). */
  cooldownMs?: number;
  /** The invoking user must be in a voice channel. */
  requiresVoice?: boolean;
  /** Reply early because resolving may be slow (spec §35). */
  deferred?: boolean;
  execute(ctx: CommandContext): Promise<void>;
}

/**
 * Maps positional prefix/mention arguments onto the command's named options.
 *
 * A `rest: true` option swallows everything from its position onwards, which is
 * how `!play chạy ngay đi` becomes `{ query: 'chạy ngay đi' }` while slash
 * commands supply the same name directly.
 */
export function mapPositionalOptions(
  command: Command,
  args: readonly string[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  const options = command.options ?? [];

  options.forEach((option, index) => {
    if (option.rest) {
      const value = args.slice(index).join(' ').trim();
      if (value) resolved.set(option.name, value);
      return;
    }

    const value = args[index];
    if (value !== undefined) resolved.set(option.name, value);
  });

  return resolved;
}

/** Names of required options the invocation did not supply. */
export function missingOptions(command: Command, resolved: ReadonlyMap<string, string>): string[] {
  return (command.options ?? [])
    .filter((option) => option.required && !resolved.get(option.name))
    .map((option) => option.name);
}

/**
 * Usage string shown in help and in "invalid arguments" errors.
 *
 * An upload is left out of it: a usage line tells somebody what to type, and a
 * file is not something anybody types.
 */
export function usage(command: Command, prefix = '/'): string {
  const options = (command.options ?? [])
    .filter((option) => option.type !== 'attachment')
    .map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`))
    .join(' ');

  return `${prefix}${command.name}${options ? ` ${options}` : ''}`;
}
