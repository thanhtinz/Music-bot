import {
  applySetting,
  createSettings,
  SETTING_DESCRIPTORS,
  SettingsError,
  type GuildSettings,
  type SettingsDefaults,
} from '../../domain/settings';
import { createLogger } from '../../telemetry/logger';
import { renderSakuraSettingsCard, type SettingsCardRow } from '../../ui/canvas';
import type { CommandContext } from '../commands';

import type { SettingsRepository } from './settings-repository';

const logger = createLogger('settings-service');

export interface SettingsServiceOptions {
  /** Values a guild starts with, from the environment. */
  defaults: SettingsDefaults;
  /** Resolves a guild's name for the card header. */
  guildName?: (guildId: string) => string | undefined;
}

/**
 * Per-guild settings (spec §14).
 *
 * Reads go through {@link forGuild}, which fills in the environment defaults,
 * so a guild that has never been configured behaves exactly like one that has
 * been set to the defaults rather than like one with missing values.
 */
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly options: SettingsServiceOptions,
  ) {}

  /** The guild's settings, defaulted but not saved. */
  async forGuild(guildId: string): Promise<GuildSettings> {
    const stored = await this.repository.find(guildId);
    return stored ?? createSettings(guildId, this.options.defaults);
  }

  /** Renders the whole settings sheet. */
  async show(ctx: CommandContext): Promise<void> {
    const settings = await this.forGuild(ctx.guildId);

    const rows: SettingsCardRow[] = SETTING_DESCRIPTORS.map((descriptor) => ({
      key: descriptor.key,
      label: descriptor.label,
      description: descriptor.description,
      value: descriptor.format(settings),
    }));

    const card = await renderSakuraSettingsCard({
      rows,
      guildName: this.options.guildName?.(ctx.guildId),
      prefix: ctx.sourceType === 'slash' ? '/' : settings.prefix,
    });

    await ctx.reply({ attachments: [{ name: 'settings.png', data: card }] });
  }

  /** Changes one setting. */
  async set(ctx: CommandContext, key: string, value: string): Promise<void> {
    try {
      if (!value.trim()) {
        const descriptor = SETTING_DESCRIPTORS.find((entry) => entry.key === key.toLowerCase());
        await ctx.reply({
          content: descriptor
            ? `Give a value, e.g. \`${descriptor.example}\`.`
            : 'Give a setting and a value.',
          title: 'Settings',
          icon: 'gear',
          ephemeral: true,
        });
        return;
      }

      const current = await this.forGuild(ctx.guildId);
      const { settings, descriptor } = applySetting(current, key, value);
      await this.repository.save(settings);

      logger.info({ guildId: ctx.guildId, setting: descriptor.key }, 'guild setting changed');

      await ctx.reply({
        content: `**${descriptor.label}** is now **${descriptor.format(settings)}**.`,
        title: 'Settings',
        icon: 'gear',
      });
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /** Toggles 24/7, which is one setting with its own command. */
  async toggleStayConnected(ctx: CommandContext, enabled?: boolean): Promise<void> {
    const current = await this.forGuild(ctx.guildId);
    const next = enabled ?? !current.stayConnected;

    await this.repository.save({ ...current, stayConnected: next, updatedAt: Date.now() });

    await ctx.reply({
      content: next
        ? 'Staying in voice when the queue runs out.'
        : `Leaving after ${formatIdle(current)} alone once the queue runs out.`,
      title: `24/7 ${next ? 'on' : 'off'}`,
      icon: 'clock',
      tone: next ? 'success' : 'info',
    });
  }

  private async replyWithError(ctx: CommandContext, error: unknown): Promise<void> {
    if (error instanceof SettingsError) {
      await ctx.reply({
        content: error.message,
        title: 'Settings',
        icon: 'gear',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

    logger.error({ err: error, guildId: ctx.guildId }, 'settings command failed');
    await ctx.reply({
      content: 'Could not change that setting. Try again.',
      title: 'That did not work',
      tone: 'error',
      ephemeral: true,
    });
  }
}

function formatIdle(settings: GuildSettings): string {
  const minutes = Math.round(settings.idleTimeoutMs / 60_000);
  return minutes >= 1 ? `${minutes} minute(s)` : `${Math.round(settings.idleTimeoutMs / 1000)}s`;
}
