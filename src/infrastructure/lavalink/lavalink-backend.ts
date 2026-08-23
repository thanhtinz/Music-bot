import { EventEmitter } from 'node:events';

import {
  LoadType,
  type Player as LavalinkPlayer,
  type Shoukaku,
  type Track as LavalinkTrack,
} from 'shoukaku';

import type { Source, Track } from '../../domain/music';
import { ResolverError } from '../../resolvers';
import type { ResolvedPlaylist, TrackCandidate, TrackSearchClient } from '../../resolvers';
import { createLogger } from '../../telemetry/logger';
import type { AudioBackend, AudioBackendEmitter, TrackEndReason } from '../audio/audio-backend';

import { toFilterOptions } from './filters';

const logger = createLogger('lavalink');

/** Key under which a track's Lavalink payload travels in domain metadata. */
export const ENCODED_TRACK_KEY = 'lavalinkEncoded';

export interface LavalinkBackendOptions {
  /** Search prefix used for plain queries, e.g. `ytsearch`. */
  searchPrefix?: string;
  /** Resolves the shard a guild lives on; single-process bots stay on 0. */
  shardIdFor?: (guildId: string) => number;
  /** Join the channel deafened — a bot has no reason to listen. */
  selfDeaf?: boolean;
}

/** Maps Lavalink's `sourceName` onto our domain sources. */
function toSource(sourceName: string): Source {
  switch (sourceName) {
    case 'youtube':
    case 'youtubemusic':
      return 'youtube';
    case 'spotify':
      return 'spotify';
    case 'soundcloud':
      return 'soundcloud';
    case 'http':
    case 'local':
      return 'http';
    default:
      return 'http';
  }
}

/** Converts a Lavalink track into a resolver candidate. */
export function toCandidate(track: LavalinkTrack): TrackCandidate {
  return {
    source: toSource(track.info.sourceName),
    identifier: track.info.identifier,
    title: track.info.title,
    author: track.info.author,
    durationMs: track.info.isStream ? 0 : track.info.length,
    uri: track.info.uri,
    artworkUrl: track.info.artworkUrl,
    isStream: track.info.isStream,
    metadata: {
      [ENCODED_TRACK_KEY]: track.encoded,
      isrc: track.info.isrc,
      sourceName: track.info.sourceName,
    },
  };
}

/** Normalises Lavalink's end reasons onto the backend's vocabulary. */
function toEndReason(reason: string): TrackEndReason {
  switch (reason) {
    case 'finished':
      return 'finished';
    case 'replaced':
      return 'replaced';
    case 'stopped':
      return 'stopped';
    case 'loadFailed':
      return 'load-failed';
    case 'cleanup':
      return 'cleanup';
    default:
      return 'finished';
  }
}

/**
 * Voice close codes Discord considers recoverable.
 *
 * 4014 is "disconnected" — usually a move or a channel delete, and reconnecting
 * is pointless; 4006 invalidates the session and needs a fresh connect.
 */
const FATAL_VOICE_CODES = new Set([4004, 4006, 4011, 4012, 4014, 4016]);

/**
 * Lavalink implementation of {@link AudioBackend} and {@link TrackSearchClient}.
 *
 * This is the only file that knows Lavalink exists. Everything above it works
 * against the two interfaces, which is what keeps the audio engine swappable
 * (spec §1.2).
 */
export class LavalinkBackend implements AudioBackend, TrackSearchClient {
  readonly events: AudioBackendEmitter = new EventEmitter();

  private readonly players = new Map<string, LavalinkPlayer>();
  private readonly searchPrefix: string;
  private readonly shardIdFor: (guildId: string) => number;
  private readonly selfDeaf: boolean;

  constructor(
    private readonly shoukaku: Shoukaku,
    options: LavalinkBackendOptions = {},
  ) {
    this.searchPrefix = options.searchPrefix ?? 'ytsearch';
    this.shardIdFor = options.shardIdFor ?? (() => 0);
    this.selfDeaf = options.selfDeaf ?? true;
  }

  // ── AudioBackend ──────────────────────────────────────────────────────────

  async connect(guildId: string, voiceChannelId: string): Promise<void> {
    const existing = this.players.get(guildId);
    if (existing) {
      // Already connected: a different channel means the user asked us to move.
      await this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
      this.players.delete(guildId);
    }

    const player = await this.shoukaku.joinVoiceChannel({
      guildId,
      channelId: voiceChannelId,
      shardId: this.shardIdFor(guildId),
      deaf: this.selfDeaf,
    });

    this.wire(guildId, player);
    this.players.set(guildId, player);
  }

  async disconnect(guildId: string): Promise<void> {
    this.players.delete(guildId);
    await this.shoukaku.leaveVoiceChannel(guildId).catch((error) => {
      logger.warn({ err: error, guildId }, 'failed to leave voice channel');
    });
  }

  async play(guildId: string, track: Track): Promise<void> {
    const player = this.require(guildId);
    const encoded = track.metadata[ENCODED_TRACK_KEY];

    if (typeof encoded !== 'string') {
      throw new ResolverError(
        'UNAVAILABLE',
        `“${track.title}” has no playable payload — it needs re-resolving.`,
        { source: track.source },
      );
    }

    const startMs = track.metadata.startMs;
    await player.playTrack({
      track: { encoded },
      ...(typeof startMs === 'number' && startMs > 0 ? { position: startMs } : {}),
    });
  }

  async stop(guildId: string): Promise<void> {
    await this.players.get(guildId)?.stopTrack();
  }

  async setPaused(guildId: string, paused: boolean): Promise<void> {
    await this.require(guildId).setPaused(paused);
  }

