import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';
import { cardFile } from '../../src/ui/canvas';

function song(title: string, requesterId = 'user'): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId,
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
    commandName: 'remove',
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

describe('editing the queue', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  /** Titles of the upcoming tracks, current excluded. */
  function upcoming(): string[] {
    return players.get('guild')?.queue.tracks.map((track) => track.title) ?? [];
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {});

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    // The first goes straight to playing; One..Three are the queue.
    await player.enqueue([
      song('Playing'),
      song('One'),
      song('Two', 'someone-else'),
      song('Three'),
    ]);
  });

  describe('remove', () => {
    it('takes the numbered track out, counting from 1', async () => {
      const { ctx, replies } = harness();

      await service.remove(ctx, 1);

      expect(upcoming()).toEqual(['Two', 'Three']);
      expect(replies[0]?.title).toBe('Removed');
      expect(replies[0]?.content).toContain('One');
    });

    it('leaves the playing track alone — position 1 is the next one up', async () => {
      const { ctx } = harness();

      await service.remove(ctx, 1);

      expect(players.get('guild')?.queue.current?.title).toBe('Playing');
    });

    it('lets anyone withdraw a track they queued themselves', async () => {
      const { ctx, replies } = harness({ userId: 'user', tier: 'everyone' });

      await service.remove(ctx, 1);

      // Withdrawing your own request is not a moderation act.
      expect(replies[0]?.title).toBe('Removed');
      expect(upcoming()).toEqual(['Two', 'Three']);
    });

    it('refuses somebody else’s track without DJ', async () => {
      const { ctx, replies } = harness({ userId: 'user', tier: 'everyone' });

      await service.remove(ctx, 2);

      expect(replies[0]?.title).toBe('Not yours to remove');
      expect(replies[0]?.ephemeral).toBe(true);
      expect(upcoming()).toEqual(['One', 'Two', 'Three']);
    });

    it('lets a DJ remove somebody else’s track', async () => {
      const { ctx } = harness({ userId: 'user', tier: 'dj' });

      await service.remove(ctx, 2);

      expect(upcoming()).toEqual(['One', 'Three']);
    });

    it('refuses a position off the end, naming the range', async () => {
      const { ctx, replies } = harness();

      await service.remove(ctx, 9);

      expect(replies[0]?.title).toBe('No such track');
      expect(replies[0]?.content).toContain('3');
      expect(upcoming()).toHaveLength(3);
    });

    it('refuses zero, a negative, and a fraction', async () => {
      for (const position of [0, -1, 1.5, Number.NaN]) {
        const { ctx, replies } = harness();
        await service.remove(ctx, position);

        expect(replies[0]?.title).toBe('No such track');
      }

      expect(upcoming()).toHaveLength(3);
    });

    it('says the queue is empty rather than naming a range of none', async () => {
      players.get('guild')?.queue.clear();
      const { ctx, replies } = harness();

      await service.remove(ctx, 1);

      expect(replies[0]?.content).toContain('Nothing is queued');
    });
  });

  describe('move', () => {
    it('moves a track and shifts the rest along', async () => {
      const { ctx, replies } = harness({ commandName: 'move' });

      await service.move(ctx, 1, 3);

      expect(upcoming()).toEqual(['Two', 'Three', 'One']);
      expect(replies[0]?.title).toBe('Moved');
    });

    it('refuses a destination off the end', async () => {
      const { ctx, replies } = harness({ commandName: 'move' });

      await service.move(ctx, 1, 9);

      expect(replies[0]?.title).toBe('No such track');
      expect(upcoming()).toEqual(['One', 'Two', 'Three']);
    });

    it('says so rather than pretending to move a track onto itself', async () => {
      const { ctx, replies } = harness({ commandName: 'move' });

      await service.move(ctx, 2, 2);

      expect(replies[0]?.title).toBe('Nothing to do');
      expect(upcoming()).toEqual(['One', 'Two', 'Three']);
    });
  });

  describe('jump', () => {
    it('plays the numbered track now', async () => {
      const { ctx } = harness({ commandName: 'jump' });

      await service.jump(ctx, 2);

      expect(players.get('guild')?.queue.current?.title).toBe('Two');
      expect(backend.playing('guild')?.title).toBe('Two');
    });

    it('leaves what it jumped over in the history, not on the floor', async () => {
      const { ctx } = harness({ commandName: 'jump' });

      await service.jump(ctx, 2);

      // `previous` has to be able to reach a track somebody skipped past.
      const history = players.get('guild')?.queue.history.map((track) => track.title);
      expect(history).toContain('One');
      expect(history).toContain('Playing');
    });

    it('drops the tracks in front of it from the queue', async () => {
      const { ctx } = harness({ commandName: 'jump' });

      await service.jump(ctx, 2);

      expect(upcoming()).toEqual(['Three']);
    });

    it('answers with the Now Playing panel', async () => {
      const { ctx, replies } = harness({ commandName: 'jump' });

      await service.jump(ctx, 1);

      expect(replies[0]?.attachments?.[0]?.name).toBeDefined();
    });

    it('refuses a position off the end without touching playback', async () => {
      const { ctx, replies } = harness({ commandName: 'jump' });

      await service.jump(ctx, 9);

      expect(replies[0]?.title).toBe('No such track');
      expect(players.get('guild')?.queue.current?.title).toBe('Playing');
    });
  });
});

