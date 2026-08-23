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
 * Resolves Spotify links through the audio node.
 *
 * Lavalink's LavaSrc plugin already reads Spotify's API and hands back playable
 * tracks with Spotify's own title, artist and artwork. Doing that a second time
 * in the bot would mean a second set of credentials, a second token cache and a
 * second thing to keep current — so this resolver only decides what a link
 * means and passes it on (spec §7.3).
 *
 * With no such plugin on the node the load comes back empty, which is reported
 * as the link being unsupported rather than as a missing track: the difference
 * matters to whoever has to fix it.
 */
export class LavaSrcResolver implements SourceResolver {
  readonly name = 'lavasrc';
  readonly source = 'spotify' as const;

  constructor(private readonly client: TrackSearchClient) {}

  canHandle(input: ParsedInput): boolean {
    return input.source === 'spotify';
  }

  async resolveTrack(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (input.kind !== 'spotify-track') return null;

    const url = input.url ?? `https://open.spotify.com/track/${input.identifier}`;
    const results = await this.client.loadUrl(url, options);
    const track = results[0];

    if (!track) throw this.unsupported();

    return track;
  }

  async resolvePlaylist(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<ResolvedPlaylist | null> {
    if (input.kind !== 'spotify-album' && input.kind !== 'spotify-playlist') return null;

    const type = input.kind === 'spotify-album' ? 'album' : 'playlist';
    const url = input.url ?? `https://open.spotify.com/${type}/${input.identifier}`;
    const limit = Math.max(1, options.maxPlaylistSize ?? DEFAULT_MAX_PLAYLIST);

    if (this.client.loadPlaylist) {
      const playlist = await this.client.loadPlaylist(url, options);
      if (!playlist) throw this.unsupported();

      const tracks = playlist.tracks.slice(0, limit);

      return {
        ...playlist,
        source: this.source,
        tracks,
        totalCount: playlist.totalCount ?? playlist.tracks.length,
        truncated: (playlist.totalCount ?? playlist.tracks.length) > tracks.length,
      };
    }

    // A node that does not separate playlists from tracks still returns every
    // track of one, so the album keeps its name from the link rather than the
    // response.
    const loaded = await this.client.loadUrl(url, options);
    if (loaded.length === 0) throw this.unsupported();

    const tracks = loaded.slice(0, limit);

    return {
      name: `Spotify ${type}`,
      source: this.source,
      url,
      tracks,
      totalCount: loaded.length,
      truncated: loaded.length > tracks.length,
    };
  }

  /**
   * A load that came back with nothing.
   *
   * Almost always the node has no LavaSrc plugin, or its Spotify credentials
   * are missing — an operator problem, and saying "unavailable" would send
   * whoever reads it looking at the wrong thing.
   */
  private unsupported(): ResolverError {
    return new ResolverError(
      'UNAVAILABLE',
      // Short enough for the notice card, which holds two lines.
      'Spotify links are not enabled on the audio node. Ask an admin.',
      { source: this.name, userFacing: true },
    );
  }
}
