import { AUTOPLAY_REQUESTER_ID, createTrack, trackKey, type Track } from '../../domain/music';
import type { ResolverRegistry, TrackCandidate } from '../../resolvers';
import { createLogger } from '../../telemetry/logger';

const logger = createLogger('autoplay');

/**
 * Anything longer than this is a mix, a full album, or a two-hour "lofi to
 * study to" — a reasonable thing to ask for and a poor thing to be given.
 */
export const AUTOPLAY_MAX_DURATION_MS = 15 * 60_000;

/** How many past suggestions to remember, so autoplay does not circle back. */
export const AUTOPLAY_MEMORY = 40;

export interface AutoplaySelectorOptions {
  /** Longest track autoplay will pick. */
  maxDurationMs?: number;
  /** How many recent picks to keep out of the running. */
  memory?: number;
}

/**
 * Picks something to play when the queue runs out.
 *
 * There is no recommendation API behind this: it searches for the seed track's
 * artist and takes the best result that is not something we just played. That
 * is a weaker suggestion than a real "related tracks" feed would be, and it
 * needs no key, no account and no second provider — which is the same trade
 * the lyrics provider makes.
 */
export class AutoplaySelector {
  /** Recently suggested keys per guild, newest last. */
  private readonly recent = new Map<string, string[]>();
  private readonly maxDurationMs: number;
  private readonly memory: number;

  constructor(
    private readonly resolvers: ResolverRegistry,
    options: AutoplaySelectorOptions = {},
  ) {
    this.maxDurationMs = options.maxDurationMs ?? AUTOPLAY_MAX_DURATION_MS;
    this.memory = options.memory ?? AUTOPLAY_MEMORY;
  }

  /**
   * Suggests a track to follow `seed`, or nothing if it cannot.
   *
   * `avoid` is what the guild has heard lately — the history and whatever is
   * still queued — so a suggestion is never a track the room just sat through.
   */
  async suggest(
    guildId: string,
    seed: Track,
    avoid: readonly Track[] = [],
  ): Promise<Track | undefined> {
    const seen = new Set<string>([
      trackKey(seed),
      ...avoid.map(trackKey),
      ...(this.recent.get(guildId) ?? []),
    ]);

    for (const query of queriesFor(seed)) {
      const candidates = await this.search(query);
      const pick = candidates.find((candidate) => this.isSuitable(candidate, seen));

      if (pick) {
        this.remember(guildId, candidateKey(pick));
        logger.info({ guildId, query, track: pick.title }, 'autoplay picked a track');

        return createTrack({
          source: pick.source,
          identifier: pick.identifier,
          title: pick.title,
          author: pick.author,
          durationMs: pick.durationMs,
          uri: pick.uri,
          artworkUrl: pick.artworkUrl,
          isStream: pick.isStream,
          // Not credited to the person who queued the seed: they did not ask
          // for this one.
          requesterId: AUTOPLAY_REQUESTER_ID,
          metadata: { ...pick.metadata, autoplaySeed: trackKey(seed) },
        });
      }
    }

    logger.info({ guildId, seed: seed.title }, 'autoplay found nothing to play');
    return undefined;
  }

  /** Forgets a guild's recent picks, e.g. when its player goes away. */
  forget(guildId: string): void {
    this.recent.delete(guildId);
  }

  private async search(query: string): Promise<TrackCandidate[]> {
    try {
      return await this.resolvers.search(query);
    } catch (error) {
      // Autoplay is a convenience; a search that fails ends the queue quietly
      // rather than surfacing an error nobody asked for.
      logger.warn({ err: error, query }, 'autoplay search failed');
      return [];
    }
  }

  private isSuitable(candidate: TrackCandidate, seen: Set<string>): boolean {
    if (candidate.isStream) return false;
    if (candidate.durationMs <= 0 || candidate.durationMs > this.maxDurationMs) return false;

    return !seen.has(candidateKey(candidate));
  }

  private remember(guildId: string, key: string): void {
    const keys = this.recent.get(guildId) ?? [];
    keys.push(key);

    this.recent.set(guildId, keys.slice(-this.memory));
  }
}

/** The same key {@link trackKey} gives, for something not yet a track. */
function candidateKey(candidate: TrackCandidate): string {
  return `${candidate.source}:${candidate.identifier}`;
}

/**
 * Search terms to try, best first.
 *
 * The artist alone is the strongest signal available without a recommendation
 * API; the title is the fallback for a track whose artist field is a channel
 * name, or empty.
 */
export function queriesFor(seed: Track): string[] {
  // `createTrack` fills a blank field with a placeholder, and searching for
  // the literal words "Unknown artist" would return somebody's joke upload.
  const author = usable(seed.author) ? seed.author.trim() : '';
  const title = usable(seed.title) ? cleanTitle(seed.title) : '';

  const queries = [author, `${author} ${title}`.trim(), title]
    .map((query) => query.trim())
    .filter((query) => query.length > 1);

  return [...new Set(queries)];
}

/** Placeholders stand in for a missing field; they are not search terms. */
function usable(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed !== '' && trimmed !== 'unknown artist' && trimmed !== 'unknown title';
}

/** Strips the decorations uploads carry, so the words left are the song. */
function cleanTitle(title: string): string {
  return title
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\b(official|lyrics?|audio|video|mv|hd|4k|remaster(ed)?)\b/gi, ' ')
    .replace(/[|·–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
