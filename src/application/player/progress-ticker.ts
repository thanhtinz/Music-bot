import { createLogger } from '../../telemetry/logger';
import type { ReplyHandle } from '../commands';
import type { Player } from './player';
import { progressLine } from './progress-line';

const logger = createLogger('progress-ticker');

/**
 * How often the line is rewritten.
 *
 * Discord does not publish its edit limits, but a message-edit bucket of five
 * requests per five seconds per channel is what everyone observes — so five
 * seconds is the floor, not a target. A bar of eighteen blocks only moves a
 * block every duration/18 anyway: on a four-minute song that is thirteen
 * seconds, and ticking faster than the bar can change is spending requests on
 * nothing.
 */
export const PROGRESS_TICK_MS = 5_000;

export interface ProgressTickerOptions {
  intervalMs?: number;
  /** Injectable so tests do not wait in real time. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

/**
 * Keeps the line above a Now Playing panel moving with the music.
 *
 * Only the text is rewritten — never the card. Editing a message's text leaves
 * its attachment in place, so the image is not re-fetched and the panel does
 * not blink; and no image is encoded, which is where the whole cost of a
 * redrawn card lives.
 *
 * One panel per guild: a second `nowplaying` replaces the first, because two
 * tickers editing two panels would double the requests to say the same thing.
 */
export class ProgressTicker {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** What each guild's line last said, so an unchanged bar costs no request. */
  private readonly rendered = new Map<string, string>();

  private readonly intervalMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;

  constructor(options: ProgressTickerOptions = {}) {
    this.intervalMs = options.intervalMs ?? PROGRESS_TICK_MS;
    this.setTimer = options.setTimer ?? ((callback, ms) => setInterval(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle));
  }

  /** Adopts a freshly sent panel as the one to keep up to date. */
  watch(player: Player, handle: ReplyHandle | undefined): void {
    this.stop(player.guildId);
    if (!handle) return;

    const current = player.queue.current;
    if (!current || current.isStream) return;

    this.rendered.set(player.guildId, lineFor(player));
    this.timers.set(
      player.guildId,
      this.setTimer(() => void this.tick(player, handle), this.intervalMs),
    );
  }

  /** Stops updating a guild's panel. */
  stop(guildId: string): void {
    const timer = this.timers.get(guildId);
    if (timer) this.clearTimer(timer);

    this.timers.delete(guildId);
    this.rendered.delete(guildId);
  }

  /** Stops every guild — for a clean shutdown. */
  stopAll(): void {
    for (const guildId of [...this.timers.keys()]) this.stop(guildId);
  }

  /** Whether a guild's panel is currently being kept up to date. */
  watching(guildId: string): boolean {
    return this.timers.has(guildId);
  }

  private async tick(player: Player, handle: ReplyHandle): Promise<void> {
    const { guildId } = player;

    // Nothing playing means nothing to follow; a paused player gets one last
    // edit saying so, from the state check below, before this catches it.
    if (player.status === 'idle' || player.status === 'error' || !player.queue.current) {
      this.stop(guildId);
      return;
    }

    const line = lineFor(player);
    if (line === this.rendered.get(guildId)) return;

    this.rendered.set(guildId, line);

    try {
      // `false` means the message is gone or its interaction token has expired;
      // either way there is nothing left to edit.
      if (!(await handle.setContent(line))) this.stop(guildId);
    } catch (error) {
      logger.warn({ err: error, guildId }, 'progress line edit failed');
      this.stop(guildId);
    }
  }
}

/** The line a player's current state should show. */
export function lineFor(player: Player): string {
  const current = player.queue.current;

  return progressLine({
    positionMs: player.positionMs,
    durationMs: current?.durationMs ?? 0,
    isStream: current?.isStream ?? false,
    paused: player.status === 'paused',
  });
}
