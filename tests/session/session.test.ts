import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerManager } from '../../src/application/player';
import {
  InMemorySessionRepository,
  isRestorable,
  isStale,
  restoreSessions,
  SessionRecorder,
  toSession,
  type PlayerSession,
} from '../../src/application/session';
import { createTrack, type Track } from '../../src/domain/music';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string, overrides: Partial<Parameters<typeof createTrack>[0]> = {}): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
    ...overrides,
  });
}

/** Runs callbacks on demand instead of on the clock. */
class FakeTimers {
  private next = 1;
  private readonly pending = new Map<number, () => void>();

  readonly set = (callback: () => void): NodeJS.Timeout => {
    const id = this.next++;
    this.pending.set(id, callback);
    return id as unknown as NodeJS.Timeout;
  };

  readonly clear = (handle: NodeJS.Timeout): void => {
    this.pending.delete(handle as unknown as number);
  };

  get count(): number {
    return this.pending.size;
  }

  runAll(): void {
    for (const [id, callback] of [...this.pending]) {
      this.pending.delete(id);
      callback();
    }
  }
}

describe('toSession', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { defaultVolume: 65, maxQueueSize: 20 });
  });

  it('captures what it takes to come back', async () => {
    const player = await manager.getOrCreate({
      guildId: 'guild',
      voiceChannelId: 'voice',
      textChannelId: 'text',
    });
    await player.enqueue([song('First'), song('Second')]);
    await player.seek(30_000);

    const session = toSession(player, 100);

    expect(session).toMatchObject({
      guildId: 'guild',
      voiceChannelId: 'voice',
      textChannelId: 'text',
      volume: 65,
      positionMs: 30_000,
      wasPaused: false,
      savedAt: 100,
    });
    expect(session.current?.title).toBe('First');
    expect(session.tracks.map((track) => track.title)).toEqual(['Second']);
  });

  it('records a pause, so it comes back paused', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('First'));
    await player.pause();

    expect(toSession(player).wasPaused).toBe(true);
  });

  it('stores no position for a stream', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Radio', { isStream: true, durationMs: 0 }));

    // A live stream has nowhere to come back to.
    expect(toSession(player).positionMs).toBe(0);
  });
});

describe('isRestorable / isStale', () => {
  const base: PlayerSession = {
    guildId: 'guild',
    voiceChannelId: 'voice',
    volume: 70,
    loop: 'off',
    autoplay: false,
    positionMs: 0,
    wasPaused: false,
    tracks: [],
    history: [],
    savedAt: 1000,
  };

  it('is not worth restoring with nothing to play', () => {
    expect(isRestorable(base)).toBe(false);
    expect(isRestorable({ ...base, tracks: [song('One')] })).toBe(true);
    expect(isRestorable({ ...base, current: song('One') })).toBe(true);
  });

  it('is not worth restoring without a channel to go to', () => {
    expect(isRestorable({ ...base, voiceChannelId: '', current: song('One') })).toBe(false);
  });

  it('goes stale', () => {
    expect(isStale(base, 5_000, 4_000)).toBe(false);
    expect(isStale(base, 5_000, 7_000)).toBe(true);
  });
});

describe('SessionRecorder', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;
  let repository: InMemorySessionRepository;
  let timers: FakeTimers;
  let recorder: SessionRecorder;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { maxQueueSize: 20 });
    repository = new InMemorySessionRepository();
    timers = new FakeTimers();
    recorder = new SessionRecorder(repository, { setTimer: timers.set, clearTimer: timers.clear });
  });

  it('saves after the debounce, not on every event', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    recorder.watch(player);
    await player.enqueue([song('One'), song('Two'), song('Three')]);

    // Filling a queue fires an event per track; only one write is pending.
    expect(timers.count).toBe(1);
    expect(await repository.all()).toHaveLength(0);

    timers.runAll();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await repository.all()).toHaveLength(1);
  });

  it('writes immediately when flushed', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('One'));

    await recorder.flush(player);

    expect((await repository.all())[0]?.current?.title).toBe('One');
  });

  it('drops the saved state for a player with nothing to restore', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('One'));
    await recorder.flush(player);

    await player.stop();
    await recorder.flush(player);

    // An empty queue is not worth coming back to.
    expect(await repository.all()).toHaveLength(0);
  });

  it('flushes every player at once', async () => {
    for (const guildId of ['one', 'two']) {
      const player = await manager.getOrCreate({ guildId, voiceChannelId: 'voice' });
      await player.enqueue(song('Track'));
    }

    await recorder.flushAll(manager);

    expect(await repository.all()).toHaveLength(2);
  });

  it('forgets a guild on request', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('One'));
    await recorder.flush(player);

    await recorder.forget('guild');

    expect(await repository.all()).toHaveLength(0);
  });
});

