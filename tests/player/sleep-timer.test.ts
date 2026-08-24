import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import {
  formatSleepRemaining,
  MAX_SLEEP_MS,
  parseSleepRequest,
  SleepTimer,
} from '../../src/application/player/sleep-timer';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
  });
}

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    voiceChannelId: 'voice',
    commandName: 'sleep',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'dj',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    async defer() {},
    option: () => undefined,
    ...overrides,
  } as CommandContext;

  return { ctx, replies };
}

/** A timer whose clock the test moves by hand. */
function fakeTimer(onSleep: (guildId: string) => Promise<void>) {
  const pending: { id: number; at: number; run: () => void }[] = [];
  let clock = 1_000;
  let nextId = 1;

  const timer = new SleepTimer({
    onSleep,
    now: () => clock,
    setTimer: (callback, ms) => {
      const id = nextId++;
      pending.push({ id, at: clock + ms, run: callback });
      return id as unknown as NodeJS.Timeout;
    },
    clearTimer: (handle) => {
      const index = pending.findIndex((entry) => entry.id === (handle as unknown as number));
      if (index >= 0) pending.splice(index, 1);
    },
  });

  return {
    timer,
    /** Moves the clock, running anything that comes due. */
    async advance(ms: number): Promise<void> {
      clock += ms;
      for (const entry of pending.filter((candidate) => candidate.at <= clock)) {
        pending.splice(pending.indexOf(entry), 1);
        entry.run();
      }
      // The callback is fired without being awaited, as a real timer would.
      await Promise.resolve();
      await Promise.resolve();
    },
    pending,
  };
}

describe('reading a sleep request', () => {
  it('takes a bare number as minutes, not seconds', () => {
    expect(parseSleepRequest('30')).toEqual({ kind: 'after', ms: 30 * 60_000 });
  });

  it('reads a length', () => {
    expect(parseSleepRequest('1h30m')).toEqual({ kind: 'after', ms: 90 * 60_000 });
    expect(parseSleepRequest('45 s')).toEqual({ kind: 'after', ms: 45_000 });
  });

  it('knows the words for the end of the track and for off', () => {
    expect(parseSleepRequest('track').kind).toBe('track');
    expect(parseSleepRequest('END').kind).toBe('track');
    expect(parseSleepRequest('off').kind).toBe('cancel');
    expect(parseSleepRequest('cancel').kind).toBe('cancel');
  });

  it('asks what was meant rather than guessing', () => {
    expect(parseSleepRequest('soonish').kind).toBe('invalid');
    expect(parseSleepRequest('30 bananas').kind).toBe('invalid');
  });

  it('refuses a timer that is not one, and one that outlives the night', () => {
    expect(parseSleepRequest('5s').kind).toBe('too-short');
    expect(parseSleepRequest('20h').kind).toBe('too-long');
    expect(parseSleepRequest(`${MAX_SLEEP_MS / 60_000}m`).kind).toBe('after');
  });

  it('reads nothing at all as a question', () => {
    expect(parseSleepRequest(undefined).kind).toBe('status');
    expect(parseSleepRequest('  ').kind).toBe('status');
  });
});

describe('a countdown as people say it', () => {
  it('rounds up, so nobody feels short-changed', () => {
    expect(formatSleepRemaining(4.5 * 60_000)).toBe('5m');
    expect(formatSleepRemaining(59_000)).toBe('59s');
    expect(formatSleepRemaining(60 * 60_000)).toBe('1h');
    expect(formatSleepRemaining(65 * 60_000)).toBe('1h 5m');
  });
});

describe('the sleep timer', () => {
  it('sleeps when the time is up', async () => {
    const slept: string[] = [];
    const { timer, advance } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    timer.set('guild', 30 * 60_000);

    await advance(29 * 60_000);
    expect(slept).toEqual([]);

    await advance(60_000);
    expect(slept).toEqual(['guild']);
  });

  it('counts down from the moment it was set', () => {
    const { timer } = fakeTimer(async () => {});

    timer.set('guild', 10 * 60_000);

    expect(timer.plan('guild')).toEqual({ kind: 'after', remainingMs: 10 * 60_000 });
  });

  it('replaces a timer rather than stacking one on top', async () => {
    const slept: string[] = [];
    const { timer, advance, pending } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    timer.set('guild', 30 * 60_000);
    timer.set('guild', 5 * 60_000);
    expect(pending).toHaveLength(1);

    await advance(31 * 60_000);
    expect(slept).toEqual(['guild']);
  });

  it('waits for the track to end, however long that takes', async () => {
    const slept: string[] = [];
    const { timer, advance } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    timer.setAfterTrack('guild');

    // No clock runs it: only the track ending does.
    await advance(6 * 3_600_000);
    expect(slept).toEqual([]);

    await timer.trackEnded('guild');
    expect(slept).toEqual(['guild']);
  });

  it('lets a track end in another guild without touching this one', async () => {
    const slept: string[] = [];
    const { timer } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    timer.setAfterTrack('guild');
    await timer.trackEnded('other');

    expect(slept).toEqual([]);
    expect(timer.plan('guild')).toEqual({ kind: 'track' });
  });

  it('is spent once, so the next track plays on', async () => {
    const slept: string[] = [];
    const { timer } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    timer.setAfterTrack('guild');
    await timer.trackEnded('guild');
    await timer.trackEnded('guild');

    expect(slept).toEqual(['guild']);
  });

  it('cancels, and says whether there was anything to cancel', async () => {
    const slept: string[] = [];
    const { timer, advance } = fakeTimer(async (guildId) => {
      slept.push(guildId);
    });

    expect(timer.cancel('guild')).toBe(false);

    timer.set('guild', 60_000);
    expect(timer.cancel('guild')).toBe(true);

    await advance(120_000);
    expect(slept).toEqual([]);
    expect(timer.plan('guild')).toBeUndefined();
  });

  it('keeps a failed stop to itself', async () => {
    const { timer, advance } = fakeTimer(async () => {
      throw new Error('the node is gone');
    });

    timer.set('guild', 60_000);

    await expect(advance(60_000)).resolves.toBeUndefined();
    expect(timer.plan('guild')).toBeUndefined();
  });
});

