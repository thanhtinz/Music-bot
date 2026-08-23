import { EventEmitter } from 'node:events';

import type { Track } from '../../src/domain/music';
import type {
  AudioBackend,
  AudioBackendEmitter,
  TrackEndReason,
} from '../../src/infrastructure/audio/audio-backend';

interface GuildState {
  voiceChannelId?: string;
  current?: Track;
  paused: boolean;
  volume: number;
  filter?: string;
  positionMs: number;
}

/**
 * In-memory {@link AudioBackend} for tests.
 *
 * Records every call and lets a test drive backend events by hand, so player
 * behaviour is verifiable without a Lavalink node.
 */
export class FakeAudioBackend implements AudioBackend {
  readonly events: AudioBackendEmitter = new EventEmitter();
  readonly calls: string[] = [];

  private readonly guilds = new Map<string, GuildState>();

  /** Set to make the next `connect` reject, simulating a node failure. */
  failNextConnect = false;
  /** Set to make `setFilter` reject, simulating an unsupported preset. */
  failFilter = false;

  async connect(guildId: string, voiceChannelId: string): Promise<void> {
    this.calls.push(`connect:${guildId}:${voiceChannelId}`);

    if (this.failNextConnect) {
      this.failNextConnect = false;
      throw new Error('node unavailable');
    }

    this.state(guildId).voiceChannelId = voiceChannelId;
  }

  async disconnect(guildId: string): Promise<void> {
    this.calls.push(`disconnect:${guildId}`);
    this.guilds.delete(guildId);
  }

  async play(guildId: string, track: Track): Promise<void> {
    this.calls.push(`play:${guildId}:${track.title}`);
    const state = this.state(guildId);
    state.current = track;
    state.paused = false;
    state.positionMs = 0;
  }

  async stop(guildId: string): Promise<void> {
    this.calls.push(`stop:${guildId}`);
    const state = this.state(guildId);
    state.current = undefined;
    state.positionMs = 0;
  }

  async setPaused(guildId: string, paused: boolean): Promise<void> {
    this.calls.push(`${paused ? 'pause' : 'resume'}:${guildId}`);
    this.state(guildId).paused = paused;
  }

  async seek(guildId: string, positionMs: number): Promise<void> {
    this.calls.push(`seek:${guildId}:${positionMs}`);
    this.state(guildId).positionMs = positionMs;
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    this.calls.push(`volume:${guildId}:${volume}`);
    this.state(guildId).volume = volume;
  }

  async setFilter(guildId: string, preset: string | undefined): Promise<void> {
    this.calls.push(`filter:${guildId}:${preset ?? 'none'}`);
    if (this.failFilter && preset) throw new Error(`unsupported filter: ${preset}`);
    this.state(guildId).filter = preset;
  }

  position(guildId: string): number {
    return this.guilds.get(guildId)?.positionMs ?? 0;
  }

  // ── Test controls ────────────────────────────────────────────────────────

  /** What the backend believes is playing. */
  playing(guildId: string): Track | undefined {
    return this.guilds.get(guildId)?.current;
  }

  isPaused(guildId: string): boolean {
    return this.guilds.get(guildId)?.paused ?? false;
  }

  volumeOf(guildId: string): number | undefined {
    return this.guilds.get(guildId)?.volume;
  }

  filterOf(guildId: string): string | undefined {
    return this.guilds.get(guildId)?.filter;
  }

  /** Fires a track-end event for whatever is currently playing. */
  finishTrack(guildId: string, reason: TrackEndReason = 'finished'): void {
    const track = this.guilds.get(guildId)?.current;
    if (!track) throw new Error(`nothing playing in ${guildId}`);
    this.events.emit('trackEnd', { guildId, track, reason });
  }

  failTrack(guildId: string, error = 'stream unavailable'): void {
    const track = this.guilds.get(guildId)?.current;
    if (!track) throw new Error(`nothing playing in ${guildId}`);
    this.events.emit('trackError', { guildId, track, error });
  }

  closeVoice(guildId: string, recoverable = false): void {
    this.events.emit('voiceClosed', {
      guildId,
      code: recoverable ? 4014 : 4006,
      reason: 'test',
      recoverable,
    });
  }

  private state(guildId: string): GuildState {
    let state = this.guilds.get(guildId);
    if (!state) {
      state = { paused: false, volume: 100, positionMs: 0 };
      this.guilds.set(guildId, state);
    }
    return state;
  }
}
