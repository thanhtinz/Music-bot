import type { LoopMode, Track } from '../../domain/music';
import type { Player } from '../player';

/**
 * Everything needed to put a guild back where it was after a restart.
 *
 * A deploy in the middle of a set should cost the listeners a few seconds, not
 * their queue. The tracks are stored whole — they were already resolved once,
 * and resolving them again would be slower and could come back different.
 */
export interface PlayerSession {
  readonly guildId: string;
  readonly voiceChannelId: string;
  readonly textChannelId?: string;
  readonly volume: number;
  readonly loop: LoopMode;
  readonly autoplay: boolean;
  readonly filterPreset?: string;
  readonly current?: Track;
  /** Where the current track had got to, so it resumes rather than restarts. */
  readonly positionMs: number;
  readonly wasPaused: boolean;
  readonly tracks: Track[];
  readonly history: Track[];
  readonly savedAt: number;
}

/** Reads a player's state into a saveable session. */
export function toSession(player: Player, now = Date.now()): PlayerSession {
  const queue = player.queue.toJSON();
  const current = queue.current;

  return {
    guildId: player.guildId,
    voiceChannelId: player.voiceChannelId,
    ...(player.textChannelId === undefined ? {} : { textChannelId: player.textChannelId }),
    volume: player.volume,
    loop: queue.loop,
    autoplay: player.autoplay,
    ...(player.filter === undefined ? {} : { filterPreset: player.filter }),
    ...(current === undefined ? {} : { current }),
    // A stream has no meaningful position to come back to.
    positionMs: current && !current.isStream ? player.positionMs : 0,
    wasPaused: player.status === 'paused',
    tracks: queue.tracks,
    history: queue.history,
    savedAt: now,
  };
}

/** True when a session is worth restoring at all. */
export function isRestorable(session: PlayerSession): boolean {
  return Boolean(session.voiceChannelId) && Boolean(session.current || session.tracks.length > 0);
}

/**
 * Whether a session is too old to be worth restoring.
 *
 * Coming back after a two-minute deploy is a courtesy; coming back after a day
 * and playing into a room that has long since emptied is a nuisance.
 */
export function isStale(session: PlayerSession, maxAgeMs: number, now = Date.now()): boolean {
  return now - session.savedAt > maxAgeMs;
}