  async seek(guildId: string, positionMs: number): Promise<void> {
    await this.require(guildId).seekTo(positionMs);
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    // Lavalink takes 0-1000; the domain caps at 200 before we get here.
    await this.require(guildId).setGlobalVolume(volume);
  }

  async setFilter(guildId: string, preset: string | undefined): Promise<void> {
    await this.require(guildId).setFilters(toFilterOptions(preset));
  }

  position(guildId: string): number {
    return this.players.get(guildId)?.position ?? 0;
  }

  // ── TrackSearchClient ─────────────────────────────────────────────────────

  async search(query: string): Promise<TrackCandidate[]> {
    return this.load(`${this.searchPrefix}:${query}`);
  }

  async loadUrl(url: string): Promise<TrackCandidate[]> {
    return this.load(url);
  }

  async loadPlaylist(url: string): Promise<ResolvedPlaylist | null> {
    const node = this.shoukaku.getIdealNode();
    if (!node) throw noNodeError();

    const response = await node.rest.resolve(url);
    if (!response || response.loadType !== LoadType.PLAYLIST) return null;

    const tracks = response.data.tracks.map(toCandidate);
    return {
      name: response.data.info.name,
      source: tracks[0]?.source ?? 'youtube',
      url,
      tracks,
      totalCount: tracks.length,
    };
  }

  /** Sends one identifier to Lavalink and classifies whatever comes back. */
  private async load(identifier: string): Promise<TrackCandidate[]> {
    const node = this.shoukaku.getIdealNode();
    if (!node) throw noNodeError();

    const response = await node.rest.resolve(identifier);
    if (!response) return [];

    switch (response.loadType) {
      case LoadType.TRACK:
        return [toCandidate(response.data)];
      case LoadType.SEARCH:
        return response.data.map(toCandidate);
      case LoadType.PLAYLIST:
        return response.data.tracks.map(toCandidate);
      case LoadType.EMPTY:
        return [];
      case LoadType.ERROR:
        throw classifyLoadError(response.data.message, response.data.severity);
      default:
        return [];
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Bridges Lavalink player events onto the backend's own event surface. */
  private wire(guildId: string, player: LavalinkPlayer): void {
    player.on('end', (event) => {
      this.events.emit('trackEnd', {
        guildId,
        track: asDomainTrack(event.track),
        reason: toEndReason(event.reason),
      });
    });

    player.on('exception', (event) => {
      logger.warn({ guildId, reason: event.exception.message }, 'track exception');
      this.events.emit('trackError', {
        guildId,
        track: asDomainTrack(null),
        error: event.exception.message,
      });
    });

    player.on('stuck', (event) => {
      this.events.emit('trackEnd', {
        guildId,
        track: asDomainTrack(event.track),
        reason: 'stuck',
      });
    });

    player.on('closed', (event) => {
      this.events.emit('voiceClosed', {
        guildId,
        code: event.code,
        reason: event.reason,
        recoverable: !FATAL_VOICE_CODES.has(event.code),
      });
    });
  }

  private require(guildId: string): LavalinkPlayer {
    const player = this.players.get(guildId);
    if (!player) throw new Error(`No Lavalink player for guild ${guildId}`);
    return player;
  }
}

function noNodeError(): ResolverError {
  return new ResolverError('PROVIDER_ERROR', 'No audio node is available right now.', {
    source: 'lavalink',
  });
}

/**
 * Turns a Lavalink load error into a classified resolver error.
 *
 * Lavalink reports these as free text, so matching on the message is the only
 * signal available; anything unrecognised stays a generic provider error rather
 * than being mislabelled.
 */
export function classifyLoadError(message: string, severity: string): ResolverError {
  const text = message.toLowerCase();

  if (text.includes('age') && text.includes('restrict')) {
    return new ResolverError('AGE_RESTRICTED', message, { source: 'lavalink' });
  }
  if (text.includes('private')) {
    return new ResolverError('PRIVATE', message, { source: 'lavalink' });
  }
  if (text.includes('unavailable') || text.includes('removed') || text.includes('deleted')) {
    return new ResolverError('UNAVAILABLE', message, { source: 'lavalink' });
  }
  if (text.includes('rate') && text.includes('limit')) {
    return new ResolverError('RATE_LIMITED', message, { source: 'lavalink' });
  }
  if (text.includes('timeout') || text.includes('timed out')) {
    return new ResolverError('TIMEOUT', message, { source: 'lavalink' });
  }

  // `suspicious` and `fault` are Lavalink's way of saying "our side"; `common`
  // means the request was simply wrong.
  return severity === 'common'
    ? new ResolverError('NOT_FOUND', message, { source: 'lavalink' })
    : new ResolverError('PROVIDER_ERROR', message, { source: 'lavalink' });
}

/**
 * Minimal domain track for an event payload.
 *
 * The player only reads the identity fields off an end event, and Lavalink does
 * not hand back the requester, so this fills in what it can.
 */
function asDomainTrack(track: LavalinkTrack | null): Track {
  return {
    id: track?.info.identifier ?? 'unknown',
    source: track ? toSource(track.info.sourceName) : 'http',
    identifier: track?.info.identifier ?? 'unknown',
    title: track?.info.title ?? 'Unknown title',
    author: track?.info.author ?? 'Unknown artist',
    durationMs: track?.info.length ?? 0,
    uri: track?.info.uri,
    artworkUrl: track?.info.artworkUrl,
    requesterId: '',
    isStream: track?.info.isStream ?? false,
    metadata: track ? { [ENCODED_TRACK_KEY]: track.encoded } : {},
  };
}
