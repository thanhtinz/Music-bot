import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Player } from '../../src/application/player/player';
import { createTrack, type Track } from '../../src/domain/music';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function track(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'u1',
  });
}

describe('Player', () => {
  let backend: FakeAudioBackend;
  let player: Player;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    player = new Player(backend, { guildId: 'g1', voiceChannelId: 'v1', volume: 70 });
    await player.connect();
  });

  it('connects and applies the starting volume', () => {
    expect(player.status).toBe('ready');
    expect(backend.volumeOf('g1')).toBe(70);
  });

  it('starts playing the first enqueued track', async () => {
    const started = vi.fn();
    player.on('trackStart', started);

    const result = await player.enqueue(track('A'));

    expect(result).toEqual({ started: true, added: 1 });
    expect(player.status).toBe('playing');
    expect(backend.playing('g1')?.title).toBe('A');
    expect(started).toHaveBeenCalledOnce();
  });

  it('queues later tracks instead of interrupting', async () => {
    await player.enqueue(track('A'));
    const result = await player.enqueue(track('B'));

    expect(result.started).toBe(false);
    expect(backend.playing('g1')?.title).toBe('A');
    expect(player.queue.size).toBe(1);
  });

  it('advances to the next track when one finishes', async () => {
    await player.enqueue([track('A'), track('B')]);

    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(backend.playing('g1')?.title).toBe('B');
  });

  it('emits queueEnd and returns to ready when nothing is left', async () => {
    const queueEnd = vi.fn();
    player.on('queueEnd', queueEnd);

    await player.enqueue(track('A'));
    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(queueEnd).toHaveBeenCalledOnce();
    expect(player.status).toBe('ready');
  });

  it('ignores track-end events for other guilds', async () => {
    await player.enqueue([track('A'), track('B')]);
    await player.onTrackEnd({ guildId: 'other', track: track('A'), reason: 'finished' });

    expect(backend.playing('g1')?.title).toBe('A');
  });

  it('does not advance when a track was replaced on purpose', async () => {
    await player.enqueue([track('A'), track('B')]);
    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'replaced' });

    expect(backend.playing('g1')?.title).toBe('A');
  });

  it('pauses and resumes', async () => {
    await player.enqueue(track('A'));

    await player.pause();
    expect(player.status).toBe('paused');
    expect(backend.isPaused('g1')).toBe(true);

    await player.resume();
    expect(player.status).toBe('playing');
    expect(backend.isPaused('g1')).toBe(false);
  });

  it('ignores pause when not playing and resume when not paused', async () => {
    await player.pause();
    expect(player.status).toBe('ready');

    await player.enqueue(track('A'));
    await player.resume();
    expect(player.status).toBe('playing');
  });

  it('skips past loop: song rather than replaying the track', async () => {
    await player.enqueue([track('A'), track('B')]);
    player.loop = 'song';

    const next = await player.skip();

    expect(next?.title).toBe('B');
    expect(player.loop).toBe('song');
  });

  it('replays the current track on loop: song when it finishes naturally', async () => {
    await player.enqueue([track('A'), track('B')]);
    player.loop = 'song';

    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(backend.playing('g1')?.title).toBe('A');
    expect(player.queue.size).toBe(1);
  });

  it('goes back with previous and keeps the queue intact', async () => {
    await player.enqueue([track('A'), track('B')]);
    await player.skip();

    const previous = await player.previous();

    expect(previous?.title).toBe('A');
    expect(backend.playing('g1')?.title).toBe('A');
  });

  it('returns undefined from previous with no history', async () => {
    await player.enqueue(track('A'));
    expect(await player.previous()).toBeUndefined();
  });

  it('stops, clears the queue, and disconnects', async () => {
    await player.enqueue([track('A'), track('B')]);
    await player.stop();

    expect(player.status).toBe('idle');
    expect(player.queue.isEmpty).toBe(true);
    expect(backend.calls).toContain('disconnect:g1');
  });

  it('clamps the volume to a sane range', async () => {
    expect(await player.setVolume(500)).toBe(200);
    expect(await player.setVolume(-10)).toBe(0);
    expect(await player.setVolume(Number.NaN)).toBe(0);
  });

  it('clamps seek to the track duration and ignores streams', async () => {
    await player.enqueue(track('A'));

    await player.seek(999_999);
    expect(backend.position('g1')).toBe(200_000);

    await player.seek(-5);
    expect(backend.position('g1')).toBe(0);

    const live = createTrack({
      source: 'radio',
      identifier: 'lofi',
      title: 'Lo-fi',
      author: 'Station',
      durationMs: 0,
      requesterId: 'u1',
    });
    await player.stop();
    await player.enqueue(live);
    await player.seek(10_000);
    expect(backend.position('g1')).toBe(0);
  });

  it('resets a filter that the backend rejects, keeping the track playing', async () => {
    await player.enqueue(track('A'));
    backend.failFilter = true;
    const onError = vi.fn();
    player.on('error', onError);

    await player.setFilter('nightcore');

    expect(onError).toHaveBeenCalledOnce();
    expect(backend.filterOf('g1')).toBeUndefined();
    expect(backend.playing('g1')?.title).toBe('A');
    expect(player.snapshot().filterPreset).toBeUndefined();
  });

  it('surfaces a failed connection as an error state', async () => {
    const fresh = new Player(backend, { guildId: 'g2', voiceChannelId: 'v2' });
    backend.failNextConnect = true;

    await expect(fresh.connect()).rejects.toThrow('node unavailable');
    expect(fresh.status).toBe('error');
  });

  it('reports a snapshot the UI layer can render', async () => {
    await player.enqueue([track('A'), track('B')]);
    player.loop = 'queue';

    expect(player.snapshot()).toMatchObject({
      guildId: 'g1',
      status: 'playing',
      volume: 70,
      loop: 'queue',
      queueLength: 1,
      autoplay: false,
    });
    expect(player.snapshot().current?.title).toBe('A');
  });
});

