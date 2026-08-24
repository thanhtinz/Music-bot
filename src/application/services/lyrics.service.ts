import type { Lyrics, LyricsProvider } from '../../lyrics';
import { describeResolverError, ResolverError } from '../../resolvers';
import { createLogger } from '../../telemetry/logger';
import {
  activeLyricLine,
  cardFile,
  paginateLyrics,
  paginateSyncedLyrics,
  renderSakuraLyricsCard,
  type LyricsPageLine,
} from '../../ui/canvas';
import type { CommandContext } from '../commands';

import type { MusicService } from './music.service';

const logger = createLogger('lyrics-service');

/** A lookup, and the track it was made for when it was made for one. */
interface Lookup {
  lyrics: Lyrics;
  trackId?: string;
}

/**
 * The pages of a transcript, timed or not.
 *
 * One shape either way, so the renderer does not have to know which kind it was
 * handed — the timings only ever change which line lights up.
 */
function pagesOf(lyrics: Lyrics): { pages: LyricsPageLine[][]; totalPages: number } {
  if (lyrics.timings?.length) return paginateSyncedLyrics(lyrics.timings);

  const plain = paginateLyrics(lyrics.text);
  return {
    pages: plain.pages.map((page) => page.map((text) => ({ text }))),
    totalPages: plain.totalPages,
  };
}

export interface LyricsServiceOptions {
  /** Builds the button rows attached to a lyrics page. */
  pageComponents?: (page: number, totalPages: number) => unknown[];
}

/**
 * Lyrics for the current track, or for a search (spec §12).
 *
 * The last lookup is remembered per guild so the page buttons have something to
 * turn: re-fetching on every press would spend a request on a page the bot is
 * already holding.
 */
export class LyricsService {
  private readonly lastLookup = new Map<string, Lookup>();

  constructor(
    private readonly provider: LyricsProvider,
    private readonly music: MusicService,
    private readonly options: LyricsServiceOptions = {},
  ) {}

  async show(ctx: CommandContext, query: string): Promise<void> {
    const wanted = query.trim();
    const current = this.music.currentTrack(ctx.guildId);

    if (!wanted && !current) {
      await ctx.reply({
        content: 'Nothing is playing. Give me a song name to look up.',
        title: 'Which song?',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    try {
      const lyrics = wanted
        ? await this.provider.find({ title: wanted })
        : await this.provider.find({
            title: current!.title,
            artist: current!.author,
            durationMs: current!.durationMs,
          });

      if (!lyrics) {
        await ctx.reply({
          content: `No lyrics found for **${wanted || current!.title}**.`,
          title: 'No lyrics',
          icon: 'search',
          ephemeral: true,
        });
        return;
      }

      // Remembered against the track it was looked up for, so a page turn can
      // tell "the words to what is playing" from "the words to something
      // somebody searched for" — only the first should follow the music.
      const remembered: Lookup = { lyrics, ...(wanted ? {} : { trackId: current?.id }) };
      this.lastLookup.set(ctx.guildId, remembered);

      // A timed transcript opens where the music is rather than at the top: a
      // song three minutes in has its words on page two, and asking somebody to
      // find them is asking them to do the bot's job.
      await this.render(ctx, remembered, this.followedLine(ctx, remembered)?.page ?? 1);
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /**
   * Where in the transcript the music is, when it makes sense to say.
   *
   * Three things have to hold: the words are timed, they are the words to what
   * is playing, and that is still the track it was looked up for — a queue that
   * has moved on is a card about a different song.
   */
  private followedLine(
    ctx: CommandContext,
    lookup: Lookup,
  ): { page: number; line: number } | undefined {
    const timings = lookup.lyrics.timings;
    if (!timings?.length || !lookup.trackId) return undefined;
    if (this.music.currentTrack(ctx.guildId)?.id !== lookup.trackId) return undefined;

    const positionMs = this.music.currentPositionMs(ctx.guildId);
    if (positionMs === undefined) return undefined;

    return activeLyricLine(paginateSyncedLyrics(timings).pages, positionMs);
  }

  /** Turns to another page of the lyrics already fetched. */
  async page(ctx: CommandContext, page: number): Promise<void> {
    const lookup = this.lastLookup.get(ctx.guildId);

    if (!lookup) {
      await ctx.reply({
        content: 'That lookup has expired. Run `lyrics` again.',
        title: 'Gone',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    await this.render(ctx, lookup, page);
  }

  private async render(ctx: CommandContext, lookup: Lookup, page: number): Promise<void> {
    const { lyrics } = lookup;
    const { pages, totalPages } = pagesOf(lyrics);
    const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);

    // Only when the reader is looking at the page the music is on: paging away
    // is a deliberate act, and lighting up a line two pages back would be the
    // card arguing with the person turning it.
    const followed = this.followedLine(ctx, lookup);
    const activeLine = followed?.page === current ? { activeLine: followed.line } : {};

    const card = await renderSakuraLyricsCard({
      title: lyrics.title,
      artist: lyrics.artist,
      lines: (pages[current - 1] ?? []).map((line) => line.text),
      page: current,
      totalPages,
      provider: lyrics.provider,
      ...activeLine,
    });

    await ctx.reply({
      attachments: [{ name: cardFile('lyrics'), data: card }],
      components: this.options.pageComponents?.(current, totalPages),
    });
  }

  private async replyWithError(ctx: CommandContext, error: unknown): Promise<void> {
    if (error instanceof ResolverError) {
      await ctx.reply({
        content: describeResolverError(error),
        title: 'Lyrics unavailable',
        icon: 'search',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

    logger.error({ err: error, guildId: ctx.guildId }, 'lyrics lookup failed');
    await ctx.reply({
      content: 'Could not reach the lyrics service. Try again in a moment.',
      title: 'That did not work',
      tone: 'error',
      ephemeral: true,
    });
  }
}