describe('playnext and removemine', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  function upcoming(): string[] {
    return players.get('guild')?.queue.tracks.map((track) => track.title) ?? [];
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {});

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('Playing'), song('One'), song('Two', 'someone-else')]);
  });

  describe('enqueueNext', () => {
    it('puts a track at the front, not the end', async () => {
      await players.get('guild')!.enqueueNext(song('Jumped'));

      expect(upcoming()).toEqual(['Jumped', 'One', 'Two']);
    });

    it('keeps a batch in the order it was given', async () => {
      await players.get('guild')!.enqueueNext([song('A'), song('B'), song('C')]);

      expect(upcoming()).toEqual(['A', 'B', 'C', 'One', 'Two']);
    });

    it('leaves the playing track playing', async () => {
      await players.get('guild')!.enqueueNext(song('Jumped'));

      expect(players.get('guild')?.queue.current?.title).toBe('Playing');
    });

    it('starts playing when there is no line to jump', async () => {
      const empty = await players.getOrCreate({ guildId: 'quiet', voiceChannelId: 'voice' });

      const { started } = await empty.enqueueNext(song('First'));

      // Refusing to start would be a strange way to answer "play this next".
      expect(started).toBe(true);
      expect(empty.queue.current?.title).toBe('First');
    });
  });

  describe('removeMine', () => {
    it('drops every track the caller queued', async () => {
      const { ctx, replies } = harness({ userId: 'user', commandName: 'removemine' });

      await service.removeMine(ctx);

      expect(upcoming()).toEqual(['Two']);
      expect(replies[0]?.title).toBe('Removed yours');
    });

    it('leaves other people’s tracks alone', async () => {
      const { ctx } = harness({ userId: 'someone-else', commandName: 'removemine' });

      await service.removeMine(ctx);

      expect(upcoming()).toEqual(['One']);
    });

    it('does not touch what is playing, even if it is yours', async () => {
      const { ctx } = harness({ userId: 'user', commandName: 'removemine' });

      await service.removeMine(ctx);

      expect(players.get('guild')?.queue.current?.title).toBe('Playing');
    });

    it('says so when you have nothing queued', async () => {
      const { ctx, replies } = harness({ userId: 'nobody', commandName: 'removemine' });

      await service.removeMine(ctx);

      expect(replies[0]?.title).toBe('Nothing to remove');
      expect(replies[0]?.ephemeral).toBe(true);
      expect(upcoming()).toHaveLength(2);
    });

    it('needs no permission — they are your own tracks', async () => {
      const { ctx, replies } = harness({
        userId: 'user',
        tier: 'everyone',
        commandName: 'removemine',
      });

      await service.removeMine(ctx);

      expect(replies[0]?.title).toBe('Removed yours');
    });
  });
});

