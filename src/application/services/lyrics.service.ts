import type { Lyrics, LyricsProvider } from '../../lyrics';
import { describeResolverError, ResolverError } from '../../resolvers';
import { createLogger } from '../../telemetry/logger';
import { paginateLyrics, renderSakuraLyricsCard } from '../../ui/canvas';
import type { CommandContext } from '../commands';

import type { MusicService } from './music.service';

const logger = createLogger('lyrics-service');

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
  private readonly lastLookup = new Map<string, Lyrics>();

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

      this.lastLookup.set(ctx.guildId, lyrics);
      await this.render(ctx, lyrics, 1);
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /** Turns to another page of the lyrics already fetched. */
  async page(ctx: CommandContext, page: number): Promise<void> {
    const lyrics = this.lastLookup.get(ctx.guildId);

    if (!lyrics) {
      await ctx.reply({
        content: 'That lookup has expired. Run `lyrics` again.',
        title: 'Gone',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    await this.render(ctx, lyrics, page);
  }

  private async render(ctx: CommandContext, lyrics: Lyrics, page: number): Promise<void> {
    const { pages, totalPages } = paginateLyrics(lyrics.text);
    const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);

    const card = await renderSakuraLyricsCard({
      title: lyrics.title,
      artist: lyrics.artist,
      lines: pages[current - 1] ?? [],
      page: current,
      totalPages,
      provider: lyrics.provider,
    });

    await ctx.reply({
      attachments: [{ name: 'lyrics.png', data: card }],
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
