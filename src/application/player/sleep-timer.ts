import { createLogger } from '../../telemetry/logger';

const logger = createLogger('sleep-timer');

/** The shortest timer worth setting; anything less is a `stop`. */
export const MIN_SLEEP_MS = 10_000;
/** The longest one. A timer nobody remembers setting is a bot that vanishes. */
export const MAX_SLEEP_MS = 12 * 3_600_000;

/** What somebody asked the sleep timer to do. */
export type SleepRequest =
  | { kind: 'after'; ms: number }
  | { kind: 'track' }
  | { kind: 'cancel' }
  | { kind: 'status' }
  | { kind: 'invalid' }
  | { kind: 'too-short' }
  | { kind: 'too-long' };

/** A timer that is currently running, as a card or a reply describes it. */
export type SleepPlan = { kind: 'after'; remainingMs: number } | { kind: 'track' };

export interface SleepTimerOptions {
  /** Called when the wait is over: stop the music and leave. */
  onSleep: (guildId: string) => Promise<void>;
  /** Injectable so tests do not wait in real time. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
  now?: () => number;
}

interface Countdown {
  handle: NodeJS.Timeout;
  endsAt: number;
}

/**
 * Stops the music at a time somebody chose, rather than when the queue runs out.
 *
 * People fall asleep to this bot, and the alternative to a timer is a room
 * playing to nobody until the idle monitor notices — which never happens while
 * a long queue keeps feeding it tracks. Two shapes cover what anyone actually
 * asks for: a duration ("in 30 minutes") and the end of the current track
 * ("let this one finish").
 *
 * "After this track" is a flag rather than a timer on the track's remaining
 * time, because a seek, a pause or a skip would each leave that timer pointing
 * at a moment that no longer means anything. The flag is spent by the track
 * actually ending, whenever that turns out to be.
 */
export class SleepTimer {
  private readonly countdowns = new Map<string, Countdown>();
  /** Guilds waiting for the current track to finish. */
  private readonly afterTrack = new Set<string>();

  private readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;
  private readonly now: () => number;

  constructor(private readonly options: SleepTimerOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.now = options.now ?? (() => Date.now());
  }

  /** Sleeps in `ms`. Replaces any timer already set for the guild. */
  set(guildId: string, ms: number): void {
    this.cancel(guildId);

    this.countdowns.set(guildId, {
      endsAt: this.now() + ms,
      handle: this.setTimer(() => {
        void this.fire(guildId);
      }, ms),
    });
  }

  /** Sleeps once the track that is playing now ends. */
  setAfterTrack(guildId: string): void {
    this.cancel(guildId);
    this.afterTrack.add(guildId);
  }

  /** Whatever was set, unset. True when there was something to cancel. */
  cancel(guildId: string): boolean {
    const countdown = this.countdowns.get(guildId);
    const waiting = this.afterTrack.delete(guildId);

    if (countdown) {
      this.clearTimer(countdown.handle);
      this.countdowns.delete(guildId);
    }

    return Boolean(countdown) || waiting;
  }

  /** What is set for a guild, or `undefined` when nothing is. */
  plan(guildId: string): SleepPlan | undefined {
    if (this.afterTrack.has(guildId)) return { kind: 'track' };

    const countdown = this.countdowns.get(guildId);
    if (!countdown) return undefined;

    return { kind: 'after', remainingMs: Math.max(0, countdown.endsAt - this.now()) };
  }

  /**
   * A track ended.
   *
   * Only the guilds waiting for exactly that sleep here; a countdown keeps
   * running across as many tracks as it has time for.
   */
  async trackEnded(guildId: string): Promise<void> {
    if (!this.afterTrack.delete(guildId)) return;
    await this.fire(guildId);
  }

  /** Stops every timer — used on shutdown, and when a player is destroyed. */
  forget(guildId: string): void {
    this.cancel(guildId);
  }

  stop(): void {
    for (const guildId of [...this.countdowns.keys()]) this.cancel(guildId);
    this.afterTrack.clear();
  }

  private async fire(guildId: string): Promise<void> {
    this.countdowns.delete(guildId);
    this.afterTrack.delete(guildId);

    try {
      await this.options.onSleep(guildId);
    } catch (error) {
      logger.error({ err: error, guildId }, 'sleep timer could not stop playback');
    }
  }
}

/**
 * Reads what somebody typed after `sleep`.
 *
 * A bare number means minutes here, unlike everywhere else in the bot: nobody
 * sets a sleep timer for thirty seconds, and `sleep 30` meaning half a minute
 * would be a trap rather than a shorthand.
 */
export function parseSleepRequest(raw: string | undefined): SleepRequest {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return { kind: 'status' };

  if (['off', 'cancel', 'stop', 'no', 'none', 'clear'].includes(value)) return { kind: 'cancel' };
  if (['track', 'song', 'end', 'endoftrack', 'current', 'this'].includes(value)) {
    return { kind: 'track' };
  }

  if (/^\d+$/.test(value)) return bounded(Number(value) * 60_000);

  const parts = value.match(/^(?:\d+\s*[hms]\s*)+$/) ? value.match(/(\d+)\s*([hms])/g) : null;
  if (!parts) return { kind: 'invalid' };

  const ms = parts.reduce((total, part) => {
    const amount = Number(part.replace(/\D/g, ''));
    if (part.includes('h')) return total + amount * 3_600_000;
    if (part.includes('m')) return total + amount * 60_000;
    return total + amount * 1000;
  }, 0);

  return bounded(ms);
}

function bounded(ms: number): SleepRequest {
  if (ms < MIN_SLEEP_MS) return { kind: 'too-short' };
  if (ms > MAX_SLEEP_MS) return { kind: 'too-long' };
  return { kind: 'after', ms };
}

/**
 * A countdown as a person would say it: `1h 5m`, `9m`, `40s`.
 *
 * Rounded up rather than down, so a timer with four and a half minutes left
 * never reads `4m` — the number people see should not be one they will feel
 * cheated by.
 */
export function formatSleepRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;

  const minutes = Math.ceil(total / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
