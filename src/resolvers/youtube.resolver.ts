import { ResolverError } from './errors';
import type {
  ResolvedPlaylist,
  ResolveOptions,
  SourceResolver,
  TrackCandidate,
  TrackSearchClient,
} from './types';
import type { ParsedInput } from './url';

const DEFAULT_MAX_PLAYLIST = 500;

/**
 * Resolves YouTube URLs and free-text searches.
 *
 * All the actual loading goes through a {@link TrackSearchClient} — with
 * Lavalink that is the node's `loadTracks` endpoint. This class owns the rules
 * around it: which URL means what, playlist limits, and error classification
 * (spec §7.2).
 */
export class YouTubeResolver implements SourceResolver {
  readonly name = 'youtube';
  readonly source = 'youtube' as const;

  constructor(private readonly client: TrackSearchClient) {}

  canHandle(input: ParsedInput): boolean {
    return input.source === 'youtube';
  }

  async search(query: string, options: ResolveOptions = {}): Promise<TrackCandidate[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new ResolverError('INVALID_INPUT', 'Give me something to search for.', {
        source: this.name,
      });
    }

    return this.client.search(trimmed, options);
  }

  async resolveTrack(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (input.kind === 'search') {
      const results = await this.search(input.identifier, options);
      return results[0] ?? null;
    }

    if (input.kind !== 'youtube-video') return null;

    const url = input.url ?? `https://www.youtube.com/watch?v=${input.identifier}`;
    const results = await this.client.loadUrl(url, options);
    const track = results[0];

    if (!track) {
      throw new ResolverError('UNAVAILABLE', 'That video is unavailable or private.', {
        source: this.name,
      });
    }

    // A watch URL carrying `?t=` should start where the user pointed.
    return input.startMs
      ? { ...track, metadata: { ...track.metadata, startMs: input.startMs } }
      : track;
  }

  async resolvePlaylist(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<ResolvedPlaylist | null> {
    // A watch URL inside a playlist resolves to the playlist only when the user
    // pasted the playlist itself; otherwise they asked for that one video.
    if (input.kind !== 'youtube-playlist') return null;

    const url = input.url ?? `https://www.youtube.com/playlist?list=${input.identifier}`;

    if (!this.client.loadPlaylist) {
      const tracks = await this.client.loadUrl(url, options);
      return this.trim({ name: 'YouTube playlist', source: this.source, url, tracks }, options);
    }

    const playlist = await this.client.loadPlaylist(url, options);
    if (!playlist) {
      throw new ResolverError('NOT_FOUND', 'That playlist could not be loaded.', {
        source: this.name,
      });
    }

    return this.trim(playlist, options);
  }

  /** Applies the caller's playlist cap and records that it was applied. */
  private trim(playlist: ResolvedPlaylist, options: ResolveOptions): ResolvedPlaylist {
    const limit = Math.max(1, options.maxPlaylistSize ?? DEFAULT_MAX_PLAYLIST);
    const total = playlist.totalCount ?? playlist.tracks.length;

    if (playlist.tracks.length <= limit) {
      return { ...playlist, totalCount: total, truncated: total > playlist.tracks.length };
    }

    return {
      ...playlist,
      tracks: playlist.tracks.slice(0, limit),
      totalCount: total,
      truncated: true,
    };
  }
}
