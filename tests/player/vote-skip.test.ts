import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'listener',
    voiceChannelId: 'voice',
    commandName: 'skip',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'everyone',
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

function song(title: string, requesterId = 'queuer'): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId,
  });
}

describe('vote to skip', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let listeners: number;
  let service: MusicService;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    listeners = 4;
    service = new MusicService(players, new ResolverRegistry(), {
      listenerCount: () => listeners,
    });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('First'), song('Second')]);
  });

  it('opens a vote instead of skipping for an ordinary listener', async () => {
    const { ctx, replies } = harness();

    await service.skip(ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('First');
    expect(replies[0]?.title).toBe('Vote to skip');
    expect(replies[0]?.content).toContain('**1/2**');
  });

  it('skips once the majority has asked', async () => {
    await service.skip(harness({ userId: 'alice' }).ctx);
    const { ctx } = harness({ userId: 'bob' });
    await service.skip(ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('does not let one person vote twice to carry it', async () => {
    await service.skip(harness({ userId: 'alice' }).ctx);
    const { ctx, replies } = harness({ userId: 'alice' });
    await service.skip(ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('First');
    expect(replies[0]?.content).toContain('**1/2**');
  });

  it('lets a DJ skip outright', async () => {
    await service.skip(harness({ tier: 'dj' }).ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('lets whoever queued it skip their own track', async () => {
    // It is theirs to withdraw; nobody else has to agree.
    await service.skip(harness({ userId: 'queuer' }).ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('skips without a vote when nobody else is listening', async () => {
    listeners = 1;

    await service.skip(harness().ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('falls back to one vote when the room cannot be counted', async () => {
    const unknown = new MusicService(players, new ResolverRegistry(), {
      listenerCount: () => undefined,
    });

    await unknown.skip(harness().ctx);

    // Refusing to skip on missing information would be worse than skipping.
    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('starts a fresh vote for the next track', async () => {
    await service.skip(harness({ userId: 'alice' }).ctx);
    await service.skip(harness({ userId: 'bob' }).ctx);
    expect(players.get('guild')?.queue.current?.title).toBe('Second');

    const { ctx, replies } = harness({ userId: 'alice' });
    await service.skip(ctx);

    // Alice's earlier vote was about a song that is already over.
    expect(replies[0]?.content).toContain('**1/2**');
    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('needs fewer votes once people leave', async () => {
    await service.skip(harness({ userId: 'alice' }).ctx);
    expect(players.get('guild')?.queue.current?.title).toBe('First');

    listeners = 2;
    const { ctx } = harness({ userId: 'alice' });
    await service.skip(ctx);

    // One vote is now a majority, and Alice already cast it.
    expect(players.get('guild')?.queue.current?.title).toBe('Second');
  });

  it('says so at the end of the queue rather than opening a vote', async () => {
    await service.skip(harness({ tier: 'dj' }).ctx);
    const { ctx, replies } = harness({ tier: 'dj' });
    await service.skip(ctx);

    expect(replies[0]?.title).toBe('End of queue');
  });

  it('keeps one guild’s vote out of another’s', async () => {
    const other = await players.getOrCreate({ guildId: 'other', voiceChannelId: 'voice-b' });
    await other.enqueue([song('Theirs'), song('Next')]);

    await service.skip(harness({ userId: 'alice' }).ctx);
    await service.skip(harness({ userId: 'bob', guildId: 'other' }).ctx);

    expect(players.get('guild')?.queue.current?.title).toBe('First');
    expect(players.get('other')?.queue.current?.title).toBe('Theirs');
  });
});
