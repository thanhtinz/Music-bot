/** What a lyrics lookup asks for. */
export interface LyricsQuery {
  title: string;
  artist?: string;
  /** Helps a provider pick between versions of the same song. */
  durationMs?: number;
}

export interface Lyrics {
  title: string;
  artist: string;
  /** Plain text, newline separated. */
  text: string;
  /** Where it came from, shown on the card. */
  provider: string;
  /** True when the provider had a timed version and it was flattened. */
  synced?: boolean;
}

/**
 * A source of lyrics.
 *
 * A port rather than a concrete client so the bot is not married to one
 * service: lyrics providers change terms, disappear, and rate-limit, and a
 * second implementation should not mean touching the command.
 */
export interface LyricsProvider {
  readonly name: string;
  /** Resolves lyrics, or `undefined` when the provider simply has none. */
  find(query: LyricsQuery): Promise<Lyrics | undefined>;
}

/**
 * Cleans a track title enough to search with.
 *
 * Titles from video sources carry decorations — `(Official MV)`, `[Lyrics]`,
 * `feat. …` — that a lyrics database has never heard of, and leaving them in is
 * the difference between a hit and nothing at all.
 */
export function searchableTitle(title: string): string {
  return (
    title
      .replace(/\((?:[^()]*(?:official|lyric|audio|video|mv|hd|4k|remaster)[^()]*)\)/gi, ' ')
      .replace(/\[(?:[^[\]]*(?:official|lyric|audio|video|mv|hd|4k|remaster)[^[\]]*)\]/gi, ' ')
      .replace(/\b(?:official\s+)?(?:music\s+)?video\b/gi, ' ')
      // `official` on its own is left over once the word it qualified is gone,
      // as in `Nevada | Official Audio`.
      .replace(/\b(?:official|lyrics?|audio|visualizer|mv)\b/gi, ' ')
      .replace(/\s*[|/]\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/** Splits an artist string down to the primary name. */
export function primaryArtist(artist: string): string {
  return (
    artist
      .split(/\s*(?:,|&|feat\.?|ft\.?|với|x)\s+/i)[0]
      ?.replace(/\s*-\s*topic$/i, '')
      .trim() ?? artist
  );
}
