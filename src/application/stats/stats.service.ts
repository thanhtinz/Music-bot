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
import { formatHours } from '../../ui/canvas';
import type { CommandContext } from '../commands';

import type { StatsRepository } from './stats-repository';

export interface StatsServiceOptions {
  /** Resolves a display name for a user id. */
  displayName?: (userId: string) => string | undefined;
  /** Resolves a guild's name for the card header. */
  guildName?: (guildId: string) => string | undefined;
}

/** The words that ask for the whole server rather than one person. */
const SERVER_WORDS = new Set(['server', 'guild', 'all', 'everyone']);

/** Whether an argument asks for the server's stats. */
export function isServerWord(value: string): boolean {
  return SERVER_WORDS.has(value.trim().toLowerCase());
}

/** A user id, from a raw snowflake or from the `<@id>` a mention pastes as. */
export function parseUserId(value: string | undefined): string | undefined {
  const id = value?.trim().replace(/^<@!?/, '').replace(/>$/, '');

  return id && /^\d{5,}$/.test(id) ? id : undefined;
}

/** Rows shown in each top-N field. */
const STATS_ROWS = 5;

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
    // `stats @someone` and `/stats target:@someone` are the same request.
    const argument = (ctx.option('target') ?? ctx.args[0])?.trim();

    // Asked for nobody in particular, the answer is your own listening: it is
    // what someone running the command on themselves usually wants, and the
    // server's is a word away.
    const target = argument ? parseUserId(argument) : ctx.userId;

    if (argument && !target && !isServerWord(argument)) {
      await ctx.reply({
        content: `I do not know who **${argument}** is. Mention someone, or say **server**.`,
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
    const guildName = this.options.guildName?.(ctx.guildId);
    const since = `<t:${Math.floor(stats.since / 1000)}:D>`;

    await ctx.reply({
      title: `Stats${guildName ? ` — ${guildName}` : ''}`,
      icon: 'chart',
      content: `**${stats.totalPlays}** ${plural(stats.totalPlays, 'play')} · **${formatHours(stats.totalListenedMs)}** listened since ${since}${
        mine
          ? ` · You: **${mine.plays}** ${plural(mine.plays, 'play')}, **${formatHours(mine.listenedMs)}**`
          : ''
      }`,
      fields: [
        { name: 'Top tracks', value: this.trackLines(topTracks(stats, STATS_ROWS)) },
        { name: 'Top artists', value: this.artistLines(topArtists(stats, STATS_ROWS)) },
        { name: 'Top listeners', value: this.listenerLines(topListeners(stats, STATS_ROWS)) },
      ],
    });
  }

  private async showMember(ctx: CommandContext, stats: GuildStats, userId: string): Promise<void> {
    const theirs = statsFor(stats, userId);
    // "Someone" is a fair stand-in for a stranger, but not for the person
    // reading their own stats.
    const name = this.options.displayName?.(userId) ?? (userId === ctx.userId ? 'You' : 'Someone');

    if (!theirs) {
      // A reply of empty columns says less than the sentence does.
      const mine = userId === ctx.userId;
      await ctx.reply({
        content: mine
          ? 'You have not queued anything here yet. Play something, then ask again.'
          : `**${name}** has not queued anything here yet.`,
        title: 'Nothing to show',
        icon: 'list',
        tone: 'info',
        ephemeral: true,
      });
      return;
    }

    const rank = rankOf(stats, userId);

    await ctx.reply({
      title: `${name}'s stats`,
      icon: 'chart',
      content: `**${theirs.plays}** ${plural(theirs.plays, 'play')} · **${formatHours(theirs.listenedMs)}** listened${
        rank === undefined ? '' : ` · Rank **#${rank}** of ${stats.users.length}`
      }`,
      fields: [
        { name: 'Top tracks', value: this.trackLines(topTracksFor(stats, userId, STATS_ROWS)) },
        { name: 'Top artists', value: this.artistLines(topArtistsFor(stats, userId, STATS_ROWS)) },
      ],
    });
  }

  private trackLines(tracks: readonly TrackStat[]): string {
    if (tracks.length === 0) return 'Nothing yet.';
    return tracks
      .map((track, index) => `**${index + 1}.** ${track.title} — ${track.author} (${track.plays}×)`)
      .join('\n');
  }

  private artistLines(artists: readonly ArtistStat[]): string {
    if (artists.length === 0) return 'Nothing yet.';
    return artists
      .map(
        (artist, index) =>
          `**${index + 1}.** ${artist.author} — ${formatHours(artist.listenedMs)} (${artist.plays}×)`,
      )
      .join('\n');
  }

  /** The guild's top listeners, by total time. */
  private listenerLines(
    users: readonly { userId: string; listenedMs: number; plays: number }[],
  ): string {
    if (users.length === 0) return 'Nothing yet.';
    return users
      .map(
        (user, index) =>
          `**${index + 1}.** ${this.nameFor(user.userId)} — ${formatHours(user.listenedMs)} (${user.plays}×)`,
      )
      .join('\n');
  }

  /**
   * A display name, or a readable stand-in.
   *
   * A raw snowflake in a reply is unreadable, and it is somebody's account id —
   * neither belongs in something posted to a channel.
   */
  private nameFor(userId: string): string {
    return this.options.displayName?.(userId) ?? 'Someone';
  }
}

/** `1 play` / `2 plays`, so a reply does not have to say "play(s)". */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
