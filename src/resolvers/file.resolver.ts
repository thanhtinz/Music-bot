import { ResolverError } from './errors';
import type { ResolveOptions, SourceResolver, TrackCandidate, TrackSearchClient } from './types';
import { looksLikeAudioStream, type ParsedInput } from './url';

/** Hosts an upload may come from when the caller does not configure its own. */
const DEFAULT_ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

export interface FileResolverOptions {
  /**
   * Hosts allowed to be played from.
   *
   * Playing an arbitrary URL makes the bot fetch whatever a user names, which
   * is a server-side request forgery primitive; the allowlist is what stops it
   * (spec §25). Discord's own CDN is on it by default because that is where an
   * upload attached to a command lands — the URL comes from Discord rather than
   * from whoever typed the command.
   */
  allowedHosts?: readonly string[];
}

/**
 * Plays an uploaded audio file.
 *
 * Somebody who has the song on their phone should be able to drop it into the
 * channel rather than go looking for it on YouTube first. The upload is a file
 * rather than a stream: it has an end, a length and a position, so it is
 * resolved as a track and everything that follows — the progress bar, `seek`,
 * `forward` — works on it.
 *
 * That is the difference from {@link RadioResolver}, which also takes an HTTP
 * URL: a station never ends and has nothing to seek to. The two are told apart
 * by the file extension and by the host, so a station on the radio allowlist
 * cannot be dragged in here and drawn with a progress bar that never fills.
 *
 * The audio node is asked what the file actually is, because an MP3 carries its
 * own title, artist and length in its tags and those beat anything that can be
 * guessed from a URL. The filename is the fallback for a file with no tags.
 */
export class FileResolver implements SourceResolver {
  readonly name = 'file';
  readonly source = 'http' as const;

  private readonly allowedHosts: readonly string[];

  constructor(
    private readonly client: TrackSearchClient,
    options: FileResolverOptions = {},
  ) {
    this.allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  }

  canHandle(input: ParsedInput): boolean {
    if (input.kind !== 'http-stream') return false;

    const url = input.url ?? input.identifier;
    return looksLikeAudioStream(url) && this.isAllowed(url);
  }

  async resolveTrack(
    input: ParsedInput,
    options: ResolveOptions = {},
  ): Promise<TrackCandidate | null> {
    if (!this.canHandle(input)) return null;

    const url = input.url ?? input.identifier;
    const loaded = await this.client.loadUrl(url, options);
    const track = loaded[0];

    if (!track) {
      throw new ResolverError(
        'UNAVAILABLE',
        // Short enough for the notice card, which holds two lines.
        'I could not read that file. Try MP3, FLAC, WAV, OGG or M4A.',
        { source: this.name, userFacing: true },
      );
    }

    return {
      ...track,
      // A node with nothing to go on names the track after the URL, which is a
      // signed CDN link nobody wants to read on a card.
      title: usableTitle(track.title) ?? fileNameOf(url),
      author: usableTitle(track.author) ?? 'Uploaded file',
      // An upload ends, unlike a station, whatever the node decided to call it.
      isStream: false,
      uri: track.uri ?? url,
    };
  }

  /** Whether a URL may be played under the configured allowlist. */
  isAllowed(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    return this.allowedHosts.some(
      (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
    );
  }
}

/**
 * The file's own name, without the path, the query string or the extension.
 *
 * A Discord upload keeps the name it was uploaded under, so this is usually the
 * artist and title somebody already typed once.
 */
export function fileNameOf(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    path = rawUrl;
  }

  const last = path.split('/').filter(Boolean).pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed escape is not worth failing a play over.
    name = last;
  }

  const withoutExtension = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  // Uploads from a phone arrive as `Chăm_Hoa_MONO.mp3` more often than not.
  const spaced = withoutExtension
    .replace(/[_+]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return spaced || 'Uploaded file';
}

/**
 * A title worth using, or nothing.
 *
 * Lavalink fills a missing tag with `Unknown title` / `Unknown artist` rather
 * than leaving it empty, and those on a card look like a bug rather than like a
 * file without tags.
 */
function usableTitle(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  return /^unknown(\s|$)/i.test(trimmed) ? undefined : trimmed;
}
