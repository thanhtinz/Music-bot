import { createLogger } from '../../telemetry/logger';
import type { PlayerManager } from '../player';

import { isRestorable, isStale, type PlayerSession } from './player-session';
import type { SessionRepository } from './session-repository';

const logger = createLogger('session-restore');

export interface RestoreOptions {
  /** Sessions older than this are dropped rather than resumed. */
  maxAgeMs?: number;
  maxQueueSize?: number;
  /** Called for each guild put back, so the bot can say it is back. */
  onRestored?: (session: PlayerSession) => Promise<void> | void;
  now?: () => number;
}

export interface RestoreResult {
  restored: string[];
  /** Guilds whose saved state was dropped, with why. */
  skipped: Array<{ guildId: string; reason: 'stale' | 'empty' | 'failed' }>;
}

const DEFAULT_MAX_AGE_MS = 15 * 60_000;

/**
 * Puts saved sessions back after a restart.
 *
 * Each guild is restored independently: one guild whose voice channel has since
 * been deleted must not stop the others coming back. Whatever happens, the
 * saved state is cleared afterwards, because a session that could not be
 * restored now will not restore any better next time.
 */
export async function restoreSessions(
  manager: PlayerManager,
  repository: SessionRepository,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  const sessions = await repository.all();
  const result: RestoreResult = { restored: [], skipped: [] };

  for (const session of sessions) {
    if (!isRestorable(session)) {
      result.skipped.push({ guildId: session.guildId, reason: 'empty' });
      await repository.delete(session.guildId);
      continue;
    }

    if (isStale(session, maxAgeMs, now())) {
      logger.info({ guildId: session.guildId }, 'dropping a session that went stale');
      result.skipped.push({ guildId: session.guildId, reason: 'stale' });
      await repository.delete(session.guildId);
      continue;
    }

    try {
      await restoreOne(manager, session, options.maxQueueSize);
      result.restored.push(session.guildId);
      await options.onRestored?.(session);
    } catch (error) {
      // One guild's voice channel may be gone; the rest still deserve to come
      // back, so the failure is recorded rather than thrown.
      logger.warn({ err: error, guildId: session.guildId }, 'could not restore a session');
      result.skipped.push({ guildId: session.guildId, reason: 'failed' });
    }

    await repository.delete(session.guildId);
  }

  if (result.restored.length > 0 || result.skipped.length > 0) {
    logger.info(
      { restored: result.restored.length, skipped: result.skipped.length },
      'restored saved sessions',
    );
  }

  return result;
}

async function restoreOne(
  manager: PlayerManager,
  session: PlayerSession,
  maxQueueSize?: number,
): Promise<void> {
  const player = await manager.getOrCreate({
    guildId: session.guildId,
    voiceChannelId: session.voiceChannelId,
    ...(session.textChannelId === undefined ? {} : { textChannelId: session.textChannelId }),
    volume: session.volume,
    ...(maxQueueSize === undefined ? {} : { maxQueueSize }),
  });

  player.autoplay = session.autoplay;
  if (session.filterPreset) await player.setFilter(session.filterPreset);

  // The queue goes back whole rather than track by track, so the history and
  // the current track survive as they were.
  await player.restore(
    {
      ...(session.current === undefined ? {} : { current: session.current }),
      tracks: session.tracks,
      history: session.history,
      loop: session.loop,
    },
    { positionMs: session.positionMs, paused: session.wasPaused },
  );
}