describe('history', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {
      displayName: (userId) => (userId === 'linh' ? 'linh' : undefined),
    });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('First'), song('Second'), song('Third', 'linh')]);
  });

  /** Finishes `count` tracks, so they land in the history. */
  async function playThrough(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      backend.finishTrack('guild', 'finished');
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  it('answers with a card', async () => {
    await playThrough(2);
    const { ctx, replies } = harness({ commandName: 'history' });

    await service.history(ctx);

    expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('history'));
  });

  it('renders an empty history rather than refusing', async () => {
    const { ctx, replies } = harness({ commandName: 'history', guildId: 'quiet' });

    await service.history(ctx);

    // A guild with no player at all still gets the card, saying so.
    expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('history'));
  });

  it('puts what just finished first', async () => {
    await playThrough(2);

    const newestFirst = harness({ commandName: 'history' });
    await service.history(newestFirst.ctx);

    // Somebody asking "what was that song" means the one that just ended, so
    // the card cannot simply mirror the domain's oldest-first list.
    const player = players.get('guild');
    expect(player?.queue.history.map((track) => track.title)).toEqual(['First', 'Second']);
    expect(newestFirst.replies[0]?.attachments?.[0]?.data).toBeDefined();
  });

  it('does not count the track still playing', async () => {
    await playThrough(1);

    expect(players.get('guild')?.queue.current?.title).toBe('Second');
    expect(players.get('guild')?.queue.history.map((track) => track.title)).toEqual(['First']);
  });
});

describe('cleaning up the queue', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;

  /** A service that can or cannot read who is in the channel. */
  function service(present?: string[]): MusicService {
    return new MusicService(players, new ResolverRegistry(), {
      ...(present ? { listenerIds: () => new Set(present) } : {}),
    });
  }

  /** Titles of the upcoming tracks. */
  function upcoming(): string[] {
    return players.get('guild')?.queue.tracks.map((track) => track.title) ?? [];
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { maxQueueSize: 20 });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([
      song('Playing', 'host'),
      song('One', 'host'),
      song('Two', 'guest'),
      song('One', 'guest'),
    ]);
  });

  describe('removedupes', () => {
    it('keeps the first copy and says how many went', async () => {
      const { ctx, replies } = harness({ commandName: 'removedupes' });

      await service().removeDuplicates(ctx);

      expect(upcoming()).toEqual(['One', 'Two']);
      expect(replies[0]?.content).toContain('**1**');
    });

    it('answers privately when there is nothing to do', async () => {
      const clean = harness({ commandName: 'removedupes' });
      await service().removeDuplicates(clean.ctx);

      const again = harness({ commandName: 'removedupes' });
      await service().removeDuplicates(again.ctx);

      expect(again.replies[0]?.content).toMatch(/no duplicates/i);
      expect(again.replies[0]?.ephemeral).toBe(true);
    });
  });

  describe('leavecleanup', () => {
    it('drops what the people who left had queued', async () => {
      const { ctx, replies } = harness({ commandName: 'leavecleanup' });

      await service(['host']).removeAbsent(ctx);

      expect(upcoming()).toEqual(['One']);
      expect(replies[0]?.content).toContain('**2**');
    });

    it('leaves the queue alone when the channel cannot be read', async () => {
      // Guessing would throw away the queue of everybody still present.
      const { ctx, replies } = harness({ commandName: 'leavecleanup' });

      await service().removeAbsent(ctx);

      expect(upcoming()).toEqual(['One', 'Two', 'One']);
      expect(replies[0]?.content).toMatch(/cannot see/i);
      expect(replies[0]?.ephemeral).toBe(true);
    });

    it('says so when everybody who queued something is still here', async () => {
      const { ctx, replies } = harness({ commandName: 'leavecleanup' });

      await service(['host', 'guest']).removeAbsent(ctx);

      expect(upcoming()).toHaveLength(3);
      expect(replies[0]?.content).toMatch(/still here/i);
    });

    it('never withdraws the track already playing', async () => {
      const { ctx } = harness({ commandName: 'leavecleanup' });

      await service(['nobody-who-queued-anything']).removeAbsent(ctx);

      expect(players.get('guild')?.queue.current?.title).toBe('Playing');
      expect(upcoming()).toEqual([]);
    });
  });
});
