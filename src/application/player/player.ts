import { EventEmitter } from 'node:events';

import { Queue, type LoopMode, type Track } from '../../domain/music';
import type {
  AudioBackend,
  TrackEndEvent,
  VoiceClosedEvent,
} from '../../infrastructure/audio/audio-backend';

/** Playback state machine (spec §29). */
export type PlayerStatus = 'idle' | 'connecting' | 'ready' | 'playing' | 'paused' | 'error';

export interface PlayerSnapshot {
  guildId: string;
  voiceChannelId?: string;
  textChannelId?: string;
  status: PlayerStatus;
  current?: Track;
  positionMs: number;
  volume: number;
  loop: LoopMode;
  autoplay: boolean;
  filterPreset?: string;
  queueLength: number;
}

export interface PlayerEvents {
  /** A new track started; the UI layer re-renders the Now Playing panel. */
  trackStart: [{ guildId: string; track: Track }];
  trackEnd: [{ guildId: string; track: Track; reason: string }];
  /** The queue ran dry — autoplay or the idle timer takes over. */
  queueEnd: [{ guildId: string }];
  stateChange: [PlayerSnapshot];
  error: [{ guildId: string; error: unknown }];
}

export interface PlayerOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId?: string;
  volume?: number;
  maxQueueSize?: number;
  /** Resolves a follow-up track when the queue empties and autoplay is on. */
  autoplayResolver?: (seed: Track) => Promise<Track | undefined>;
}

const MIN_VOLUME = 0;
const MAX_VOLUME = 200;
/** Consecutive autoplay additions before we stop, so a bot cannot loop forever (spec §10). */
const AUTOPLAY_STREAK_LIMIT = 20;

/**
 * One guild's playback session: queue, state machine, and backend calls.
 *
 * The player never talks to Discord and never talks to Lavalink — it drives an
 * {@link AudioBackend} and emits events the presentation layer listens to.
 */
export class Player extends EventEmitter<PlayerEvents> {
  readonly guildId: string;
  readonly queue: Queue;

  voiceChannelId: string;
  textChannelId: string | undefined;

  private state: PlayerStatus = 'idle';
  private currentVolume: number;
  private filterPreset: string | undefined;
  private autoplayEnabled = false;
  private autoplayStreak = 0;

  constructor(
    private readonly backend: AudioBackend,
    private readonly options: PlayerOptions,
  ) {
    super();
    this.guildId = options.guildId;
    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId;
    this.currentVolume = clampVolume(options.volume ?? 70);
    this.queue = new Queue({ maxSize: options.maxQueueSize });
  }

  get status(): PlayerStatus {
    return this.state;
  }

  get volume(): number {
    return this.currentVolume;
  }

  get autoplay(): boolean {
    return this.autoplayEnabled;
  }

  set autoplay(enabled: boolean) {
    this.autoplayEnabled = enabled;
    if (!enabled) this.autoplayStreak = 0;
    this.emitState();
  }

  get loop(): LoopMode {
    return this.queue.loop;
  }

  set loop(mode: LoopMode) {
    this.queue.loop = mode;
    this.emitState();
  }

  /** The filter preset in force, if any. */
  get filter(): string | undefined {
    return this.filterPreset;
  }

  get positionMs(): number {
    return this.state === 'idle' ? 0 : this.backend.position(this.guildId);
  }

  /** Connects to voice if needed. Safe to call repeatedly. */
  async connect(voiceChannelId = this.voiceChannelId): Promise<void> {
    this.voiceChannelId = voiceChannelId;

    if (this.state !== 'idle' && this.state !== 'error') return;

    this.setState('connecting');
    try {
      await this.backend.connect(this.guildId, voiceChannelId);
      await this.backend.setVolume(this.guildId, this.currentVolume);
      this.setState('ready');
    } catch (error) {
      this.setState('error');
      this.emit('error', { guildId: this.guildId, error });
      throw error;
    }
  }

