import { createLogger } from '../../telemetry/logger';
import type { AudioBackend } from '../../infrastructure/audio/audio-backend';

import type { IdleMonitor, IdleReason } from './idle-monitor';
import { Player, type PlayerOptions } from './player';

export interface PlayerManagerOptions {
  defaultVolume?: number;
  maxQueueSize?: number;
  /**
   * Leaves a channel that has gone quiet.
   *
   * Optional: without one the bot stays connected until told otherwise, which
   * is what the tests that are not about idling want.
   */
  idle?: IdleMonitor;
  /** Told which player is being dropped for going idle, to announce it. */
  onIdleLeave?: (player: Player, reason: IdleReason) => Promise<void> | void;
}

const logger = createLogger('player-manager');

/**
 * Owns one {@link Player} per guild and serialises every mutation on it.
 *
 * Two users hitting skip at the same moment, or a button click racing a slash
 * command, must not interleave inside the player. Every mutating path runs
 * through {@link withLock}, which chains work per guild so operations apply in
 * arrival order (spec §30).
 */
export class PlayerManager {
  /**
   * Told about every new player.
   *
   * A field rather than an option because the session recorder is built after
   * the manager — it needs somewhere to put its watch without the two having
   * to be constructed in one breath.
   */
  onPlayerCreated?: (player: Player) => void;

  private readonly players = new Map<string, Player>();
  /** Tail of the pending-work chain per guild. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly backend: AudioBackend,
    private readonly options: PlayerManagerOptions = {},
  ) {
    this.backend.events.on('trackEnd', (event) => {
      const player = this.players.get(event.guildId);
      if (!player) return;

      // Track advance is a mutation like any other, so it takes the same lock.
      void this.withLock(event.guildId, () => player.onTrackEnd(event)).catch((error) => {
        logger.error({ err: error, guildId: event.guildId }, 'failed to advance queue');
      });
    });

    this.backend.events.on('trackError', (event) => {
      logger.warn(
        { guildId: event.guildId, track: event.track.identifier, reason: event.error },
        'track failed to play',
      );
      // A failed track behaves like a finished one: move on rather than stall.
      const player = this.players.get(event.guildId);
      if (!player) return;

      void this.withLock(event.guildId, () =>
        player.onTrackEnd({ guildId: event.guildId, track: event.track, reason: 'load-failed' }),
      ).catch(() => undefined);
    });

    this.backend.events.on('nodeLost', (event) => {
      for (const guildId of event.guildIds) {
        const player = this.players.get(guildId);
        if (!player) continue;

        // Serialised like every other mutation: a command arriving mid-failover
        // must not interleave with the reconnect.
        void this.withLock(guildId, () => player.reconnect())
          .then(() => logger.info({ guildId, node: event.node }, 'moved off a lost node'))
          .catch((error) => {
            logger.error(
              { err: error, guildId, node: event.node },
              'could not move off a lost node',
            );
          });
      }
    });

    this.backend.events.on('voiceClosed', (event) => {
      this.players.get(event.guildId)?.onVoiceClosed(event);
      if (!event.recoverable) void this.destroy(event.guildId);
    });
  }

  get(guildId: string): Player | undefined {
    return this.players.get(guildId);
  }

  has(guildId: string): boolean {
    return this.players.has(guildId);
  }

  get size(): number {
    return this.players.size;
  }

  /** Every active player, for metrics and graceful shutdown. */
  list(): Player[] {
    return [...this.players.values()];
  }

  /**
   * Returns the guild's player, creating and connecting it on first use.
   *
   * When a player already exists but the user is in a different channel, the
   * existing session wins — moving channels is an explicit action, not a
   * side effect of running `/play`.
   */
  async getOrCreate(
    options: Omit<PlayerOptions, 'volume' | 'maxQueueSize'> &
      Partial<Pick<PlayerOptions, 'volume' | 'maxQueueSize'>>,
  ): Promise<Player> {
    const existing = this.players.get(options.guildId);
    if (existing) {
      if (options.textChannelId) existing.textChannelId = options.textChannelId;
      return existing;
    }

    const player = new Player(this.backend, {
      ...options,
      volume: options.volume ?? this.options.defaultVolume,
      maxQueueSize: options.maxQueueSize ?? this.options.maxQueueSize,
    });

    // A player that has just been created has nothing playing yet, so the
    // countdown starts here rather than waiting for a queue that never fills.
    player.on('queueEnd', () => {
      void this.options.idle?.idle(options.guildId);
    });
    player.on('trackStart', () => {
      this.options.idle?.active(options.guildId);
    });

    this.players.set(options.guildId, player);

    try {
      await player.connect();
    } catch (error) {
      this.players.delete(options.guildId);
      throw error;
    }

    this.onPlayerCreated?.(player);
    void this.options.idle?.idle(options.guildId);
    return player;
  }

  /** Whether the bot is alone in its channel, from the voice-state watcher. */
  async setAlone(guildId: string, alone: boolean): Promise<void> {
    if (!this.players.has(guildId)) return;
    await this.options.idle?.setAlone(guildId, alone);
  }

  /** Drops a guild's player because it has been idle too long. */
  async leaveIdle(guildId: string, reason: IdleReason): Promise<void> {
    const player = this.players.get(guildId);
    if (!player) return;

    logger.info({ guildId, reason }, 'leaving after being idle');
    await this.options.onIdleLeave?.(player, reason);
    await this.destroy(guildId);
  }

  /** Stops a guild's player and forgets it. */
  async destroy(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (!player) return;

    this.players.delete(guildId);
    this.options.idle?.forget(guildId);

    await player.stop().catch((error) => {
      logger.warn({ err: error, guildId }, 'failed to stop player cleanly');
    });
  }

  /** Stops every player — used on graceful shutdown (spec §31). */
  async destroyAll(): Promise<void> {
    this.options.idle?.stop();
    await Promise.all([...this.players.keys()].map((guildId) => this.destroy(guildId)));
  }

  /**
   * Runs `work` with exclusive access to one guild's player.
   *
   * Work is chained rather than rejected, so a queued command waits its turn
   * instead of failing; a throwing task does not break the chain for the next
   * one.
   */
  async withLock<T>(guildId: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(guildId) ?? Promise.resolve();
    const result = previous.then(work, work);

    // The stored tail must never be a rejected promise, or every later caller
    // would inherit that rejection.
    const tail = result.catch(() => undefined);
    this.locks.set(guildId, tail);

    try {
      return await result;
    } finally {
      // Only the last task in the chain clears the entry, so idle guilds do not
      // retain a promise forever while busy ones keep their ordering.
      if (this.locks.get(guildId) === tail) this.locks.delete(guildId);
    }
  }
}
