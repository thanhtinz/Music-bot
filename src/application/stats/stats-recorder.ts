import type { Track } from '../../domain/music';
import { createGuildStats, recordPlay } from '../../domain/stats';
import { createLogger } from '../../telemetry/logger';
import type { Player } from '../player';

import type { StatsRepository } from './stats-repository';

const logger = createLogger('stats-recorder');

export interface StatsRecorderOptions {
  /** Injectable so a test does not have to wait out a song. */
  now?: () => number;
}

interface InFlight {
  track: Track;
  startedAt: number;
}

/**
 * Counts what actually gets listened to.
 *
 * A play is recorded when a track *ends*, not when it starts, and with the time
 * it was actually up for: queueing forty songs and skipping thirty-nine of them
 * should not read as forty songs listened to.
 *
 * The measure is wall time between start and end, capped at the track's own
 * length. That counts a pause as listening, which overstates a little; the cap
 * is what stops it overstating a lot, and the alternative — tracking every
 * pause and resume — is more machinery than the number deserves.
 */
export class StatsRecorder {
  private readonly playing = new Map<string, InFlight>();
  private readonly now: () => number;

  constructor(
    private readonly repository: StatsRepository,
    options: StatsRecorderOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Watches a player for the rest of its life. */
  watch(player: Player): void {
    player.on('trackStart', (event) => {
      this.playing.set(player.guildId, { track: event.track, startedAt: this.now() });
    });

    // Recorded on end rather than start, so the length of the listen is known.
    player.on('trackEnd', () => {
      void this.finish(player.guildId).catch((error) => {
        logger.warn({ err: error, guildId: player.guildId }, 'could not record a play');
      });
    });
  }

  /** Forgets a guild's in-flight track, e.g. when its player goes away. */
  forget(guildId: string): void {
    this.playing.delete(guildId);
  }

  private async finish(guildId: string): Promise<void> {
    const started = this.playing.get(guildId);
    this.playing.delete(guildId);

    // Without a start there is nothing to measure — a track that was already
    // playing when the bot restarted, for instance.
    if (!started) return;

    const elapsed = Math.max(0, this.now() - started.startedAt);
    const track = started.track;
    const listenedMs = track.isStream ? elapsed : Math.min(elapsed, track.durationMs);

    const existing = await this.repository.find(guildId);
    const stats = existing ?? createGuildStats(guildId, started.startedAt);

    await this.repository.save(
      // The track that started is the one that was listened to; the backend's
      // copy on the end event can be missing after a load failure.
      recordPlay(stats, { track, userId: track.requesterId, listenedMs, playedAt: this.now() }),
    );
  }
}
