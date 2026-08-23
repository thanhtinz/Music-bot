import { ResolverError } from './errors';
import type { ResolveOptions, SourceResolver, TrackCandidate } from './types';
import { looksLikeAudioStream, type ParsedInput } from './url';

export interface RadioStation {
  /** Preset key used by `/play lofi`. */
  key: string;
  name: string;
  url: string;
  genre?: string;
}

export interface RadioResolverOptions {
  /**
   * Hosts allowed to be streamed.
   *
   * Playing an arbitrary URL makes the bot fetch whatever a user names, which
   * is a server-side request forgery primitive; the allowlist is what stops it
   * (spec §25).
   */
  allowedHosts?: readonly string[];
  stations?: readonly RadioStation[];
}

/** Stations available out of the box (spec §16). */
export const DEFAULT_STATIONS: readonly RadioStation[] = [
  {
    key: 'lofi',
    name: 'Lo-fi Beats',
    url: 'https://ice1.somafm.com/groovesalad-128-mp3',
    genre: 'lofi',
  },
  {
    key: 'chill',
    name: 'Chill Out',
    url: 'https://ice1.somafm.com/dronezone-128-mp3',
    genre: 'chill',
  },
  {
    key: 'jazz',
    name: 'Jazz',
    url: 'https://ice1.somafm.com/sonicuniverse-128-mp3',
    genre: 'jazz',
  },
  {
    key: 'indie',
    name: 'Indie Pop',
    url: 'https://ice1.somafm.com/indiepop-128-mp3',
    genre: 'indie',
  },
];

/** Hosts allowed when the caller does not configure its own list. */
const DEFAULT_ALLOWED_HOSTS = ['ice1.somafm.com', 'ice2.somafm.com', 'somafm.com'];

/**
 * Resolves radio presets and direct stream URLs.
 *
 * Streams have no duration and never end on their own, so they are marked
 * `isStream` and the player treats them accordingly (spec §16).
 */
export class RadioResolver implements SourceResolver {
  readonly name = 'radio';
  readonly source = 'radio' as const;

  private readonly allowedHosts: readonly string[];
  private readonly stations: readonly RadioStation[];

  constructor(options: RadioResolverOptions = {}) {
    this.allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
    this.stations = options.stations ?? DEFAULT_STATIONS;
  }

  canHandle(input: ParsedInput): boolean {
    if (input.kind === 'http-stream') return true;
    return input.kind === 'search' && this.findStation(input.identifier) !== undefined;
  }

  async resolveTrack(
    input: ParsedInput,
    _options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (input.kind === 'search') {
      const station = this.findStation(input.identifier);
      return station ? this.asCandidate(station.url, station.name, station.genre) : null;
    }

    if (input.kind !== 'http-stream') return null;

    const url = input.url ?? input.identifier;
    if (!this.isAllowed(url)) {
      throw new ResolverError('BLOCKED_SOURCE', `Streaming from that host is not allowed.`, {
        source: this.name,
      });
    }

    const station = this.stations.find((entry) => entry.url === url);
    return this.asCandidate(url, station?.name ?? describeUrl(url), station?.genre);
  }

  /** Station presets, for autocomplete and the help card. */
  listStations(): readonly RadioStation[] {
    return this.stations;
  }

  /** Whether a URL may be streamed under the configured allowlist. */
  isAllowed(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    // A configured station is allowed even if its host is not listed
    // separately — the operator chose it explicitly.
    if (this.stations.some((station) => station.url === rawUrl)) return true;

    const host = url.hostname.toLowerCase();
    return this.allowedHosts.some(
      (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
    );
  }

  private findStation(query: string): RadioStation | undefined {
    const value = query.trim().toLowerCase();
    if (!value) return undefined;

    return this.stations.find(
      (station) =>
        station.key === value ||
        station.name.toLowerCase() === value ||
        station.genre?.toLowerCase() === value,
    );
  }

  private asCandidate(url: string, name: string, genre?: string): TrackCandidate {
    return {
      source: this.source,
      identifier: url,
      title: name,
      author: 'Radio',
      durationMs: 0,
      uri: url,
      isStream: true,
      metadata: { genre, direct: looksLikeAudioStream(url) },
    };
  }
}

/** Falls back to the host name when a stream has no station entry. */
function describeUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return 'Live stream';
  }
}
