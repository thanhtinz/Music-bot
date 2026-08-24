import type { Source } from '../domain/music';

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

/** The sources LavaSrc resolves, and what to call each one in a message. */
const PLUGIN_SOURCES: Record<string, { label: string }> = {
  spotify: { label: 'Spotify' },
  applemusic: { label: 'Apple Music' },
  deezer: { label: 'Deezer' },
};

/**
 * Resolves Spotify, Apple Music and Deezer links through the audio node.
 *
 * Lavalink's LavaSrc plugin already reads each service's API and hands back
 * playable tracks with that service's own title, artist and artwork. Doing that
 * a second time in the bot would mean a second set of credentials, a second
 * token cache and a second thing to keep current — so this resolver only
 * decides what a link means and passes it on (spec §7.3).
 *
 * With no such plugin on the node the load comes back empty, which is reported
 * as the link being unsupported rather than as a missing track: the difference
 * matters to whoever has to fix it. The message names the service, because a
 * node can be set up for one of these and not the others.
 */
export class LavaSrcResolver implements SourceResolver {
  readonly name = 'lavasrc';
  /** The source a bare search would use; links carry their own. */
  readonly source = 'spotify' as const;

  constructor(private readonly client: TrackSearchClient) {}

  canHandle(input: ParsedInput): boolean {
    return input.source in PLUGIN_SOURCES;
  }

  async resolveTrack(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (!input.kind.endsWith('-track')) return null;
    if (!this.canHandle(input)) return null;

    const url = input.url ?? this.urlFor(input, 'track');
    const results = await this.client.loadUrl(url, options);
    const track = results[0];

    if (!track) throw this.unsupported(input.source);

    return track;
  }

  async resolvePlaylist(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<ResolvedPlaylist | null> {
    if (!this.canHandle(input)) return null;

    const type = input.kind.endsWith('-album')
      ? 'album'
      : input.kind.endsWith('-playlist')
        ? 'playlist'
        : undefined;
    if (!type) return null;

    const url = input.url ?? this.urlFor(input, type);
    const limit = Math.max(1, options.maxPlaylistSize ?? DEFAULT_MAX_PLAYLIST);

    if (this.client.loadPlaylist) {
      const playlist = await this.client.loadPlaylist(url, options);
      if (!playlist) throw this.unsupported(input.source);

      const tracks = playlist.tracks.slice(0, limit);

      return {
        ...playlist,
        source: input.source,
        tracks,
        totalCount: playlist.totalCount ?? playlist.tracks.length,
        truncated: (playlist.totalCount ?? playlist.tracks.length) > tracks.length,
      };
    }

    // A node that does not separate playlists from tracks still returns every
    // track of one, so the album keeps its name from the link rather than the
    // response.
    const loaded = await this.client.loadUrl(url, options);
    if (loaded.length === 0) throw this.unsupported(input.source);

    const tracks = loaded.slice(0, limit);

    return {
      name: `${labelFor(input.source)} ${type}`,
      source: input.source,
      url,
      tracks,
      totalCount: loaded.length,
      truncated: loaded.length > tracks.length,
    };
  }

  /**
   * Rebuilds a link from an id, for input that arrived as a URI rather than a
   * URL — `spotify:track:…` being the one people actually paste.
   */
  private urlFor(input: ParsedInput, type: string): string {
    if (input.source === 'deezer') return `https://www.deezer.com/${type}/${input.identifier}`;
    if (input.source === 'applemusic') {
      return `https://music.apple.com/us/${type}/${input.identifier}`;
    }

    return `https://open.spotify.com/${type}/${input.identifier}`;
  }

  /**
   * A load that came back with nothing.
   *
   * Almost always the node has no LavaSrc plugin, or that service's credentials
   * are missing — an operator problem, and saying "unavailable" would send
   * whoever reads it looking at the wrong thing. The service is named because a
   * node is often set up for one of them and not the others.
   */
  private unsupported(source: Source): ResolverError {
    return new ResolverError(
      'UNAVAILABLE',
      // Short enough for the notice card, which holds two lines.
      `${labelFor(source)} links are not enabled on the audio node. Ask an admin.`,
      { source: this.name, userFacing: true },
    );
  }
}

function labelFor(source: Source): string {
  return PLUGIN_SOURCES[source]?.label ?? source;
}