describe('restoreSessions', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;
  let repository: InMemorySessionRepository;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { maxQueueSize: 20 });
    repository = new InMemorySessionRepository();
  });

  /** Saves a session by driving a real player, then forgetting it. */
  async function saveOne(guildId = 'guild'): Promise<void> {
    const source = new PlayerManager(new FakeAudioBackend(), { maxQueueSize: 20 });
    const player = await source.getOrCreate({ guildId, voiceChannelId: 'voice' });
    await player.enqueue([song('First'), song('Second')]);
    await player.seek(42_000);

    await repository.save(toSession(player));
  }

  it('puts the queue back where it was', async () => {
    await saveOne();

    const result = await restoreSessions(manager, repository);

    expect(result.restored).toEqual(['guild']);
    const player = manager.get('guild');
    expect(player?.queue.current?.title).toBe('First');
    expect(player?.queue.tracks.map((track) => track.title)).toEqual(['Second']);
  });

  it('resumes at the saved position rather than the top', async () => {
    await saveOne();

    await restoreSessions(manager, repository);

    expect(backend.calls).toContain('seek:guild:42000');
    expect(manager.get('guild')?.status).toBe('playing');
  });

  it('comes back paused if it was paused', async () => {
    const source = new PlayerManager(new FakeAudioBackend(), { maxQueueSize: 20 });
    const player = await source.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('First'));
    await player.pause();
    await repository.save(toSession(player));

    await restoreSessions(manager, repository);

    expect(manager.get('guild')?.status).toBe('paused');
  });

  it('clears what it restored, so it is not restored twice', async () => {
    await saveOne();

    await restoreSessions(manager, repository);

    expect(await repository.all()).toHaveLength(0);
  });

  it('drops a session that went stale rather than playing into an empty room', async () => {
    await saveOne();

    const result = await restoreSessions(manager, repository, {
      maxAgeMs: 1,
      now: () => Date.now() + 60_000,
    });

    expect(result.restored).toEqual([]);
    expect(result.skipped).toEqual([{ guildId: 'guild', reason: 'stale' }]);
    expect(manager.has('guild')).toBe(false);
  });

  it('drops a session with nothing left to play', async () => {
    await repository.save({
      guildId: 'guild',
      voiceChannelId: 'voice',
      volume: 70,
      loop: 'off',
      autoplay: false,
      positionMs: 0,
      wasPaused: false,
      tracks: [],
      history: [],
      savedAt: Date.now(),
    });

    const result = await restoreSessions(manager, repository);

    expect(result.skipped).toEqual([{ guildId: 'guild', reason: 'empty' }]);
  });

  it('keeps restoring the others when one guild fails', async () => {
    await saveOne('good');
    await saveOne('bad');

    // The channel this guild wants is gone.
    backend.failNextConnect = true;

    const result = await restoreSessions(manager, repository);

    expect(result.restored.length + result.skipped.length).toBe(2);
    expect(result.restored).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('failed');
  });

  it('clears a session it could not restore', async () => {
    await saveOne();
    backend.failNextConnect = true;

    await restoreSessions(manager, repository);

    // It will not restore any better next time.
    expect(await repository.all()).toHaveLength(0);
  });

  it('restores the loop mode and autoplay', async () => {
    const source = new PlayerManager(new FakeAudioBackend(), { maxQueueSize: 20 });
    const player = await source.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('First'));
    player.loop = 'queue';
    player.autoplay = true;
    await repository.save(toSession(player));

    await restoreSessions(manager, repository);

    expect(manager.get('guild')?.loop).toBe('queue');
    expect(manager.get('guild')?.autoplay).toBe(true);
  });

  it('announces each guild it brought back', async () => {
    await saveOne();
    const announced: string[] = [];

    await restoreSessions(manager, repository, {
      onRestored: (session) => {
        announced.push(session.guildId);
      },
    });

    expect(announced).toEqual(['guild']);
  });

  it('does nothing when there is nothing saved', async () => {
    const result = await restoreSessions(manager, repository);

    expect(result).toEqual({ restored: [], skipped: [] });
  });
});