  /**
   * Moves to another voice channel.
   *
   * {@link connect} cannot do this: it returns early once connected, so it
   * would change the field and leave the bot where it was. A move also drops
   * the backend's player — Lavalink destroys it on leave — so whatever was
   * playing is restarted from where it had got to rather than from the top.
   */
  async move(voiceChannelId: string, force = false): Promise<void> {
    if (
      !force &&
      voiceChannelId === this.voiceChannelId &&
      this.state !== 'idle' &&
      this.state !== 'error'
    ) {
      return;
    }

    const resuming = this.queue.current;
    // Read before disconnecting: afterwards the backend has no player to ask.
    const positionMs = resuming && !resuming.isStream ? this.positionMs : 0;
    const wasPaused = this.state === 'paused';

    this.voiceChannelId = voiceChannelId;
    this.setState('connecting');

    try {
      await this.backend.connect(this.guildId, voiceChannelId);
      await this.backend.setVolume(this.guildId, this.currentVolume);
      if (this.filterPreset) await this.backend.setFilter(this.guildId, this.filterPreset);
      this.setState('ready');

      if (resuming) {
        await this.backend.play(this.guildId, resuming);
        this.setState('playing');
        if (positionMs > 0) await this.backend.seek(this.guildId, positionMs);
        if (wasPaused) {
          await this.backend.setPaused(this.guildId, true);
          this.setState('paused');
        }
      }
    } catch (error) {
      this.setState('error');
      this.emit('error', { guildId: this.guildId, error });
      throw error;
    }
  }

  /**
   * Re-establishes the session after losing the node it was on.
   *
   * The same work as a move, to the channel it is already in: the backend has
   * to hand the guild to another node, and the track has to be started again
   * there — from where it had got to, so a node dying costs seconds.
   */
  async reconnect(): Promise<void> {
    await this.move(this.voiceChannelId, true);
  }

  /**
   * Puts a saved session back and picks up where it left off.
   *
   * Not {@link enqueue}: the current track and the history have to come back as
   * they were, and re-adding the tracks one by one would lose both. Playback
   * resumes at the saved position rather than from the top, which is the
   * difference between a deploy costing seconds and costing the song.
   */
  async restore(
    snapshot: {
      current?: Track;
      tracks?: Track[];
      history?: Track[];
      loop?: LoopMode;
    },
    playback: { positionMs?: number; paused?: boolean } = {},
  ): Promise<void> {
    this.queue.load(snapshot);

    const current = snapshot.current;
    if (!current) {
      this.emitState();
      return;
    }

    await this.backend.play(this.guildId, current);
    this.setState('playing');

    const positionMs = current.isStream ? 0 : (playback.positionMs ?? 0);
    if (positionMs > 0) await this.backend.seek(this.guildId, positionMs);

    if (playback.paused) {
      await this.backend.setPaused(this.guildId, true);
      this.setState('paused');
    }

    this.emit('trackStart', { guildId: this.guildId, track: current });
  }

  /**
   * Enqueues tracks and starts playback when idle.
   *
   * Returns whether playback started right away, so the caller can choose
   * between "Now playing" and "Added to queue".
   */
  async enqueue(input: Track | readonly Track[]): Promise<{ started: boolean; added: number }> {
    const added = this.queue.add(input);

    if (this.queue.current === undefined) {
      const next = this.queue.next();
      if (next) {
        await this.start(next);
        return { started: true, added };
      }
    }

    this.emitState();
    return { started: false, added };
  }

  /**
   * Queues tracks at the front, to play after the current one.
   *
   * With nothing playing this behaves like {@link enqueue}: there is no line
   * to jump to the front of, and refusing to start would be a strange way to
   * answer "play this next".
   */
  async enqueueNext(input: Track | readonly Track[]): Promise<{ started: boolean; added: number }> {
    const tracks = Array.isArray(input) ? [...(input as readonly Track[])] : [input as Track];

    // Added back to front, so a batch keeps the order it was given in.
    for (const track of [...tracks].reverse()) this.queue.addNext(track);

    if (this.queue.current === undefined) {
      const next = this.queue.next();
      if (next) {
        await this.start(next);
        return { started: true, added: tracks.length };
      }
    }

    this.emitState();
    return { started: false, added: tracks.length };
  }

  /** Plays a track immediately, pushing the current one back onto the queue. */
  async playNow(track: Track): Promise<void> {
    this.queue.addNext(track);
    await this.skip();
  }

  async pause(): Promise<void> {
    if (this.state !== 'playing') return;
    await this.backend.setPaused(this.guildId, true);
    this.setState('paused');
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.backend.setPaused(this.guildId, false);
    this.setState('playing');
  }

