import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdleMonitor, type IdlePolicy } from '../../src/application/player/idle-monitor';
import { PlayerManager } from '../../src/application/player/player-manager';
import { createTrack } from '../../src/domain/music';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

/** Runs callbacks on demand instead of on the clock. */
class FakeTimers {
  private next = 1;
  private readonly pending = new Map<number, { callback: () => void; ms: number }>();

  readonly set = (callback: () => void, ms: number): NodeJS.Timeout => {
    const id = this.next++;
    this.pending.set(id, { callback, ms });
    return id as unknown as NodeJS.Timeout;
  };

  readonly clear = (handle: NodeJS.Timeout): void => {
    this.pending.delete(handle as unknown as number);
  };

  get count(): number {
    return this.pending.size;
  }

  /** Delay the one pending timer was scheduled with. */
  get delay(): number | undefined {
    return [...this.pending.values()][0]?.ms;
  }

  /** Fires every pending timer, as the event loop eventually would. */
  runAll(): void {
    for (const [id, entry] of [...this.pending]) {
      this.pending.delete(id);
      entry.callback();
    }
  }
}

describe('IdleMonitor', () => {
  let timers: FakeTimers;
  let policy: IdlePolicy;
  let left: Array<{ guildId: string; reason: string }>;
  let monitor: IdleMonitor;

  beforeEach(() => {
    timers = new FakeTimers();
    policy = { stayConnected: false, idleTimeoutMs: 300_000 };
    left = [];

    monitor = new IdleMonitor({
      policyFor: () => policy,
      onTimeout: async (guildId, reason) => {
        left.push({ guildId, reason });
      },
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
  });

  /** Lets the monitor's own awaits settle before asserting. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('leaves after the timeout when the queue runs out', async () => {
    await monitor.idle('guild');
    expect(monitor.isWaiting('guild')).toBe(true);
    expect(timers.delay).toBe(300_000);

    timers.runAll();
    await settle();

    expect(left).toEqual([{ guildId: 'guild', reason: 'queue-empty' }]);
  });

  it('leaves when everyone else goes, even mid-track', async () => {
    await monitor.setAlone('guild', true);
    timers.runAll();
    await settle();

    expect(left).toEqual([{ guildId: 'guild', reason: 'alone' }]);
  });

  it('stops counting when something starts playing', async () => {
    await monitor.idle('guild');
    monitor.active('guild');

    expect(monitor.isWaiting('guild')).toBe(false);
    timers.runAll();
    await settle();
    expect(left).toEqual([]);
  });

  it('keeps counting while alone, even if a track starts', async () => {
    // A track playing to an empty room is not a reason to stay.
    await monitor.setAlone('guild', true);
    monitor.active('guild');

    expect(monitor.isWaiting('guild')).toBe(true);
  });

  it('stops counting when somebody comes back', async () => {
    await monitor.setAlone('guild', true);
    await monitor.setAlone('guild', false);

    expect(monitor.isWaiting('guild')).toBe(false);
    timers.runAll();
    await settle();
    expect(left).toEqual([]);
  });

  it('never starts a timer while 24/7 is on', async () => {
    policy = { stayConnected: true, idleTimeoutMs: 300_000 };

    await monitor.idle('guild');
    await monitor.setAlone('guild', true);

    expect(monitor.isWaiting('guild')).toBe(false);
    expect(timers.count).toBe(0);
  });

  it('stays when 24/7 is turned on during the wait', async () => {
    await monitor.idle('guild');
    // The setting is what matters at the moment of leaving, not the moment the
    // clock started.
    policy = { stayConnected: true, idleTimeoutMs: 300_000 };

    timers.runAll();
    await settle();

    expect(left).toEqual([]);
  });

  it('uses the guild’s own timeout', async () => {
    policy = { stayConnected: false, idleTimeoutMs: 45_000 };

    await monitor.idle('guild');

    expect(timers.delay).toBe(45_000);
  });

  it('keeps one countdown per guild', async () => {
    await monitor.idle('guild');
    await monitor.setAlone('guild', true);

    expect(timers.count).toBe(1);
  });

  it('counts guilds independently', async () => {
    await monitor.idle('one');
    await monitor.idle('two');
    monitor.active('one');

    expect(monitor.isWaiting('one')).toBe(false);
    expect(monitor.isWaiting('two')).toBe(true);
  });

  it('forgets a guild entirely', async () => {
    await monitor.setAlone('guild', true);
    monitor.forget('guild');

    expect(monitor.isWaiting('guild')).toBe(false);
    // Being alone was forgotten too, so activity counts again.
    await monitor.idle('guild');
    monitor.active('guild');
    expect(monitor.isWaiting('guild')).toBe(false);
  });

  it('stops every countdown at once', async () => {
    await monitor.idle('one');
    await monitor.idle('two');

    monitor.stop();

    expect(timers.count).toBe(0);
    expect(monitor.isWaiting('one')).toBe(false);
  });

  it('survives a disconnect that throws', async () => {
    const failing = new IdleMonitor({
      policyFor: () => policy,
      onTimeout: async () => {
        throw new Error('voice gateway is unhappy');
      },
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    await failing.idle('guild');
    expect(() => timers.runAll()).not.toThrow();
    await settle();

    expect(failing.isWaiting('guild')).toBe(false);
  });

  it('does not fire twice for one countdown', async () => {
    await monitor.idle('guild');

    timers.runAll();
    timers.runAll();
    await settle();

    expect(left).toHaveLength(1);
  });
});

describe('PlayerManager with an idle monitor', () => {
  it('starts counting as soon as it joins with nothing to play', async () => {
    const timers = new FakeTimers();
    const monitor = new IdleMonitor({
      policyFor: () => ({ stayConnected: false, idleTimeoutMs: 1000 }),
      onTimeout: async () => {},
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    const backend = new FakeAudioBackend();
    const manager = new PlayerManager(backend, { idle: monitor });
    await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });

    // `join` connects without queueing, so nothing else would ever start it.
    expect(monitor.isWaiting('guild')).toBe(true);
  });

  it('stops counting once a track starts, and resumes when the queue ends', async () => {
    const timers = new FakeTimers();
    const monitor = new IdleMonitor({
      policyFor: () => ({ stayConnected: false, idleTimeoutMs: 1000 }),
      onTimeout: async () => {},
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    const backend = new FakeAudioBackend();
    const manager = new PlayerManager(backend, { idle: monitor });
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });

    await player.enqueue(
      createTrack({
        source: 'youtube',
        identifier: 'a',
        title: 'Faded',
        author: 'Alan Walker',
        durationMs: 1000,
        requesterId: 'user',
      }),
    );
    expect(monitor.isWaiting('guild')).toBe(false);

    player.emit('queueEnd', { guildId: 'guild' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(monitor.isWaiting('guild')).toBe(true);
  });

  it('announces and drops the player when the wait is over', async () => {
    const timers = new FakeTimers();
    const announced: string[] = [];

    const backend = new FakeAudioBackend();
    const monitor = new IdleMonitor({
      policyFor: () => ({ stayConnected: false, idleTimeoutMs: 1000 }),
      onTimeout: (guildId, reason) => manager.leaveIdle(guildId, reason),
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const manager: PlayerManager = new PlayerManager(backend, {
      idle: monitor,
      onIdleLeave: (_player, reason) => {
        announced.push(reason);
      },
    });

    await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    timers.runAll();
    await new Promise((resolve) => setImmediate(resolve));

    expect(announced).toEqual(['queue-empty']);
    expect(manager.has('guild')).toBe(false);
  });

  it('forgets the countdown when the player goes away', async () => {
    const timers = new FakeTimers();
    const monitor = new IdleMonitor({
      policyFor: () => ({ stayConnected: false, idleTimeoutMs: 1000 }),
      onTimeout: async () => {},
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    const backend = new FakeAudioBackend();
    const manager = new PlayerManager(backend, { idle: monitor });
    await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });

    await manager.destroy('guild');

    expect(monitor.isWaiting('guild')).toBe(false);
    expect(timers.count).toBe(0);
  });

  it('ignores an alone signal for a guild it has no player in', async () => {
    const timers = new FakeTimers();
    const monitor = new IdleMonitor({
      policyFor: () => ({ stayConnected: false, idleTimeoutMs: 1000 }),
      onTimeout: async () => {},
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    const manager = new PlayerManager(new FakeAudioBackend(), { idle: monitor });
    await manager.setAlone('guild', true);

    expect(monitor.isWaiting('guild')).toBe(false);
  });
});

// The suite drives its own timers, so nothing here waits on the real clock.
vi.setConfig({ testTimeout: 5_000 });
