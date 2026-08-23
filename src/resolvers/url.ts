import type { Source } from '../domain/music';

/** What a piece of user input turned out to be. */
export type InputKind =
  | 'youtube-video'
  | 'youtube-playlist'
  | 'spotify-track'
  | 'spotify-album'
  | 'spotify-playlist'
  | 'soundcloud-track'
  | 'soundcloud-playlist'
  | 'http-stream'
  | 'search';

export interface ParsedInput {
  kind: InputKind;
  source: Source;
  /** Source-native id, or the raw query for a search. */
  identifier: string;
  /** The normalised URL, absent for a plain search. */
  url?: string;
  /** Playlist id carried alongside a video, e.g. a watch URL inside a list. */
  playlistId?: string;
  /** Start offset in milliseconds parsed from `?t=` / `#t=`. */
  startMs?: number;
}

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'];
const YOUTUBE_SHORT_HOSTS = ['youtu.be'];
const SPOTIFY_HOSTS = ['open.spotify.com', 'play.spotify.com'];
const SOUNDCLOUD_HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'];

const YOUTUBE_ID = /^[\w-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_URI = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/;

/** Audio container extensions we are willing to treat as a direct stream. */
const STREAM_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav', '.m3u8'];

/**
 * Classifies raw user input.
 *
 * Everything that is not a recognised URL falls through to `search`, so
 * `/play chạy ngay đi` and `/play https://…` enter the resolver layer through
 * the same door (spec §7.4).
 */
export function parseInput(raw: string): ParsedInput {
  const input = raw.trim();
  if (!input) return { kind: 'search', source: 'youtube', identifier: '' };

  const uri = input.match(SPOTIFY_URI);
  if (uri) {
    const kind = `spotify-${uri[1]}` as InputKind;
    return { kind, source: 'spotify', identifier: uri[2] as string };
  }

  const url = toUrl(input);
  if (!url) return { kind: 'search', source: 'youtube', identifier: input };

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_SHORT_HOSTS.includes(host)) return parseYouTubeShort(url);
  if (YOUTUBE_HOSTS.includes(host)) return parseYouTube(url);
  if (SPOTIFY_HOSTS.includes(host)) return parseSpotify(url);
  if (SOUNDCLOUD_HOSTS.includes(host)) return parseSoundCloud(url);

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'http-stream', source: 'http', identifier: url.toString(), url: url.toString() };
  }

  // A URL we cannot place — e.g. `ftp://` — is safer treated as a search than
  // handed to a resolver that might try to fetch it.
  return { kind: 'search', source: 'youtube', identifier: input };
}

function toUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    // Bare hosts like `youtu.be/abc` are still URLs to a user.
    if (/^[\w.-]+\.[a-z]{2,}\//i.test(input)) {
      try {
        return new URL(`https://${input}`);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function parseYouTubeShort(url: URL): ParsedInput {
  const id = url.pathname.slice(1).split('/')[0] ?? '';
  if (!YOUTUBE_ID.test(id)) {
    return { kind: 'search', source: 'youtube', identifier: url.toString() };
  }

  return {
    kind: 'youtube-video',
    source: 'youtube',
    identifier: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    ...startOffset(url),
  };
}

function parseYouTube(url: URL): ParsedInput {
  const list = url.searchParams.get('list') ?? undefined;
  const video = url.searchParams.get('v') ?? shortsOrEmbedId(url);

  if (video && YOUTUBE_ID.test(video)) {
    return {
      kind: 'youtube-video',
      source: 'youtube',
      identifier: video,
      url: `https://www.youtube.com/watch?v=${video}`,
      ...(list ? { playlistId: list } : {}),
      ...startOffset(url),
    };
  }

  if (list) {
    return {
      kind: 'youtube-playlist',
      source: 'youtube',
      identifier: list,
      url: `https://www.youtube.com/playlist?list=${list}`,
    };
  }

  return { kind: 'search', source: 'youtube', identifier: url.toString() };
}

/** Pulls the id out of `/shorts/<id>`, `/embed/<id>` and `/live/<id>` paths. */
function shortsOrEmbedId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return match?.[1];
}

function parseSpotify(url: URL): ParsedInput {
  // Locale-prefixed links look like /intl-vi/track/<id>.
  const match = url.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]{22})/);
  if (!match) return { kind: 'search', source: 'youtube', identifier: url.toString() };

  const [, type, id] = match;
  return {
    kind: `spotify-${type}` as InputKind,
    source: 'spotify',
    identifier: id as string,
    url: `https://open.spotify.com/${type}/${id}`,
  };
}

function parseSoundCloud(url: URL): ParsedInput {
  const isPlaylist = url.pathname.includes('/sets/');
  return {
    kind: isPlaylist ? 'soundcloud-playlist' : 'soundcloud-track',
    source: 'soundcloud',
    identifier: url.pathname.replace(/^\/+|\/+$/g, ''),
    url: `https://soundcloud.com${url.pathname}`,
  };
}

/** Reads `?t=90`, `?t=1m30s`, or `#t=90` into milliseconds. */
function startOffset(url: URL): { startMs?: number } {
  const raw =
    url.searchParams.get('t') ??
    url.searchParams.get('start') ??
    url.hash.match(/[#&]t=([^&]+)/)?.[1];
  if (!raw) return {};

  const seconds = parseTimeToSeconds(raw);
  return seconds > 0 ? { startMs: seconds * 1000 } : {};
}

/** Parses `90`, `1m30s`, `1:30`, or `1:02:03` into seconds. */
export function parseTimeToSeconds(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (!value) return 0;

  if (/^\d+$/.test(value)) return Number(value);

  const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (clock) {
    const [, hours, minutes, seconds] = clock;
    return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  }

  const parts = value.match(/(\d+)\s*([hms])/g);
  if (!parts) return 0;

  return parts.reduce((total, part) => {
    const amount = Number(part.replace(/\D/g, ''));
    if (part.includes('h')) return total + amount * 3600;
    if (part.includes('m')) return total + amount * 60;
    return total + amount;
  }, 0);
}

/** True when the URL looks like a direct audio stream rather than a web page. */
export function looksLikeAudioStream(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.toLowerCase();
    return STREAM_EXTENSIONS.some((extension) => path.endsWith(extension));
  } catch {
    return false;
  }
}

/** True when the input is a bare YouTube or Spotify id rather than a URL. */
export function isBareId(input: string): 'youtube' | 'spotify' | undefined {
  const value = input.trim();
  if (YOUTUBE_ID.test(value)) return 'youtube';
  if (SPOTIFY_ID.test(value)) return 'spotify';
  return undefined;
}
