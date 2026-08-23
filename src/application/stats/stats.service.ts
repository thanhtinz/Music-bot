import {
  createGuildStats,
  statsFor,
  topArtists,
  topListeners,
  topTracks,
} from '../../domain/stats';
import {
  formatHours,
  renderSakuraStatsCard,
  STATS_SAKURA_ROWS,
  type StatsCardEntry,
} from '../../ui/canvas';
import type { CommandContext } from '../commands';

import type { StatsRepository } from './stats-repository';

export interface StatsServiceOptions {
  /** Resolves a display name for a user id. */
  displayName?: (userId: string) => string | undefined;
  /** Resolves a guild's name for the card header. */
  guildName?: (guildId: string) => string | undefined;
}

/**
 * What a server listens to (spec §22).
 *
 * Reads only: the numbers are gathered by the recorder as tracks end, so a
 * command never has to be run for the counting to happen.
 */
export class StatsService {
  constructor(
    private readonly repository: StatsRepository,
    private readonly options: StatsServiceOptions = {},
  ) {}

  async show(ctx: CommandContext): Promise<void> {
    const stats = (await this.repository.find(ctx.guildId)) ?? createGuildStats(ctx.guildId);

    if (stats.totalPlays === 0) {
      await ctx.reply({
        content: 'Nothing has been played here yet. Queue something and check back.',
        title: 'No stats yet',
        icon: 'list',
        tone: 'info',
        ephemeral: true,
      });
      return;
    }

    const mine = statsFor(stats, ctx.userId);

    const card = await renderSakuraStatsCard({
      ...(this.options.guildName?.(ctx.guildId) === undefined
        ? {}
        : { guildName: this.options.guildName(ctx.guildId) }),
      totalPlays: stats.totalPlays,
      totalListenedMs: stats.totalListenedMs,
      since: stats.since,
      topTracks: topTracks(stats, STATS_SAKURA_ROWS).map((track): StatsCardEntry => ({
        label: track.title,
        detail: track.author,
        plays: track.plays,
      })),
      topArtists: topArtists(stats, STATS_SAKURA_ROWS).map((artist): StatsCardEntry => ({
        label: artist.author,
        detail: `${formatHours(artist.listenedMs)} listened`,
        plays: artist.plays,
      })),
      topListeners: topListeners(stats, STATS_SAKURA_ROWS).map((user): StatsCardEntry => ({
        label: this.nameFor(user.userId),
        detail: `${formatHours(user.listenedMs)} listened`,
        plays: user.plays,
      })),
      ...(mine === undefined ? {} : { you: { plays: mine.plays, listenedMs: mine.listenedMs } }),
    });

    await ctx.reply({ attachments: [{ name: 'stats.png', data: card }] });
  }

  /**
   * A display name, or a readable stand-in.
   *
   * A raw snowflake on a card is unreadable, and it is somebody's account id —
   * neither belongs in a picture posted to a channel.
   */
  private nameFor(userId: string): string {
    return this.options.displayName?.(userId) ?? 'Someone';
  }
}