describe('Player autoplay', () => {
  it('pulls a related track when the queue empties', async () => {
    const backend = new FakeAudioBackend();
    const resolver = vi.fn(async () => track('Suggested'));
    const player = new Player(backend, {
      guildId: 'g1',
      voiceChannelId: 'v1',
      autoplayResolver: resolver,
    });

    await player.connect();
    player.autoplay = true;
    await player.enqueue(track('A'));

    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(resolver).toHaveBeenCalledOnce();
    expect(backend.playing('g1')?.title).toBe('Suggested');
  });

  it('stops after a bounded streak so it cannot enqueue forever', async () => {
    const backend = new FakeAudioBackend();
    const resolver = vi.fn(async () => track('Suggested'));
    const player = new Player(backend, {
      guildId: 'g1',
      voiceChannelId: 'v1',
      autoplayResolver: resolver,
    });

    await player.connect();
    player.autoplay = true;
    await player.enqueue(track('A'));

    for (let i = 0; i < 40; i += 1) {
      await player.onTrackEnd({
        guildId: 'g1',
        track: track(`round-${i}`),
        reason: 'finished',
      });
    }

    expect(resolver.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('falls back to queueEnd when the resolver throws', async () => {
    const backend = new FakeAudioBackend();
    const player = new Player(backend, {
      guildId: 'g1',
      voiceChannelId: 'v1',
      autoplayResolver: async () => {
        throw new Error('resolver down');
      },
    });
    const queueEnd = vi.fn();
    const onError = vi.fn();
    player.on('queueEnd', queueEnd);
    player.on('error', onError);

    await player.connect();
    player.autoplay = true;
    await player.enqueue(track('A'));
    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(onError).toHaveBeenCalledOnce();
    expect(queueEnd).toHaveBeenCalledOnce();
  });

  it('does nothing when autoplay is off', async () => {
    const backend = new FakeAudioBackend();
    const resolver = vi.fn(async () => track('Suggested'));
    const player = new Player(backend, {
      guildId: 'g1',
      voiceChannelId: 'v1',
      autoplayResolver: resolver,
    });

    await player.connect();
    await player.enqueue(track('A'));
    await player.onTrackEnd({ guildId: 'g1', track: track('A'), reason: 'finished' });

    expect(resolver).not.toHaveBeenCalled();
  });
});
