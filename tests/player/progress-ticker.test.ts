import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplyHandle } from '../../src/application/commands';
import { Player } from '../../src/application/player/player';
import { ProgressTicker } from '../../src/application/player/progress-ticker';
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

/** A clock the test drives by hand, so nothing waits in real time. */
function fakeClock() {
  const callbacks: (() => void)[] = [];

  return {
    setTimer: (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as unknown as NodeJS.Timeout;
    },
    clearTimer: (handle: NodeJS.Timeout) => {
      callbacks.splice(Number(handle) - 1, 1, () => undefined);
    },
    /** Fires every live timer once and lets their promises settle. */
    async tick() {
      for (const callback of [...callbacks]) callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('ProgressTicker', () => {
  let backend: FakeAudioBackend;
  let player: Player;
  let clock: ReturnType<typeof fakeClock>;
  let ticker: ProgressTicker;
  let lines: string[];
  let handle: ReplyHandle;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    player = new Player(backend, { guildId: 'g1', voiceChannelId: 'v1', volume: 70 });
    await player.connect();
    await player.enqueue(song('Playing'));

    clock = fakeClock();
    ticker = new ProgressTicker({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    lines = [];
    handle = {
      async setContent(content: string) {
        lines.push(content);
        return true;
      },
    };
  });

  it('rewrites the line as the track plays', async () => {
    ticker.watch(player, handle);

    await player.seek(60_000);
    await clock.tick();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('1:00 / 3:20');
  });

  it('spends no request while the bar has not moved', async () => {
    ticker.watch(player, handle);

    await clock.tick();
    await clock.tick();

    // Ticking faster than the bar can change would buy nothing and cost a
    // request every time.
    expect(lines).toHaveLength(0);
  });

  it('says so once when the player is paused, then goes quiet', async () => {
    ticker.watch(player, handle);
    await player.seek(60_000);
    await player.pause();

    await clock.tick();
    await clock.tick();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/paused$/);
  });

  it('stops when the message can no longer be edited', async () => {
    // A deleted panel, or an interaction token past its fifteen minutes.
    const gone: ReplyHandle = { setContent: async () => false };
    ticker.watch(player, gone);

    await player.seek(60_000);
    await clock.tick();

    expect(ticker.watching('g1')).toBe(false);
  });

  it('stops when the edit throws', async () => {
    const failing: ReplyHandle = {
      setContent: vi.fn(async () => {
        throw new Error('network');
      }),
    };
    ticker.watch(player, failing);

    await player.seek(60_000);
    await clock.tick();

    expect(ticker.watching('g1')).toBe(false);
  });

  it('stops once nothing is playing', async () => {
    ticker.watch(player, handle);

    await player.stop();
    await clock.tick();

    expect(ticker.watching('g1')).toBe(false);
  });

  it('follows one panel per guild', async () => {
    ticker.watch(player, handle);

    const second: string[] = [];
    ticker.watch(player, {
      async setContent(content: string) {
        second.push(content);
        return true;
      },
    });

    await player.seek(60_000);
    await clock.tick();

    // Two tickers editing two panels would double the requests to say the
    // same thing.
    expect(lines).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it('leaves a live stream alone', async () => {
    const radio = new Player(backend, { guildId: 'g2', voiceChannelId: 'v2', volume: 70 });
    await radio.connect();
    await radio.enqueue(song('Radio', { isStream: true, durationMs: 0 }));

    ticker.watch(radio, handle);

    // There is no position to follow, so a timer would edit nothing forever.
    expect(ticker.watching('g2')).toBe(false);
  });

  it('does nothing without a panel to edit', () => {
    ticker.watch(player, undefined);

    expect(ticker.watching('g1')).toBe(false);
  });

  it('stops every guild at once', async () => {
    ticker.watch(player, handle);
    ticker.stopAll();

    expect(ticker.watching('g1')).toBe(false);
  });
});
