import { CircuitBreaker, ResolverError, withTimeout } from '../resolvers';
import { createLogger } from '../telemetry/logger';

import {
  primaryArtist,
  searchableTitle,
  type Lyrics,
  type LyricsProvider,
  type LyricsQuery,
} from './lyrics-provider';

const logger = createLogger('lrclib');

const BASE_URL = 'https://lrclib.net/api';
const TIMEOUT_MS = 6_000;
/** Enough for any song; a reply that large is a bug, not a ballad. */
const MAX_BYTES = 512_000;

/** The subset of LRCLIB's response this uses. */
interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

export interface LrclibOptions {
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch;
  breaker?: CircuitBreaker;
  timeoutMs?: number;
  /** Sent so the service can see who is calling, as its docs ask. */
  userAgent?: string;
}

/**
 * Lyrics from LRCLIB.
 *
 * Chosen because it needs no key and no account, which keeps running this bot a
 * matter of a token and a Lavalink node. It is wrapped in the same breaker and
 * timeout the track resolvers use: a lyrics service having a bad day must not
 * hold a command open until Discord expires the interaction.
 */
export class LrclibProvider implements LyricsProvider {
  readonly name = 'LRCLIB';

  private readonly fetchImpl: typeof fetch;
  private readonly breaker: CircuitBreaker;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: LrclibOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.breaker = options.breaker ?? new CircuitBreaker('lrclib');
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.userAgent = options.userAgent ?? 'melody-music-bot';
  }

  async find(query: LyricsQuery): Promise<Lyrics | undefined> {
    const title = searchableTitle(query.title);
    if (!title) return undefined;

    const artist = query.artist ? primaryArtist(query.artist) : undefined;

    const record = await this.breaker.run(() =>
      withTimeout((signal) => this.search(title, artist, signal), this.timeoutMs, this.name),
    );

    if (!record) return undefined;
    if (record.instrumental) {
      return {
        title: record.trackName ?? query.title,
        artist: record.artistName ?? query.artist ?? '',
        text: '♪ Instrumental ♪',
        provider: this.name,
      };
    }

    // A synced file is `[mm:ss.xx] line`; the timestamps are stripped rather
    // than shown, because the card has no way to follow along yet.
    const synced = record.syncedLyrics?.trim();
    const plain = record.plainLyrics?.trim();
    const text = plain || (synced ? stripTimestamps(synced) : '');

    if (!text) return undefined;

    return {
      title: record.trackName ?? query.title,
      artist: record.artistName ?? query.artist ?? '',
      text,
      provider: this.name,
      ...(plain ? {} : { synced: true }),
    };
  }

  private async search(
    title: string,
    artist: string | undefined,
    signal: AbortSignal,
  ): Promise<LrclibRecord | undefined> {
    const url = new URL(`${BASE_URL}/search`);
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);

    const response = await this.fetchImpl(url, {
      signal,
      headers: { accept: 'application/json', 'user-agent': this.userAgent },
    });

    if (response.status === 404) return undefined;
    if (response.status === 429) {
      throw new ResolverError('RATE_LIMITED', `${this.name} is rate limiting us.`, {
        source: this.name,
      });
    }
    if (!response.ok) {
      throw new ResolverError('PROVIDER_ERROR', `${this.name} answered ${response.status}.`, {
        source: this.name,
      });
    }

    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) {
      throw new ResolverError('PROVIDER_ERROR', `${this.name} sent more than we will read.`, {
        source: this.name,
      });
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return undefined;

    // The first hit with usable words. The API sorts by relevance, but its top
    // result is sometimes an instrumental entry with nothing in it.
    const records = body as LrclibRecord[];
    const usable = records.find(
      (record) => record.instrumental || record.plainLyrics?.trim() || record.syncedLyrics?.trim(),
    );

    if (!usable) logger.debug({ title, artist }, 'no usable lyrics in the response');
    return usable;
  }
}

/** Turns `[00:12.34] line` into `line`. */
export function stripTimestamps(synced: string): string {
  return synced
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '').trimEnd())
    .join('\n')
    .trim();
}
