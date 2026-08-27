import type { ResolverRegistry, TrackCandidate } from '../../resolvers';
import { describeResolverError } from '../../resolvers';
import { createLogger } from '../../telemetry/logger';
import { formatDuration } from '../../ui/canvas';
import type { CommandContext } from '../commands';
import type { MusicService } from '../services/music.service';

const logger = createLogger('search-service');

/** Long enough to read the results and decide, short enough to be forgotten. */
export const SEARCH_TTL_MS = 120_000;

/** Results shown per search. */
const SEARCH_RESULT_ROWS = 5;

export interface SearchServiceOptions {
  /** Injectable so a test does not have to wait two minutes. */
  now?: () => number;
  /** How long a pending pick stays valid. */
  ttlMs?: number;
  /** Builds the pick buttons for a result card. */
  searchComponents?: (count: number) => unknown[];
}

interface Pending {
  query: string;
  candidates: TrackCandidate[];
  expiresAt: number;
}

/**
 * Search, then pick (spec §5).
 *
 * `play` takes the first result, which is right when you know what you want
 * and wrong when the first result is a cover, an hour-long mix, or the wrong
 * language. This shows what was found and lets the asker choose.
 *
 * A pending choice belongs to one person in one guild, so two people searching
 * at once do not pick from each other's lists — and pressing a button on
 * somebody else's card cannot queue anything.
 */
export class SearchService {
  private readonly pending = new Map<string, Pending>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly resolvers: ResolverRegistry,
    private readonly music: MusicService,
    private readonly options: SearchServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? SEARCH_TTL_MS;
  }

  async search(ctx: CommandContext, query: string): Promise<void> {
    const trimmed = query.trim();

    if (!trimmed) {
      await ctx.reply({
        content: 'Say what to look for, e.g. **search chăm hoa**.',
        title: 'Search for what?',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    let candidates: TrackCandidate[];
    try {
      candidates = await this.resolvers.search(trimmed);
    } catch (error) {
      logger.warn({ err: error, query: trimmed }, 'search failed');
      await ctx.reply({
        content: describeResolverError(error),
        title: 'Search failed',
        icon: 'warning',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

    const results = candidates.slice(0, SEARCH_RESULT_ROWS);

    if (results.length === 0) {
      await ctx.reply({
        content: `Nothing found for **${trimmed}**.`,
        title: 'No results',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    this.remember(ctx, { query: trimmed, candidates: results, expiresAt: this.now() + this.ttlMs });

    const list = results
      .map((candidate, index) => {
        const length = candidate.isStream ? 'LIVE' : formatDuration(candidate.durationMs);
        return `**${index + 1}.** ${candidate.title} — ${candidate.author} \`${length}\` · ${candidate.source}`;
      })
      .join('\n');

    await ctx.reply({
      title: `Search results for "${trimmed}"`,
      icon: 'search',
      fields: [{ name: 'Pick a number to queue it', value: list }],
      ...(this.options.searchComponents
        ? { components: this.options.searchComponents(results.length) }
        : {}),
    });
  }

  /**
   * Queues the numbered result, counting from 1 as the card does.
   *
   * Everything that can be wrong here — the wrong person, a stale card, a
   * number off the end — is answered privately, so a mis-press does not put a
   * notice in front of the whole channel.
   */
  async pick(ctx: CommandContext, choice: number): Promise<void> {
    const pending = this.take(ctx);

    if (!pending) {
      await ctx.reply({
        content: 'That search has expired, or it was somebody else’s. Run **search** again.',
        title: 'Nothing to pick',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    const candidate = pending.candidates[choice - 1];

    if (!candidate) {
      // Put the list back: they asked for a row that is not there, and losing
      // the whole search over a typo would be the harsher answer.
      this.remember(ctx, pending);
      await ctx.reply({
        content: `Pick a number from 1 to ${pending.candidates.length}.`,
        title: 'No such result',
        icon: 'search',
        ephemeral: true,
      });
      return;
    }

    if (!ctx.voiceChannelId) {
      this.remember(ctx, pending);
      await ctx.reply({
        content: 'Join a voice channel first, then pick again.',
        title: 'Which channel?',
        icon: 'info',
        ephemeral: true,
      });
      return;
    }

    await this.music.playCandidate(ctx, candidate);
  }

  /** Forgets a guild's pending searches, e.g. when its player goes away. */
  forget(guildId: string): void {
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${guildId}:`)) this.pending.delete(key);
    }
  }

  private remember(ctx: CommandContext, pending: Pending): void {
    this.sweep();
    this.pending.set(keyFor(ctx), pending);
  }

  /** Takes a still-valid pending search, removing it. */
  private take(ctx: CommandContext): Pending | undefined {
    const key = keyFor(ctx);
    const found = this.pending.get(key);
    this.pending.delete(key);

    return found && found.expiresAt > this.now() ? found : undefined;
  }

  /** Drops what has expired, so an unpicked search is not remembered forever. */
  private sweep(): void {
    const now = this.now();

    for (const [key, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(key);
    }
  }
}

/** One pending choice per person per guild. */
function keyFor(ctx: CommandContext): string {
  return `${ctx.guildId}:${ctx.userId}`;
}
