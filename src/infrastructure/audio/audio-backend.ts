import type { EventEmitter } from 'node:events';

import type { Track } from '../../domain/music';

/** Why a track stopped playing, normalised across audio backends. */
export type TrackEndReason =
  'finished' | 'replaced' | 'stopped' | 'load-failed' | 'cleanup' | 'stuck';

export interface TrackEndEvent {
  guildId: string;
  track: Track;
  reason: TrackEndReason;
}

export interface TrackErrorEvent {
  guildId: string;
  track: Track;
  error: string;
}

export interface VoiceClosedEvent {
  guildId: string;
  code: number;
  reason: string;
  /** Whether the backend expects to be able to reconnect. */
  recoverable: boolean;
}

/**
 * Events every backend must emit, keyed by guild.
 *
 * Typed as a plain map so both the Lavalink adapter and the in-memory test
 * double can satisfy it without sharing a base class.
 */
export interface AudioBackendEvents {
  trackEnd: [TrackEndEvent];
  trackError: [TrackErrorEvent];
  voiceClosed: [VoiceClosedEvent];
}

export type AudioBackendEmitter = EventEmitter<AudioBackendEvents>;

/**
 * The seam between the music domain and whatever actually moves audio.
 *
 * Nothing above this interface knows Lavalink exists, which is what makes the
 * audio engine replaceable without rewriting commands or the player (spec §1.2).
 */
export interface AudioBackend {
  readonly events: AudioBackendEmitter;

  /** Joins (or moves to) a voice channel. */
  connect(guildId: string, voiceChannelId: string): Promise<void>;
  disconnect(guildId: string): Promise<void>;

  play(guildId: string, track: Track): Promise<void>;
  /** Stops the current track without leaving the channel. */
  stop(guildId: string): Promise<void>;

  setPaused(guildId: string, paused: boolean): Promise<void>;
  seek(guildId: string, positionMs: number): Promise<void>;
  setVolume(guildId: string, volume: number): Promise<void>;
  /** Applies a named filter preset, or clears filters when given `undefined`. */
  setFilter(guildId: string, preset: string | undefined): Promise<void>;

  /** Current playback position in milliseconds. */
  position(guildId: string): number;
}
