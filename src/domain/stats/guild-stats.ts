import { trackKey, type Track } from '../music';

/**
 * What a guild has listened to.
 *
 * Aggregated rather than a log of every play: a busy server would otherwise
 * grow an unbounded file, and nothing in the bot ever asks "what happened at
 * 14:32" — only "what gets played here".
 */
export interface TrackStat {
  /** `source:identifier`, so the same song from two searches counts once. */
  readonly key: string;
  readonly title: string;
  readonly author: string;
  readonly plays: number;
  /** Time actually spent listening, which a skipped track adds little of. */
  readonly listenedMs: number;
  readonly lastPlayedAt: number;
}

export interface UserStat {
  readonly userId: string;
  readonly plays: number;
  readonly listenedMs: number;
  readonly lastPlayedAt: number;
  /**
   * What this person in particular queues.
   *
   * Kept per user as well as per guild because "what does the server play" and
   * "what do *you* play" are different questions, and the second cannot be
   * answered from the first. Capped tighter than the guild list: three hundred
   * songs each across three hundred people is a file nobody wants.
   */
  readonly tracks: readonly TrackStat[];
}

export interface GuildStats {
  readonly guildId: string;
  readonly tracks: readonly TrackStat[];
  readonly users: readonly UserStat[];
  readonly totalPlays: number;
  readonly totalListenedMs: number;
  /** When this guild started being counted, so the numbers have a period. */
  readonly since: number;
  readonly updatedAt: number;
}

/**
 * Caps on how much is remembered per guild.
 *
 * Without them one server that plays a thousand different songs would grow the
 * file forever. Pruning drops the least-played first, because a one-off play
 * from months ago is what nobody is asking about.
 */
export const MAX_TRACKED_TRACKS = 300;
export const MAX_TRACKED_USERS = 300;
export const MAX_TRACKED_USER_TRACKS = 50;

export function createGuildStats(guildId: string, now = Date.now()): GuildStats {
  return {
    guildId,
    tracks: [],
    users: [],
    totalPlays: 0,
    totalListenedMs: 0,
    since: now,
    updatedAt: now,
  };
}

export interface PlayRecord {
  track: Track;
  /** Whoever queued it. */
  userId: string;
  /** How long it actually played for. */
  listenedMs: number;
  playedAt?: number;
}

/**
 * Folds one play into a guild's totals.
 *
 * Pure, so the same numbers come out whatever order the caller applies them in
 * and a test does not need a clock.
 */
export function recordPlay(stats: GuildStats, record: PlayRecord): GuildStats {
  const playedAt = record.playedAt ?? Date.now();
  const listenedMs = Math.max(0, Math.round(record.listenedMs));
  const key = trackKey(record.track);

  /** Folds this play into one track list — the guild's, or one person's. */
  const foldTrack = (tracks: readonly TrackStat[], limit: number): TrackStat[] =>
    prune(
      upsert(
        tracks,
        (entry) => entry.key === key,
        (existing) => ({
          key,
          // The newest title wins: a track re-uploaded under a tidier name
          // should show as that, not as whatever it was first called.
          title: record.track.title,
          author: record.track.author,
          plays: (existing?.plays ?? 0) + 1,
          listenedMs: (existing?.listenedMs ?? 0) + listenedMs,
          lastPlayedAt: playedAt,
        }),
      ),
      limit,
    );

  const tracks = foldTrack(stats.tracks, MAX_TRACKED_TRACKS);

  const users = upsert(
    stats.users,
    (entry) => entry.userId === record.userId,
    (existing) => ({
      userId: record.userId,
      plays: (existing?.plays ?? 0) + 1,
      listenedMs: (existing?.listenedMs ?? 0) + listenedMs,
      lastPlayedAt: playedAt,
      // `?? []` covers a file written before per-user tracks existed: an old
      // store should start collecting them, not fail to load.
      tracks: foldTrack(existing?.tracks ?? [], MAX_TRACKED_USER_TRACKS),
    }),
  );

  return {
    ...stats,
    tracks,
    users: prune(users, MAX_TRACKED_USERS),
    totalPlays: stats.totalPlays + 1,
    totalListenedMs: stats.totalListenedMs + listenedMs,
    updatedAt: playedAt,
  };
}

export interface ArtistStat {
  readonly author: string;
  readonly plays: number;
  readonly listenedMs: number;
}

/** The most played tracks, ties broken by the more recent. */
export function topTracks(stats: GuildStats, limit: number): TrackStat[] {
  return topTracksOf(stats.tracks, limit);
}

/** The most played artists, summed across their tracks. */
export function topArtists(stats: GuildStats, limit: number): ArtistStat[] {
  return topArtistsOf(stats.tracks, limit);
}

/** One person's own most played tracks. */
export function topTracksFor(stats: GuildStats, userId: string, limit: number): TrackStat[] {
  return topTracksOf(statsFor(stats, userId)?.tracks ?? [], limit);
}

/** One person's own most played artists. */
export function topArtistsFor(stats: GuildStats, userId: string, limit: number): ArtistStat[] {
  return topArtistsOf(statsFor(stats, userId)?.tracks ?? [], limit);
}

/**
 * Where someone comes in the guild's listeners, counting from 1.
 *
 * Undefined for a person who has never queued anything: they have no place in
 * a ranking rather than last place in it.
 */
export function rankOf(stats: GuildStats, userId: string): number | undefined {
  const index = [...stats.users].sort(byPlays).findIndex((entry) => entry.userId === userId);
  return index < 0 ? undefined : index + 1;
}

function topTracksOf(tracks: readonly TrackStat[], limit: number): TrackStat[] {
  return [...tracks].sort(byPlays).slice(0, Math.max(0, limit));
}

function topArtistsOf(tracks: readonly TrackStat[], limit: number): ArtistStat[] {
  const totals = new Map<string, { author: string; plays: number; listenedMs: number }>();

  for (const track of tracks) {
    const name = track.author.trim() || 'Unknown artist';
    const existing = totals.get(name.toLowerCase());

    if (existing) {
      existing.plays += track.plays;
      existing.listenedMs += track.listenedMs;
    } else {
      totals.set(name.toLowerCase(), {
        author: name,
        plays: track.plays,
        listenedMs: track.listenedMs,
      });
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs)
    .slice(0, Math.max(0, limit));
}

/** The people who queue the most. */
export function topListeners(stats: GuildStats, limit: number): UserStat[] {
  return [...stats.users].sort(byPlays).slice(0, Math.max(0, limit));
}

/** One person's own numbers, or undefined if they have never queued anything. */
export function statsFor(stats: GuildStats, userId: string): UserStat | undefined {
  return stats.users.find((entry) => entry.userId === userId);
}

function byPlays(a: { plays: number; lastPlayedAt: number }, b: typeof a): number {
  return b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt;
}

function upsert<T>(
  entries: readonly T[],
  matches: (entry: T) => boolean,
  build: (existing: T | undefined) => T,
): T[] {
  const index = entries.findIndex(matches);
  if (index < 0) return [...entries, build(undefined)];

  const next = [...entries];
  next[index] = build(entries[index]);
  return next;
}

/** Keeps the most played, so a cap never drops what people actually listen to. */
function prune<T extends { plays: number; lastPlayedAt: number }>(
  entries: T[],
  limit: number,
): T[] {
  if (entries.length <= limit) return entries;
  return [...entries].sort(byPlays).slice(0, limit);
}
