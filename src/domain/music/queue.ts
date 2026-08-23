import { totalDurationMs, type Track } from './track';

export type LoopMode = 'off' | 'song' | 'queue';

export type QueueErrorCode =
  | 'QUEUE_FULL'
  | 'QUEUE_EMPTY'
  | 'POSITION_OUT_OF_RANGE'
  | 'INVALID_POSITION';

/** Domain-level queue failure carrying a code the command layer maps to text. */
export class QueueError extends Error {
  constructor(
    readonly code: QueueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

export interface QueueOptions {
  /** Maximum number of *upcoming* tracks; the current track does not count. */
  maxSize?: number;
  /** How many played tracks to keep for `/previous`. */
  historyLimit?: number;
  /** Injectable RNG so shuffling is testable. Must return `[0, 1)`. */
  random?: () => number;
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Playback queue for a single guild.
 *
 * The queue owns the current track as well as the upcoming list, because loop
 * and previous semantics are only expressible when both live in one place
 * (spec §6.3, §10). All mutations are synchronous and self-contained, so a
 * caller holding the guild's player lock gets atomicity for free.
 */
export class Queue {
  private currentTrack: Track | undefined;
  private upcoming: Track[] = [];
  private played: Track[] = [];
  private loopMode: LoopMode = 'off';

  private readonly maxSize: number;
  private readonly historyLimit: number;
  private readonly random: () => number;

  constructor(options: QueueOptions = {}) {
    this.maxSize = Math.max(1, options.maxSize ?? DEFAULT_MAX_SIZE);
    this.historyLimit = Math.max(0, options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
    this.random = options.random ?? Math.random;
  }

  get current(): Track | undefined {
    return this.currentTrack;
  }

  /** Upcoming tracks in play order. */
  get tracks(): readonly Track[] {
    return this.upcoming;
  }

  /** Previously played tracks, oldest first. */
  get history(): readonly Track[] {
    return this.played;
  }

  get loop(): LoopMode {
    return this.loopMode;
  }

  set loop(mode: LoopMode) {
    this.loopMode = mode;
  }

  /** Number of upcoming tracks, excluding the current one. */
  get size(): number {
    return this.upcoming.length;
  }

  get isEmpty(): boolean {
    return this.upcoming.length === 0 && this.currentTrack === undefined;
  }

  /** Remaining capacity for new tracks. */
  get freeSlots(): number {
    return Math.max(0, this.maxSize - this.upcoming.length);
  }

  get capacity(): number {
    return this.maxSize;
  }

  /** Playtime of the upcoming tracks, ignoring the current track's progress. */
  get totalDurationMs(): number {
    return totalDurationMs(this.upcoming);
  }

  /**
   * Appends tracks to the end of the queue.
   *
   * Rejects the whole batch when it would overflow rather than enqueuing a
   * partial playlist, so the user is never left guessing what got dropped.
   */
  add(input: Track | readonly Track[]): number {
    const tracks = Array.isArray(input) ? [...input] : [input as Track];
    if (tracks.length === 0) return 0;

    if (tracks.length > this.freeSlots) {
      throw new QueueError(
        'QUEUE_FULL',
        `Queue limit is ${this.maxSize} tracks; ${this.freeSlots} slot(s) free, ${tracks.length} requested.`,
      );
    }

    this.upcoming.push(...tracks);
    return tracks.length;
  }

  /** Inserts a track at the front of the queue, to play right after the current one. */
  addNext(track: Track): void {
    if (this.freeSlots < 1) {
      throw new QueueError('QUEUE_FULL', `Queue limit is ${this.maxSize} tracks.`);
    }
    this.upcoming.unshift(track);
  }

  /** Removes the track at a 1-based position and returns it. */
  remove(position: number): Track {
    const index = this.toIndex(position);
    const [removed] = this.upcoming.splice(index, 1);
    // `toIndex` already range-checked, so the splice always yields a track.
    return removed as Track;
  }

  /** Moves a track between 1-based positions, shifting the rest along. */
  move(from: number, to: number): Track {
    const fromIndex = this.toIndex(from);
    const toIndex = this.toIndex(to);

    const [moved] = this.upcoming.splice(fromIndex, 1);
    this.upcoming.splice(toIndex, 0, moved as Track);
    return moved as Track;
  }

  /** Reads the track at a 1-based position without removing it. */
  at(position: number): Track {
    return this.upcoming[this.toIndex(position)] as Track;
  }

  /**
   * Shuffles the upcoming tracks with an unbiased Fisher–Yates pass.
   *
   * The current track is deliberately untouched — shuffling must never
   * interrupt what is playing (spec §6.3).
   */
  shuffle(): void {
    for (let i = this.upcoming.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      const a = this.upcoming[i] as Track;
      const b = this.upcoming[j] as Track;
      this.upcoming[i] = b;
      this.upcoming[j] = a;
    }
  }

  /** Drops every upcoming track. The current track keeps playing. */
  clear(): number {
    const removed = this.upcoming.length;
    this.upcoming = [];
    return removed;
  }

  /** Clears the queue, the current track, and the history. */
  reset(): void {
    this.upcoming = [];
    this.played = [];
    this.currentTrack = undefined;
  }

  /**
   * Advances playback and returns the track that should play next.
   *
   * - `loop: 'song'` replays the current track without touching the queue.
   * - `loop: 'queue'` refills the queue from history once it runs dry.
   * - Otherwise the queue empties out and playback goes idle.
   */
  next(): Track | undefined {
    if (this.loopMode === 'song' && this.currentTrack) {
      return this.currentTrack;
    }

    if (this.currentTrack) this.pushHistory(this.currentTrack);

    if (this.upcoming.length === 0 && this.loopMode === 'queue' && this.played.length > 0) {
      this.upcoming = [...this.played];
      this.played = [];
    }

    this.currentTrack = this.upcoming.shift();
    return this.currentTrack;
  }

  /**
   * Steps back to the previously played track, pushing the current one back
   * onto the front of the queue so nothing is lost.
   */
  previous(): Track | undefined {
    const last = this.played.pop();
    if (!last) return undefined;

    if (this.currentTrack) this.upcoming.unshift(this.currentTrack);
    this.currentTrack = last;
    return last;
  }

  /**
   * Skips straight to a 1-based position, discarding the tracks in between
   * into the history so `/previous` can still reach them.
   */
  jump(position: number): Track {
    const index = this.toIndex(position);

    if (this.currentTrack) this.pushHistory(this.currentTrack);
    const skipped = this.upcoming.splice(0, index + 1);

    for (const track of skipped.slice(0, -1)) this.pushHistory(track);

    this.currentTrack = skipped[skipped.length - 1] as Track;
    return this.currentTrack;
  }

  /** Removes every track queued by one user, e.g. when they leave the channel. */
  removeByRequester(requesterId: string): number {
    const before = this.upcoming.length;
    this.upcoming = this.upcoming.filter((track) => track.requesterId !== requesterId);
    return before - this.upcoming.length;
  }

  /** Serialisable snapshot for Redis-backed recovery (spec §21). */
  toJSON(): {
    current: Track | undefined;
    tracks: Track[];
    history: Track[];
    loop: LoopMode;
  } {
    return {
      current: this.currentTrack,
      tracks: [...this.upcoming],
      history: [...this.played],
      loop: this.loopMode,
    };
  }

  /** Restores a queue from a {@link toJSON} snapshot. */
  static fromJSON(
    snapshot: {
      current?: Track;
      tracks?: Track[];
      history?: Track[];
      loop?: LoopMode;
    },
    options: QueueOptions = {},
  ): Queue {
    const queue = new Queue(options);
    queue.currentTrack = snapshot.current;
    queue.upcoming = [...(snapshot.tracks ?? [])];
    queue.played = [...(snapshot.history ?? [])];
    queue.loopMode = snapshot.loop ?? 'off';
    return queue;
  }

  private pushHistory(track: Track): void {
    if (this.historyLimit === 0) return;

    this.played.push(track);
    if (this.played.length > this.historyLimit) {
      this.played.splice(0, this.played.length - this.historyLimit);
    }
  }

  /** Converts a user-facing 1-based position into a validated array index. */
  private toIndex(position: number): number {
    if (!Number.isInteger(position)) {
      throw new QueueError('INVALID_POSITION', `Position must be a whole number, got ${position}.`);
    }
    if (this.upcoming.length === 0) {
      throw new QueueError('QUEUE_EMPTY', 'The queue is empty.');
    }
    if (position < 1 || position > this.upcoming.length) {
      throw new QueueError(
        'POSITION_OUT_OF_RANGE',
        `Position must be between 1 and ${this.upcoming.length}, got ${position}.`,
      );
    }
    return position - 1;
  }
}
