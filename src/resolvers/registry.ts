import type { Source } from '../domain/music';
import { createLogger } from '../telemetry/logger';

import { CircuitBreaker, retry, type CircuitBreakerOptions } from './circuit-breaker';
import { ResolverError } from './errors';
import type { ResolvedPlaylist, ResolveOptions, SourceResolver, TrackCandidate } from './types';
import { parseInput, type ParsedInput } from './url';

export type ResolveResult =
  | { kind: 'track'; track: TrackCandidate; input: ParsedInput }
  | { kind: 'playlist'; playlist: ResolvedPlaylist; input: ParsedInput }
  | { kind: 'empty'; input: ParsedInput };

export interface ResolverRegistryOptions {
  breaker?: CircuitBreakerOptions;
  /** Attempts per resolve, including the first. */
  retryAttempts?: number;
}

const logger = createLogger('resolver-registry');

/**
 * Routes input to the resolver that claims it (spec §7.4).
 *
 * Resolvers are tried in registration order, so the caller controls priority.
 * Each one runs behind its own circuit breaker: a flaky Spotify must not stop
 * YouTube links from working.
 */
export class ResolverRegistry {
  private readonly resolvers: SourceResolver[] = [];
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: ResolverRegistryOptions = {}) {}

  register(resolver: SourceResolver): void {
    if (this.resolvers.some((existing) => existing.name === resolver.name)) {
      throw new Error(`Duplicate resolver: ${resolver.name}`);
    }

    this.resolvers.push(resolver);
    this.breakers.set(resolver.name, new CircuitBreaker(resolver.name, this.options.breaker));
  }

  registerAll(resolvers: readonly SourceResolver[]): void {
    for (const resolver of resolvers) this.register(resolver);
  }

  list(): readonly SourceResolver[] {
    return this.resolvers;
  }

  /** Circuit state per resolver, for the metrics endpoint (spec §23.1). */
  health(): Record<string, string> {
    return Object.fromEntries([...this.breakers].map(([name, breaker]) => [name, breaker.status]));
  }

  /**
   * Resolves raw user input into a track or a playlist.
   *
   * Playlists win over tracks when the input names both — pasting a playlist
   * link means the playlist, even though its first video is also addressable.
   */
  async resolve(raw: string, options: ResolveOptions = {}): Promise<ResolveResult> {
    const input = parseInput(raw);

    if (options.allowedSources && !options.allowedSources.includes(input.source)) {
      throw new ResolverError('BLOCKED_SOURCE', `${input.source} is disabled on this server.`, {
        source: input.source,
      });
    }

    const resolver = this.resolvers.find((candidate) => candidate.canHandle(input));
    if (!resolver) {
      throw new ResolverError('INVALID_INPUT', 'Nothing here knows how to handle that link.', {
        source: input.source,
      });
    }

    return this.runWithResolver(resolver, input, options);
  }

  /** Searches every resolver that supports search, best-first per resolver. */
  async search(query: string, options: ResolveOptions = {}): Promise<TrackCandidate[]> {
    const searchable = this.resolvers.filter((resolver) => typeof resolver.search === 'function');

    const results = await Promise.all(
      searchable.map(async (resolver) => {
        try {
          return await this.guard(resolver, () => resolver.search!(query, options));
        } catch (error) {
          // One provider being down should not empty the whole result list.
          logger.warn({ err: error, resolver: resolver.name }, 'search failed');
          return [] as TrackCandidate[];
        }
      }),
    );

    return results.flat();
  }

  /** Sources with a registered resolver, for settings validation. */
  sources(): Source[] {
    return [...new Set(this.resolvers.map((resolver) => resolver.source))];
  }

  private async runWithResolver(
    resolver: SourceResolver,
    input: ParsedInput,
    options: ResolveOptions,
  ): Promise<ResolveResult> {
    const wantsPlaylist = input.kind.endsWith('-playlist') || input.kind === 'spotify-album';

    if (wantsPlaylist && resolver.resolvePlaylist) {
      const playlist = await this.guard(resolver, () => resolver.resolvePlaylist!(input, options));
      if (playlist && playlist.tracks.length > 0) return { kind: 'playlist', playlist, input };
      return { kind: 'empty', input };
    }

    const track = await this.guard(resolver, () => resolver.resolveTrack(input, options));
    return track ? { kind: 'track', track, input } : { kind: 'empty', input };
  }

  /** Runs resolver work behind its breaker, with bounded retries. */
  private async guard<T>(resolver: SourceResolver, work: () => Promise<T>): Promise<T> {
    const breaker = this.breakers.get(resolver.name);
    if (!breaker) return work();

    return retry(() => breaker.run(work), { attempts: this.options.retryAttempts ?? 2 });
  }
}
