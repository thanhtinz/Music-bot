/** Where the audio ultimately comes from. */
export type Source = 'youtube' | 'spotify' | 'soundcloud' | 'http' | 'radio';

/**
 * A resolved, playable track.
 *
 * The domain never holds Lavalink or discord.js types: resolvers produce this
 * shape and the player consumes it, so the audio backend stays replaceable
 * (spec §1.2).
 */
export interface Track {
  /** Stable per-enqueue id — two copies of the same song get different ids. */
  readonly id: string;
  readonly source: Source;
  /** Source-native id, e.g. a YouTube video id. */
  readonly identifier: string;
  readonly title: string;
  readonly author: string;
  readonly durationMs: number;
  readonly uri?: string;
  readonly artworkUrl?: string;
  /** Discord user id of whoever queued it. */
  readonly requesterId: string;
  /** Live streams have no meaningful duration or seek position. */
  readonly isStream: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Stands in for a requester on a track the bot chose itself.
 *
 * Autoplay has to put *something* here, and crediting the person whose song
 * seeded the suggestion would put tracks they never queued into their name —
 * in the queue card, and in their listening stats.
 */
export const AUTOPLAY_REQUESTER_ID = 'autoplay';

/** Whether a track was picked by autoplay rather than asked for. */
export function isAutoplayed(track: Track): boolean {
  return track.requesterId === AUTOPLAY_REQUESTER_ID;
}

/** Everything needed to build a {@link Track} except the generated id. */
export type TrackInput = Omit<Track, 'id' | 'isStream' | 'metadata'> &
  Partial<Pick<Track, 'isStream' | 'metadata'>>;

let counter = 0;

/**
 * Generates a queue-unique track id.
 *
 * A counter plus the timestamp is enough: ids only need to be unique within a
 * running process, and they must be stable for the lifetime of a queue entry
 * so button interactions can address a specific row.
 */
function nextTrackId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `t_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Normalises resolver output into a {@link Track}. */
export function createTrack(input: TrackInput): Track {
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;

  return {
    id: nextTrackId(),
    source: input.source,
    identifier: input.identifier,
    title: input.title.trim() || 'Unknown title',
    author: input.author.trim() || 'Unknown artist',
    durationMs,
    uri: input.uri,
    artworkUrl: input.artworkUrl,
    requesterId: input.requesterId,
    isStream: input.isStream ?? durationMs === 0,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  };
}

/** Identity of a track as a piece of content, ignoring who queued it. */
export function trackKey(track: Track): string {
  return `${track.source}:${track.identifier}`;
}

/** Total playtime of a list, treating streams as zero-length. */
export function totalDurationMs(tracks: readonly Track[]): number {
  return tracks.reduce((sum, track) => sum + (track.isStream ? 0 : track.durationMs), 0);
}