  /**
   * Advances to the next track.
   *
   * Loop mode is deliberately bypassed: a user asking to skip wants the next
   * track, not the current one again (spec §6.3).
   */
  async skip(): Promise<Track | undefined> {
    const loop = this.queue.loop;
    this.queue.loop = loop === 'song' ? 'off' : loop;
    const next = this.queue.next();
    this.queue.loop = loop;

    if (!next) {
      await this.handleQueueEnd();
      return undefined;
    }

    await this.start(next);
    return next;
  }

  async previous(): Promise<Track | undefined> {
    const previous = this.queue.previous();
    if (!previous) return undefined;

    await this.start(previous);
    return previous;
  }

  /**
   * Plays the track at a 1-based queue position, right now.
   *
   * What it jumps over goes into the history rather than being dropped, so
   * `previous` can still reach a track somebody skipped past.
   */
  async jumpTo(position: number): Promise<Track> {
    const track = this.queue.jump(position);
    await this.start(track);
    return track;
  }

  /** Stops playback, clears the queue, and leaves the channel. */
  async stop(): Promise<void> {
    this.queue.reset();
    await this.backend.stop(this.guildId);
    await this.backend.disconnect(this.guildId);
    this.setState('idle');
  }

  async seek(positionMs: number): Promise<void> {
    const current = this.queue.current;
    if (!current || current.isStream) return;

    const target = Math.min(Math.max(0, positionMs), current.durationMs);
    await this.backend.seek(this.guildId, target);
    this.emitState();
  }

  async setVolume(volume: number): Promise<number> {
    this.currentVolume = clampVolume(volume);
    await this.backend.setVolume(this.guildId, this.currentVolume);
    this.emitState();
    return this.currentVolume;
  }

  async setFilter(preset: string | undefined): Promise<void> {
    this.filterPreset = preset;
    try {
      await this.backend.setFilter(this.guildId, preset);
    } catch (error) {
      // A bad filter must not take the track down with it (spec §24).
      this.filterPreset = undefined;
      await this.backend.setFilter(this.guildId, undefined).catch(() => undefined);
      this.emit('error', { guildId: this.guildId, error });
    }
    this.emitState();
  }

  /** Handles a backend track-end event for this guild. */
  async onTrackEnd(event: TrackEndEvent): Promise<void> {
    if (event.guildId !== this.guildId) return;

    this.emit('trackEnd', {
      guildId: this.guildId,
      track: event.track,
      reason: event.reason,
    });

    // `replaced` means we already started something else on purpose.
    if (event.reason === 'replaced' || event.reason === 'stopped') return;

    const next = this.queue.next();
    if (next) {
      this.autoplayStreak = 0;
      await this.start(next);
      return;
    }

    await this.handleQueueEnd();
  }

  /** Handles an unexpected voice disconnect. */
  onVoiceClosed(event: VoiceClosedEvent): void {
    if (event.guildId !== this.guildId) return;

    this.setState(event.recoverable ? 'ready' : 'idle');
    if (!event.recoverable) this.queue.reset();
  }

  snapshot(): PlayerSnapshot {
    return {
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      status: this.state,
      current: this.queue.current,
      positionMs: this.positionMs,
      volume: this.currentVolume,
      loop: this.queue.loop,
      autoplay: this.autoplayEnabled,
      filterPreset: this.filterPreset,
      queueLength: this.queue.size,
    };
  }

  private async start(track: Track): Promise<void> {
    if (this.state === 'idle' || this.state === 'error') await this.connect();

    await this.backend.play(this.guildId, track);
    this.setState('playing');
    this.emit('trackStart', { guildId: this.guildId, track });
  }

  /** Runs autoplay if enabled, otherwise goes idle. */
  private async handleQueueEnd(): Promise<void> {
    const seed = this.queue.current ?? this.queue.history.at(-1);

    if (this.autoplayEnabled && seed && this.autoplayStreak < AUTOPLAY_STREAK_LIMIT) {
      try {
        const suggestion = await this.options.autoplayResolver?.(seed);
        if (suggestion) {
          this.autoplayStreak += 1;
          this.queue.add(suggestion);
          const next = this.queue.next();
          if (next) {
            await this.start(next);
            return;
          }
        }
      } catch (error) {
        this.emit('error', { guildId: this.guildId, error });
      }
    }

    this.setState('ready');
    this.emit('queueEnd', { guildId: this.guildId });
  }

  private setState(state: PlayerStatus): void {
    this.state = state;
    this.emitState();
  }

  private emitState(): void {
    this.emit('stateChange', this.snapshot());
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return MIN_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(volume)));
}
