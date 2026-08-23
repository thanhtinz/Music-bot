import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerManager } from '../../src/application/player/player-manager';
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

/** Resolves after `ms` of real time — used to force interleaving. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PlayerManager lifecycle', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 5 });
  });

  it('creates one player per guild and reuses it', async () => {
    const first = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });
    const second = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v9' });

    expect(second).toBe(first);
    expect(manager.size).toBe(1);
    // The existing session keeps its channel; moving is an explicit action.
    expect(first.voiceChannelId).toBe('v1');
  });

  it('applies the manager defaults to new players', async () => {
    const player = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });

    expect(player.volume).toBe(60);
    expect(player.queue.capacity).toBe(5);
  });

  it('updates the text channel on reuse', async () => {
    await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 'c1' });
    const player = await manager.getOrCreate({
      guildId: 'g1',
      voiceChannelId: 'v1',
      textChannelId: 'c2',
    });

    expect(player.textChannelId).toBe('c2');
  });

  it('does not retain a player whose connection failed', async () => {
    backend.failNextConnect = true;

    await expect(manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' })).rejects.toThrow(
      'node unavailable',
    );
    expect(manager.has('g1')).toBe(false);
  });

  it('destroys a player and disconnects it', async () => {
    await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });

    await manager.destroy('g1');

    expect(manager.has('g1')).toBe(false);
    expect(backend.calls).toContain('disconnect:g1');
  });

  it('destroying an unknown guild is a no-op', async () => {
    await expect(manager.destroy('nope')).resolves.toBeUndefined();
  });

  it('destroys every player on shutdown', async () => {
    await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });
    await manager.getOrCreate({ guildId: 'g2', voiceChannelId: 'v2' });

    await manager.destroyAll();

    expect(manager.size).toBe(0);
  });
});

describe('PlayerManager backend events', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend);
  });

  it('advances the queue when the backend reports a finished track', async () => {
    const player = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });
    await player.enqueue([track('A'), track('B')]);

    backend.finishTrack('g1');
    await delay(10);

    expect(backend.playing('g1')?.title).toBe('B');
  });

  it('skips past a track the backend could not play', async () => {
    const player = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });
    await player.enqueue([track('A'), track('B')]);

    backend.failTrack('g1');
    await delay(10);

    expect(backend.playing('g1')?.title).toBe('B');
  });

  it('tears the player down on an unrecoverable voice close', async () => {
    await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });

    backend.closeVoice('g1', false);
    await delay(10);

    expect(manager.has('g1')).toBe(false);
  });

  it('keeps the player on a recoverable voice close', async () => {
    const player = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });

    backend.closeVoice('g1', true);
    await delay(10);

    expect(manager.has('g1')).toBe(true);
    expect(player.status).toBe('ready');
  });

  it('ignores events for guilds with no player', async () => {
    expect(() => backend.closeVoice('unknown', false)).not.toThrow();
  });
});

describe('PlayerManager locking', () => {
  it('serialises concurrent work on one guild', async () => {
    const manager = new PlayerManager(new FakeAudioBackend());
    const order: string[] = [];

    const task = (name: string, ms: number) =>
      manager.withLock('g1', async () => {
        order.push(`${name}:start`);
        await delay(ms);
        order.push(`${name}:end`);
      });

    // The first task is the slowest; without a lock its end would land last.
    await Promise.all([task('a', 30), task('b', 10), task('c', 1)]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('lets different guilds run in parallel', async () => {
    const manager = new PlayerManager(new FakeAudioBackend());
    const order: string[] = [];

    await Promise.all([
      manager.withLock('g1', async () => {
        await delay(20);
        order.push('g1');
      }),
      manager.withLock('g2', async () => {
        await delay(1);
        order.push('g2');
      }),
    ]);

    expect(order).toEqual(['g2', 'g1']);
  });

  it('keeps the chain alive after a task throws', async () => {
    const manager = new PlayerManager(new FakeAudioBackend());
    const after = vi.fn();

    const failing = manager.withLock('g1', async () => {
      throw new Error('boom');
    });

    await expect(failing).rejects.toThrow('boom');
    await manager.withLock('g1', after);

    expect(after).toHaveBeenCalledOnce();
  });

  it('propagates the result of the locked work', async () => {
    const manager = new PlayerManager(new FakeAudioBackend());
    await expect(manager.withLock('g1', () => 42)).resolves.toBe(42);
  });

  it('releases the lock entry once the chain drains', async () => {
    const manager = new PlayerManager(new FakeAudioBackend());

    await manager.withLock('g1', async () => delay(1));
    await manager.withLock('g1', async () => delay(1));

    // A second round must still run promptly rather than queue behind a stale
    // promise held from the first.
    const start = Date.now();
    await manager.withLock('g1', () => undefined);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('applies two racing skips in arrival order', async () => {
    const backend = new FakeAudioBackend();
    const manager = new PlayerManager(backend);
    const player = await manager.getOrCreate({ guildId: 'g1', voiceChannelId: 'v1' });
    await player.enqueue([track('A'), track('B'), track('C')]);

    await Promise.all([
      manager.withLock('g1', () => player.skip()),
      manager.withLock('g1', () => player.skip()),
    ]);

    expect(backend.playing('g1')?.title).toBe('C');
    expect(player.queue.size).toBe(0);
  });
});
