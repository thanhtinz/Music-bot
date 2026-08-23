import { ResolverError } from './errors';
import type {
  ResolvedPlaylist,
  ResolveOptions,
  SourceResolver,
  TrackCandidate,
  TrackSearchClient,
} from './types';
import type { ParsedInput } from './url';

/** Track metadata as returned by a Spotify metadata client. */
export interface SpotifyTrackMetadata {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
  isrc?: string;
  artworkUrl?: string;
  album?: string;
}

export interface SpotifyCollectionMetadata {
  id: string;
  name: string;
  tracks: SpotifyTrackMetadata[];
  totalCount?: number;
}

/**
 * The slice of the Spotify Web API this resolver needs.
 *
 * Metadata only — Spotify is never treated as a place to fetch audio from
 * (spec §7.3, §38).
 */
export interface SpotifyMetadataClient {
  getTrack(id: string): Promise<SpotifyTrackMetadata | null>;
  getAlbum(id: string): Promise<SpotifyCollectionMetadata | null>;
  getPlaylist(id: string): Promise<SpotifyCollectionMetadata | null>;
}

const DEFAULT_MAX_PLAYLIST = 500;

/**
 * Builds the search query used to find a playable copy of a Spotify track.
 *
 * ISRC is preferred where the audio provider indexes it, because artist/title
 * matching happily returns covers, live versions and sped-up edits.
 */
export function buildSearchQuery(track: SpotifyTrackMetadata): string {
  if (track.isrc) return `isrc:${track.isrc}`;

  const artist = track.artists[0] ?? '';
  const title = stripDecorations(track.title);
  return [artist, title].filter(Boolean).join(' - ').trim() || track.title;
}

/**
 * Removes remaster/edition noise that hurts matching.
 *
 * `Song (2011 Remaster)` matches far worse than `Song`, and the extra words are
 * not what the user asked for.
 */
function stripDecorations(title: string): string {
  return title
    .replace(
      /\s*[([][^)\]]*(remaster|remastered|deluxe|edition|version|mono|stereo)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s*-\s*(\d{4}\s*)?remaster(ed)?.*$/i, '')
    .trim();
}

/**
 * Scores how well a candidate matches the Spotify metadata, 0..1.
 *
 * The first search hit is often a lyric video or a remix; a duration check plus
 * a title check catches the worst of it (spec §7.3).
 */
export function scoreCandidate(track: SpotifyTrackMetadata, candidate: TrackCandidate): number {
  let score = 0;

  const title = candidate.title.toLowerCase();
  const wanted = stripDecorations(track.title).toLowerCase();
  if (title.includes(wanted)) score += 0.5;

  const artist = (track.artists[0] ?? '').toLowerCase();
  if (artist && (candidate.author.toLowerCase().includes(artist) || title.includes(artist))) {
    score += 0.25;
  }

  if (track.durationMs > 0 && candidate.durationMs > 0) {
    const drift = Math.abs(candidate.durationMs - track.durationMs);
    if (drift <= 3_000) score += 0.25;
    else if (drift <= 10_000) score += 0.12;
  }

  // Explicitly de-rank the usual mismatches.
  if (/\b(cover|karaoke|instrumental|sped\s*up|nightcore|8d)\b/.test(title)) score -= 0.4;

  return Math.max(0, Math.min(1, score));
}

/**
 * Resolves Spotify links to playable audio from another source.
 *
 * Reads metadata from Spotify, then asks the audio provider for the best match
 * while keeping Spotify's title, artist and artwork so the Now Playing panel
 * shows what the user actually asked for (spec §7.3).
 */
export class SpotifyResolver implements SourceResolver {
  readonly name = 'spotify';
  readonly source = 'spotify' as const;

  constructor(
    private readonly metadata: SpotifyMetadataClient,
    private readonly audio: TrackSearchClient,
  ) {}

  canHandle(input: ParsedInput): boolean {
    return input.source === 'spotify';
  }

  async resolveTrack(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (input.kind !== 'spotify-track') return null;

    const track = await this.metadata.getTrack(input.identifier);
    if (!track) {
      throw new ResolverError('NOT_FOUND', 'That Spotify track could not be found.', {
        source: this.name,
      });
    }

    return this.findPlayable(track, options);
  }

  async resolvePlaylist(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<ResolvedPlaylist | null> {
    if (input.kind !== 'spotify-album' && input.kind !== 'spotify-playlist') return null;

    const collection =
      input.kind === 'spotify-album'
        ? await this.metadata.getAlbum(input.identifier)
        : await this.metadata.getPlaylist(input.identifier);

    if (!collection) {
      throw new ResolverError('NOT_FOUND', 'That Spotify link could not be found.', {
        source: this.name,
      });
    }

    const limit = Math.max(1, options.maxPlaylistSize ?? DEFAULT_MAX_PLAYLIST);
    const selected = collection.tracks.slice(0, limit);

    // Each entry keeps Spotify's metadata; the audio lookup happens lazily when
    // the track reaches the front of the queue, so importing a 500-track
    // playlist does not fire 500 searches up front.
    const tracks = selected.map((track) => this.asPendingCandidate(track));

    return {
      name: collection.name,
      source: this.source,
      url: input.url,
      tracks,
      totalCount: collection.totalCount ?? collection.tracks.length,
      truncated: (collection.totalCount ?? collection.tracks.length) > selected.length,
    };
  }

  /**
   * Searches the audio provider and picks the best-scoring candidate.
   *
   * Exposed so a queued Spotify entry can be turned into playable audio at the
   * moment it starts, rather than at import time.
   */
  async findPlayable(
    track: SpotifyTrackMetadata,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate> {
    const candidates = await this.audio.search(buildSearchQuery(track), options);

    if (candidates.length === 0 && track.isrc) {
      // ISRC is exact but not every provider indexes it; fall back to text.
      const fallback = await this.audio.search(
        buildSearchQuery({ ...track, isrc: undefined }),
        options,
      );
      candidates.push(...fallback);
    }

    if (candidates.length === 0) {
      throw new ResolverError('NOT_FOUND', `No playable source found for “${track.title}”.`, {
        source: this.name,
      });
    }

    const best = candidates.reduce((winner, candidate) =>
      scoreCandidate(track, candidate) > scoreCandidate(track, winner) ? candidate : winner,
    );

    return {
      ...best,
      // Spotify's metadata is the better display data, so it wins on the card,
      // while the identifier and URI stay those of the playable source.
      title: track.title,
      author: track.artists.join(', ') || best.author,
      artworkUrl: track.artworkUrl ?? best.artworkUrl,
      metadata: {
        ...best.metadata,
        spotifyId: track.id,
        isrc: track.isrc,
        album: track.album,
        resolvedFrom: 'spotify',
        playbackSource: best.source,
      },
    };
  }

  /** A queue entry that still needs an audio lookup before it can play. */
  private asPendingCandidate(track: SpotifyTrackMetadata): TrackCandidate {
    return {
      source: this.source,
      identifier: track.id,
      title: track.title,
      author: track.artists.join(', '),
      durationMs: track.durationMs,
      uri: `https://open.spotify.com/track/${track.id}`,
      artworkUrl: track.artworkUrl,
      metadata: {
        spotifyId: track.id,
        isrc: track.isrc,
        album: track.album,
        /** Signals that `findPlayable` still has to run for this entry. */
        needsAudioLookup: true,
      },
    };
  }
}
