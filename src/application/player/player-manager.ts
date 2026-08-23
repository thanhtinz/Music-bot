import { createLogger } from '../../telemetry/logger';
import type { AudioBackend } from '../../infrastructure/audio/audio-backend';

import { Player, type PlayerOptions } from './player';

export interface PlayerManagerOptions {
  defaultVolume?: number;
  maxQueueSize?: number;
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

    this.players.set(options.guildId, player);

    try {
      await player.connect();
    } catch (error) {
      this.players.delete(options.guildId);
      throw error;
    }

    return player;
  }

  /** Stops a guild's player and forgets it. */
  async destroy(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (!player) return;

    this.players.delete(guildId);
    await player.stop().catch((error) => {
      logger.warn({ err: error, guildId }, 'failed to stop player cleanly');
    });
  }

  /** Stops every player — used on graceful shutdown (spec §31). */
  async destroyAll(): Promise<void> {
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