describe('the sleep command', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;
  let timer: SleepTimer;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    timer = new SleepTimer({ onSleep: async () => {} });
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20, sleep: timer });
    service = new MusicService(players, new ResolverRegistry(), { sleep: timer });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Playing'));
  });

  it('sets a timer and says how long it runs', async () => {
    const { ctx, replies } = harness({ option: () => '30' });

    await service.sleep(ctx, '30');

    expect(timer.plan('guild')?.kind).toBe('after');
    expect(replies.at(-1)?.content).toContain('30m');
  });

  it('names the track it will stop after', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, 'track');

    expect(timer.plan('guild')).toEqual({ kind: 'track' });
    expect(replies.at(-1)?.content).toContain('Playing');
  });

  it('reports what is set when asked nothing', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, undefined);
    expect(replies.at(-1)?.content).toContain('No sleep timer');

    await service.sleep(ctx, 'track');
    await service.sleep(ctx, undefined);
    expect(replies.at(-1)?.content).toContain('current track');
  });

  it('cancels, and does not pretend it cancelled nothing', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, 'off');
    expect(replies.at(-1)?.content).toContain('no sleep timer');

    await service.sleep(ctx, '30');
    await service.sleep(ctx, 'off');
    expect(replies.at(-1)?.content).toContain('cancelled');
    expect(timer.plan('guild')).toBeUndefined();
  });

  it('says what it could not read', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, 'soonish');

    expect(replies.at(-1)?.content).toContain('`sleep 30`');
    expect(timer.plan('guild')).toBeUndefined();
  });

  it('sends whoever wants the music off now to stop', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, '5s');

    expect(replies.at(-1)?.content).toContain('`stop`');
  });

  it('will not run longer than a night', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, '20h');

    expect(replies.at(-1)?.content).toContain('12h');
    expect(timer.plan('guild')).toBeUndefined();
  });

  it('refuses to set one when nothing is playing', async () => {
    await players.destroy('guild');
    const { ctx, replies } = harness();

    await service.sleep(ctx, '30');

    expect(replies.at(-1)?.content).toContain('Nothing is playing');
    expect(timer.plan('guild')).toBeUndefined();
  });

  it('says so when the bot has no timer at all', async () => {
    const bare = new MusicService(players, new ResolverRegistry(), {});
    const { ctx, replies } = harness();

    await bare.sleep(ctx, '30');

    expect(replies.at(-1)?.content).toContain('not running');
  });

  it('goes away with the player, so it cannot stop a later session', async () => {
    const { ctx } = harness();
    await service.sleep(ctx, '30');

    await players.destroy('guild');

    expect(timer.plan('guild')).toBeUndefined();
  });

  it('answers a question privately and an action out loud', async () => {
    const { ctx, replies } = harness();

    await service.sleep(ctx, undefined);
    expect(replies.at(-1)?.ephemeral).toBe(true);

    await service.sleep(ctx, '30');
    expect(replies.at(-1)?.ephemeral).toBeUndefined();
  });

  it('is reachable as sleep, however it was typed', async () => {
    const spy = vi.spyOn(service, 'sleep').mockResolvedValue();
    const { buildCommands } = await import('../../src/commands/handlers');
    const commands = buildCommands(service, { prefix: '!', botName: 'MusicBot' });
    const command = commands.find((candidate) => candidate.name === 'sleep');

    expect(command?.aliases).toContain('bedtime');

    const { ctx } = harness({ rest: 'track' });
    await command!.execute(ctx);

    expect(spy).toHaveBeenCalledWith(ctx, 'track');
  });
});
