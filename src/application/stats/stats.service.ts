import {
  createGuildStats,
  rankOf,
  statsFor,
  topArtists,
  topArtistsFor,
  topListeners,
  topTracks,
  topTracksFor,
  type ArtistStat,
  type GuildStats,
  type TrackStat,
} from '../../domain/stats';
import {
  formatHours,
  renderSakuraStatsCard,
  STATS_SAKURA_ROWS,
  type StatsCardData,
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

/** A user id, from a raw snowflake or from the `<@id>` a mention pastes as. */
export function parseUserId(value: string | undefined): string | undefined {
  const id = value?.trim().replace(/^<@!?/, '').replace(/>$/, '');

  return id && /^\d{5,}$/.test(id) ? id : undefined;
}

/**
 * What a server — or one person in it — listens to (spec §22).
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
    // `stats @someone` and `/stats user:@someone` are the same request.
    const argument = ctx.option('user') ?? ctx.args[0];
    const target = parseUserId(argument);

    if (argument && !target) {
      await ctx.reply({
        content: `I do not know who **${argument}** is. Mention someone, or run **stats** on its own.`,
        title: 'Who?',
        icon: 'warning',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

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

    await (target ? this.showMember(ctx, stats, target) : this.showGuild(ctx, stats));
  }

  private async showGuild(ctx: CommandContext, stats: GuildStats): Promise<void> {
    const mine = statsFor(stats, ctx.userId);

    await this.send(ctx, {
      totalPlays: stats.totalPlays,
      totalListenedMs: stats.totalListenedMs,
      since: stats.since,
      topTracks: topTracks(stats, STATS_SAKURA_ROWS).map(trackEntry),
      topArtists: topArtists(stats, STATS_SAKURA_ROWS).map(artistEntry),
      topListeners: this.listenerEntries(stats),
      ...(mine === undefined ? {} : { you: { plays: mine.plays, listenedMs: mine.listenedMs } }),
    });
  }

  private async showMember(ctx: CommandContext, stats: GuildStats, userId: string): Promise<void> {
    const theirs = statsFor(stats, userId);
    const name = this.nameFor(userId);

    if (!theirs) {
      // A card of empty columns says less than the sentence does.
      await ctx.reply({
        content: `**${name}** has not queued anything here yet.`,
        title: 'Nothing to show',
        icon: 'list',
        tone: 'info',
        ephemeral: true,
      });
      return;
    }

    const rank = rankOf(stats, userId);

    await this.send(ctx, {
      totalPlays: stats.totalPlays,
      totalListenedMs: stats.totalListenedMs,
      since: stats.since,
      topTracks: topTracksFor(stats, userId, STATS_SAKURA_ROWS).map(trackEntry),
      topArtists: topArtistsFor(stats, userId, STATS_SAKURA_ROWS).map(artistEntry),
      topListeners: this.listenerEntries(stats, userId),
      subject: {
        name,
        plays: theirs.plays,
        listenedMs: theirs.listenedMs,
        listenerCount: stats.users.length,
        ...(rank === undefined ? {} : { rank }),
      },
    });
  }

  /** The guild's listeners, with one row optionally picked out. */
  private listenerEntries(stats: GuildStats, highlight?: string): StatsCardEntry[] {
    return topListeners(stats, STATS_SAKURA_ROWS).map((user) => ({
      label: this.nameFor(user.userId),
      detail: `${formatHours(user.listenedMs)} listened`,
      plays: user.plays,
      ...(user.userId === highlight ? { highlight: true } : {}),
    }));
  }

  private async send(ctx: CommandContext, data: Omit<StatsCardData, 'guildName'>): Promise<void> {
    const guildName = this.options.guildName?.(ctx.guildId);

    const card = await renderSakuraStatsCard({
      ...(guildName === undefined ? {} : { guildName }),
      ...data,
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

function trackEntry(track: TrackStat): StatsCardEntry {
  return { label: track.title, detail: track.author, plays: track.plays };
}

function artistEntry(artist: ArtistStat): StatsCardEntry {
  return {
    label: artist.author,
    detail: `${formatHours(artist.listenedMs)} listened`,
    plays: artist.plays,
  };
}
