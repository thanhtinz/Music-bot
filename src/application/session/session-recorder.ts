import { createLogger } from '../../telemetry/logger';
import type { Player, PlayerManager } from '../player';

import { isRestorable, toSession } from './player-session';
import type { SessionRepository } from './session-repository';

const logger = createLogger('session-recorder');

export interface SessionRecorderOptions {
  /**
   * How long to wait after a change before writing.
   *
   * A queue being filled fires an event per track; writing each one would turn
   * one command into a hundred file writes for a state that is stale a
   * millisecond later.
   */
  debounceMs?: number;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

const DEFAULT_DEBOUNCE_MS = 2_000;

/**
 * Keeps the saved sessions in step with the live players.
 *
 * A deploy in the middle of a set should cost the listeners a few seconds, not
 * their queue — which means the state has to already be on disk when the
 * process goes away, not written on the way out.
 */
export class SessionRecorder {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly debounceMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;

  constructor(
    private readonly repository: SessionRepository,
    options: SessionRecorderOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Watches a player for the rest of its life. */
  watch(player: Player): void {
    const record = () => this.schedule(player);

    player.on('trackStart', record);
    player.on('trackEnd', record);
    player.on('stateChange', record);
    player.on('queueEnd', record);

    record();
  }

  /** Writes a player's state now, without waiting for the debounce. */
  async flush(player: Player): Promise<void> {
    this.cancel(player.guildId);

    const session = toSession(player);
    if (!isRestorable(session)) {
      await this.repository.delete(player.guildId);
      return;
    }

    await this.repository.save(session);
  }

  /** Writes every player's state — used on shutdown. */
  async flushAll(manager: PlayerManager): Promise<void> {
    await Promise.all(manager.list().map((player) => this.flush(player)));
  }

  /** Forgets a guild, e.g. once it has been told to leave for good. */
  async forget(guildId: string): Promise<void> {
    this.cancel(guildId);
    await this.repository.delete(guildId);
  }

  /** Cancels every pending write. */
  stop(): void {
    for (const guildId of [...this.pending.keys()]) this.cancel(guildId);
  }

  private schedule(player: Player): void {
    this.cancel(player.guildId);

    this.pending.set(
      player.guildId,
      this.setTimer(() => {
        this.pending.delete(player.guildId);
        void this.flush(player).catch((error) => {
          logger.warn({ err: error, guildId: player.guildId }, 'could not save the session');
        });
      }, this.debounceMs),
    );
  }

  private cancel(guildId: string): void {
    const handle = this.pending.get(guildId);
    if (!handle) return;

    this.clearTimer(handle);
    this.pending.delete(guildId);
  }
}
