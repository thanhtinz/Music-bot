import type { Source, Track, TrackInput } from '../music';

/**
 * A track as it is stored in a playlist.
 *
 * Deliberately not a {@link Track}: a track's `id` is unique per enqueue and its
 * `requesterId` is whoever queued it that time, neither of which survives being
 * saved and replayed later. What is kept is what it takes to rebuild the track.
 */
export interface SavedTrack {
  readonly source: Source;
  readonly identifier: string;
  readonly title: string;
  readonly author: string;
  readonly durationMs: number;
  readonly uri?: string;
  readonly artworkUrl?: string;
  readonly isStream: boolean;
}

export type PlaylistVisibility = 'public' | 'private';

export interface Playlist {
  readonly id: string;
  readonly guildId: string;
  readonly ownerId: string;
  readonly name: string;
  readonly visibility: PlaylistVisibility;
  readonly tracks: readonly SavedTrack[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Caps, so one user cannot fill the store on their own. */
export const MAX_PLAYLISTS_PER_OWNER = 25;
export const MAX_TRACKS_PER_PLAYLIST = 500;
export const MAX_PLAYLIST_NAME_LENGTH = 60;

export type PlaylistErrorCode =
  | 'name-empty'
  | 'name-too-long'
  | 'duplicate-name'
  | 'playlist-limit'
  | 'track-limit'
  | 'not-found'
  | 'empty'
  | 'out-of-range'
  | 'forbidden';

/** Domain-level failure with a code the command layer maps to a message. */
export class PlaylistError extends Error {
  constructor(
    readonly code: PlaylistErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlaylistError';
  }
}

let counter = 0;

function nextPlaylistId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `pl_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Collapses a name to its lookup form.
 *
 * Names are matched case-insensitively and space-insensitively so that asking
 * for `chill vibes` finds `Chill  Vibes`, which is what someone typing a name
 * from memory expects.
 */
export function normalizePlaylistName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Trims and collapses whitespace, keeping the owner's capitalisation. */
export function cleanPlaylistName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Validates a name, throwing the code the caller should report. */
export function assertValidPlaylistName(name: string): string {
  const cleaned = cleanPlaylistName(name);

  if (!cleaned) throw new PlaylistError('name-empty', 'A playlist needs a name.');
  if (cleaned.length > MAX_PLAYLIST_NAME_LENGTH) {
    throw new PlaylistError(
      'name-too-long',
      `Playlist names are limited to ${MAX_PLAYLIST_NAME_LENGTH} characters.`,
    );
  }

  return cleaned;
}

export interface CreatePlaylistInput {
  guildId: string;
  ownerId: string;
  name: string;
  visibility?: PlaylistVisibility;
  tracks?: readonly SavedTrack[];
  /** Injected so tests are not at the mercy of the clock. */
  now?: number;
}

export function createPlaylist(input: CreatePlaylistInput): Playlist {
  const now = input.now ?? Date.now();

  return {
    id: nextPlaylistId(),
    guildId: input.guildId,
    ownerId: input.ownerId,
    name: assertValidPlaylistName(input.name),
    visibility: input.visibility ?? 'public',
    tracks: [...(input.tracks ?? [])].slice(0, MAX_TRACKS_PER_PLAYLIST),
    createdAt: now,
    updatedAt: now,
  };
}

/** Strips a live track down to what is worth saving. */
export function toSavedTrack(track: Track): SavedTrack {
  return {
    source: track.source,
    identifier: track.identifier,
    title: track.title,
    author: track.author,
    durationMs: track.durationMs,
    uri: track.uri,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream,
  };
}

/** Rebuilds a queueable track, attributed to whoever is playing it now. */
export function toTrackInput(saved: SavedTrack, requesterId: string): TrackInput {
  return {
    source: saved.source,
    identifier: saved.identifier,
    title: saved.title,
    author: saved.author,
    durationMs: saved.durationMs,
    uri: saved.uri,
    artworkUrl: saved.artworkUrl,
    isStream: saved.isStream,
    requesterId,
  };
}

/** Appends a track, refusing rather than silently dropping it at the cap. */
export function appendTrack(playlist: Playlist, track: SavedTrack, now = Date.now()): Playlist {
  if (playlist.tracks.length >= MAX_TRACKS_PER_PLAYLIST) {
    throw new PlaylistError(
      'track-limit',
      `**${playlist.name}** is full at ${MAX_TRACKS_PER_PLAYLIST} tracks.`,
    );
  }

  return { ...playlist, tracks: [...playlist.tracks, track], updatedAt: now };
}

/** Removes the track at a 1-based position, as the card and messages show it. */
export function removeTrackAt(
  playlist: Playlist,
  position: number,
  now = Date.now(),
): { playlist: Playlist; removed: SavedTrack } {
  const index = position - 1;
  const removed = playlist.tracks[index];

  if (!Number.isInteger(position) || !removed) {
    throw new PlaylistError(
      'out-of-range',
      `**${playlist.name}** has ${playlist.tracks.length} track(s); there is no #${position}.`,
    );
  }

  const tracks = playlist.tracks.filter((_, at) => at !== index);
  return { playlist: { ...playlist, tracks, updatedAt: now }, removed };
}

export function renamePlaylist(playlist: Playlist, name: string, now = Date.now()): Playlist {
  return { ...playlist, name: assertValidPlaylistName(name), updatedAt: now };
}

export function setVisibility(
  playlist: Playlist,
  visibility: PlaylistVisibility,
  now = Date.now(),
): Playlist {
  return { ...playlist, visibility, updatedAt: now };
}

/** Total playtime; streams have no meaningful duration and count as zero. */
export function playlistDurationMs(playlist: Playlist): number {
  return playlist.tracks.reduce((sum, track) => sum + (track.isStream ? 0 : track.durationMs), 0);
}

/** True when `viewer` may see this playlist. */
export function isVisibleTo(playlist: Playlist, viewerId: string): boolean {
  return playlist.visibility === 'public' || playlist.ownerId === viewerId;
}
