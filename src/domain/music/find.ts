import type { Track } from './track';

/** A queued track and the 1-based position the commands know it by. */
export interface QueueMatch {
  position: number;
  track: Track;
}

/**
 * Folds text down to what a search should match on.
 *
 * Diacritics are stripped, because this bot is used to queue Vietnamese music
 * and nobody types `Chăm Hoa` into a chat box with the tone marks on — `cham
 * hoa` has to find it. `đ` survives the unicode decomposition (it is its own
 * letter, not a `d` with a mark), so it is folded by hand.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The queued tracks matching what somebody typed.
 *
 * Every word has to appear somewhere in the title or the artist, in any order,
 * so `hoa mono` finds "Chăm Hoa" by MONO without anybody having to remember
 * which half of it they know. Substring rather than whole-word: half-remembered
 * is the normal state, and `lac` should reach `Lạc Trôi`.
 *
 * Positions are those of the upcoming queue, counting from 1 — the numbers the
 * card prints and `remove`, `move` and `jump` take.
 */
export function findInQueue(tracks: readonly Track[], term: string): QueueMatch[] {
  const words = foldForSearch(term).split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const matches: QueueMatch[] = [];

  tracks.forEach((track, index) => {
    const haystack = foldForSearch(`${track.title} ${track.author}`);
    if (words.every((word) => haystack.includes(word))) {
      matches.push({ position: index + 1, track });
    }
  });

  return matches;
}
