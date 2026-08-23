import { createLogger } from '../../telemetry/logger';

const logger = createLogger('idle-monitor');

/** What a guild's settings say about staying connected. */
export interface IdlePolicy {
  /** 24/7: never leave on a timer. */
  stayConnected: boolean;
  idleTimeoutMs: number;
}

export type IdleReason = 'queue-empty' | 'alone';

export interface IdleMonitorOptions {
  /** Reads the guild's policy at the moment the timer would start. */
  policyFor: (guildId: string) => Promise<IdlePolicy> | IdlePolicy;
  /** Called when the wait is over and the guild should be disconnected. */
  onTimeout: (guildId: string, reason: IdleReason) => Promise<void>;
  /** Injectable so tests do not wait in real time. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

/**
 * Leaves a voice channel that has stopped being useful.
 *
 * Two things start the clock: the queue running out, and everyone else leaving
 * the channel. Either one alone is enough — a bot playing to an empty room is
 * as pointless as one sitting silent in a full one.
 *
 * The policy is read when the timer starts *and* again when it fires, because
 * somebody may turn on 24/7 during the wait, and the point of that setting is
 * that the bot then stays.
 */
export class IdleMonitor {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Guilds where the bot is currently alone, whatever the queue is doing. */
  private readonly alone = new Set<string>();

  private readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;

  constructor(private readonly options: IdleMonitorOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Something worth staying for is happening; stop any countdown. */
  active(guildId: string): void {
    // Being alone outlives a track starting: the room is still empty.
    if (this.alone.has(guildId)) return;
    this.cancel(guildId);
  }

  /** The queue ran out. */
  async idle(guildId: string): Promise<void> {
    await this.start(guildId, 'queue-empty');
  }

  /** Whether the bot is now by itself in its channel. */
  async setAlone(guildId: string, alone: boolean): Promise<void> {
    if (alone) {
      this.alone.add(guildId);
      await this.start(guildId, 'alone');
      return;
    }

    this.alone.delete(guildId);
    this.cancel(guildId);
  }

  /** Forgets a guild, e.g. once its player is gone. */
  cancel(guildId: string): void {
    const handle = this.timers.get(guildId);
    if (!handle) return;

    this.clearTimer(handle);
    this.timers.delete(guildId);
  }

  forget(guildId: string): void {
    this.cancel(guildId);
    this.alone.delete(guildId);
  }

  /** Stops every countdown — used on shutdown. */
  stop(): void {
    for (const guildId of [...this.timers.keys()]) this.cancel(guildId);
    this.alone.clear();
  }

  /** True while a guild is counting down, for tests and metrics. */
  isWaiting(guildId: string): boolean {
    return this.timers.has(guildId);
  }

  private async start(guildId: string, reason: IdleReason): Promise<void> {
    const policy = await this.options.policyFor(guildId);
    if (policy.stayConnected) {
      this.cancel(guildId);
      return;
    }

    // Restarting rather than keeping the earlier one: the later trigger is the
    // one that describes why the bot is still here.
    this.cancel(guildId);

    this.timers.set(
      guildId,
      this.setTimer(() => {
        void this.fire(guildId, reason);
      }, policy.idleTimeoutMs),
    );
  }

  private async fire(guildId: string, reason: IdleReason): Promise<void> {
    this.timers.delete(guildId);

    try {
      // Re-read: 24/7 may have been turned on while the clock was running, and
      // the whole point of that setting is that the bot then stays.
      const policy = await this.options.policyFor(guildId);
      if (policy.stayConnected) return;

      await this.options.onTimeout(guildId, reason);
    } catch (error) {
      logger.error({ err: error, guildId, reason }, 'idle disconnect failed');
    }
  }
}
