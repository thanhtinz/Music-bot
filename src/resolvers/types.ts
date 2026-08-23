import type { Source } from '../domain/music';

import type { ParsedInput } from './url';

/**
 * A track a resolver found, before it is bound to a requester.
 *
 * Resolvers deal in candidates; the application layer turns the chosen one into
 * a domain `Track` (spec §7.1).
 */
export interface TrackCandidate {
  source: Source;
  identifier: string;
  title: string;
  author: string;
  durationMs: number;
  uri?: string;
  artworkUrl?: string;
  isStream?: boolean;
  /** Source-specific extras, e.g. an ISRC carried over from Spotify. */
  metadata?: Record<string, unknown>;
}

export interface ResolvedPlaylist {
  name: string;
  source: Source;
  url?: string;
  tracks: TrackCandidate[];
  /** Set when the playlist was longer than the caller's limit. */
  truncated?: boolean;
  /** Total length before truncation. */
  totalCount?: number;
}

export interface ResolveOptions {
  /** Caps how many playlist entries are returned (spec §26). */
  maxPlaylistSize?: number;
  /** Sources the guild allows (spec §19). */
  allowedSources?: readonly Source[];
  /** Region hint passed to providers that support it. */
  region?: string;
}

/**
 * A source of tracks (spec §7.1).
 *
 * Every resolver takes already-parsed input, so URL classification happens once
 * rather than being re-implemented per source.
 */
export interface SourceResolver {
  /** Stable name used in logs, metrics and the circuit breaker. */
  readonly name: string;
  readonly source: Source;

  canHandle(input: ParsedInput): boolean;

  /** Free-text search. Only search providers implement this. */
  search?(query: string, options?: ResolveOptions): Promise<TrackCandidate[]>;

  resolveTrack(input: ParsedInput, options?: ResolveOptions): Promise<TrackCandidate | null>;

  resolvePlaylist?(input: ParsedInput, options?: ResolveOptions): Promise<ResolvedPlaylist | null>;
}

/**
 * The audio provider that can actually search and load playable tracks.
 *
 * With Lavalink this is the node's `loadTracks` endpoint; keeping it behind an
 * interface is what lets the Spotify resolver hand off a search without knowing
 * who serves it (spec §7.3).
 */
export interface TrackSearchClient {
  /** Searches the provider and returns candidates, best first. */
  search(query: string, options?: ResolveOptions): Promise<TrackCandidate[]>;
  /** Loads a URL the provider understands natively. */
  loadUrl(url: string, options?: ResolveOptions): Promise<TrackCandidate[]>;
  /** Loads a playlist URL, when the provider distinguishes them. */
  loadPlaylist?(url: string, options?: ResolveOptions): Promise<ResolvedPlaylist | null>;
}
