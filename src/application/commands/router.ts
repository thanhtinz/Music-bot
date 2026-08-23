import { createLogger } from '../../telemetry/logger';

import { missingOptions, usage, type Command } from './command';
import { satisfiesTier, type CommandContext } from './context';
import { CooldownTracker } from './cooldown';
import type { CommandRegistry } from './registry';

export type DispatchStatus =
  | 'ok'
  | 'unknown-command'
  | 'missing-permission'
  | 'missing-argument'
  | 'needs-voice'
  | 'cooldown'
  | 'error';

export interface DispatchResult {
  status: DispatchStatus;
  command?: Command;
  /** Milliseconds left, only set for `cooldown`. */
  retryAfterMs?: number;
  error?: unknown;
}

export interface RouterOptions {
  cooldown?: CooldownTracker;
  /** Prefix shown in error messages so hints match how the user typed it. */
  prefixFor?: (ctx: CommandContext) => string;
  /**
   * Told the outcome of every dispatch and how long it took.
   *
   * Reported here rather than at each call site because this is the one place
   * every invocation passes through, whichever interface it came from.
   */
  onDispatched?: (result: DispatchResult, seconds: number) => void;
}

const logger = createLogger('command-router');

/**
 * Runs one command invocation through the shared gate checks.
 *
 * Permission, voice, argument, and cooldown rules live here rather than in each
 * command, so `/skip`, `!skip`, and `@Bot skip` cannot enforce them differently
 * (spec §4.1, §37).
 */
export class CommandRouter {
  private readonly cooldown: CooldownTracker;

  constructor(
    private readonly registry: CommandRegistry,
    private readonly options: RouterOptions = {},
  ) {
    this.cooldown = options.cooldown ?? new CooldownTracker();
  }

  async dispatch(ctx: CommandContext): Promise<DispatchResult> {
    const started = Date.now();

    const result = await this.route(ctx);
    this.options.onDispatched?.(result, (Date.now() - started) / 1000);

    return result;
  }

  private async route(ctx: CommandContext): Promise<DispatchResult> {
    const command = this.registry.get(ctx.commandName);

    if (!command) {
      const suggestion = this.registry.suggest(ctx.commandName);
      await ctx.reply({
        content: suggestion
          ? `Unknown command \`${ctx.commandName}\`. Did you mean \`${suggestion}\`?`
          : `Unknown command \`${ctx.commandName}\`. Try \`help\`.`,
        ephemeral: true,
      });
      return { status: 'unknown-command' };
    }

    const prefix = this.options.prefixFor?.(ctx) ?? (ctx.sourceType === 'slash' ? '/' : '!');

    if (!satisfiesTier(ctx.tier, command.tier ?? 'everyone')) {
      await ctx.reply({
        content: `You need the **${command.tier}** role to use \`${command.name}\`.`,
        ephemeral: true,
      });
      return { status: 'missing-permission', command };
    }

    if (command.requiresVoice && !ctx.voiceChannelId) {
      await ctx.reply({
        content: 'Join a voice channel first, then run the command again.',
        ephemeral: true,
      });
      return { status: 'needs-voice', command };
    }

    const missing = missingOptions(command, this.resolvedOptions(command, ctx));
    if (missing.length > 0) {
      await ctx.reply({
        content: `Missing ${missing.map((name) => `\`${name}\``).join(', ')}. Usage: \`${usage(command, prefix)}\``,
        ephemeral: true,
      });
      return { status: 'missing-argument', command };
    }

    const retryAfterMs = this.cooldown.hit(ctx.userId, command.name, command.cooldownMs ?? 0);
    if (retryAfterMs > 0) {
      await ctx.reply({
        content: `Slow down — try \`${command.name}\` again in ${Math.ceil(retryAfterMs / 1000)}s.`,
        ephemeral: true,
      });
      return { status: 'cooldown', command, retryAfterMs };
    }

    try {
      if (command.deferred) await ctx.defer();
      await command.execute(ctx);
      return { status: 'ok', command };
    } catch (error) {
      // A failed command should not burn the user's cooldown.
      this.cooldown.clear(ctx.userId, command.name);

      logger.error(
        {
          err: error,
          command: command.name,
          guildId: ctx.guildId,
          userId: ctx.userId,
          source: ctx.sourceType,
          correlationId: ctx.correlationId,
        },
        'command failed',
      );

      await ctx
        .reply({
          content: 'Something went wrong running that command. Please try again.',
          ephemeral: true,
        })
        .catch(() => undefined);

      return { status: 'error', command, error };
    }
  }

  /** Reads every declared option through the context's own resolver. */
  private resolvedOptions(command: Command, ctx: CommandContext): Map<string, string> {
    const resolved = new Map<string, string>();

    for (const option of command.options ?? []) {
      const value = ctx.option(option.name);
      if (value !== undefined && value !== '') resolved.set(option.name, value);
    }

    return resolved;
  }
}
