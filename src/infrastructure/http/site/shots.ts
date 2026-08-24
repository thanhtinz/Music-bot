/**
 * The screenshots the site shows, by the name the pages use.
 *
 * An explicit map rather than a directory served by path, and that is a
 * security decision as much as a tidiness one: a route that turns part of a URL
 * into a filename has to be defended against `..`, against symlinks, against
 * encodings that normalise to either, and against every future reader who
 * assumes somebody already did. A map cannot be traversed. If a name is not in
 * here it does not exist, and adding one is a deliberate line in this file.
 *
 * The values are the URLs the pages reference; {@link SHOT_FILES} maps each to
 * the file on disk it is served from.
 */
export const SHOT = {
  nowPlaying: '/shots/now-playing.png',
  queue: '/shots/queue.png',
  lyrics: '/shots/lyrics.png',
  playlists: '/shots/playlists.png',
  upload: '/shots/upload.png',
  help: '/shots/help.png',
} as const;

/** Where each of those lives in the repository. */
export const SHOT_FILES: Readonly<Record<string, string>> = {
  '/shots/now-playing.png': 'preview/now-playing-sakura.png',
  '/shots/queue.png': 'preview/queue-sakura.png',
  '/shots/lyrics.png': 'preview/reply-lyrics-synced.png',
  '/shots/playlists.png': 'preview/playlist-sakura.png',
  '/shots/upload.png': 'preview/reply-play-upload.png',
  '/shots/help.png': 'preview/help-sakura.png',
};
