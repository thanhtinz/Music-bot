import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { MusicService } from '../../src/application/services/music.service';
import { buildCommands } from '../../src/commands/handlers';
import { createTrack, findInQueue, foldForSearch, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { cardFile } from '../../src/ui/canvas';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string, author = 'Artist'): Track {
  return createTrack({
    source: 'youtube',
    identifier: `${title}-${author}`.toLowerCase(),
    title,
    author,
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
    commandName: 'queue',
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

describe('folding text for a search', () => {
  it('drops the tone marks nobody types into a chat box', () => {
    expect(foldForSearch('Chăm Hoa')).toBe('cham hoa');
    expect(foldForSearch('Lạc Trôi')).toBe('lac troi');
    expect(foldForSearch('Sơn Tùng M-TP')).toBe('son tung m-tp');
  });

  it('folds đ, which is a letter rather than a d with a mark', () => {
    expect(foldForSearch('Đường Tôi Chở Em Về')).toBe('duong toi cho em ve');
  });

  it('collapses the spacing so a stray double space still matches', () => {
    expect(foldForSearch('  Chăm   Hoa ')).toBe('cham hoa');
  });
});

describe('finding a track in the queue', () => {
  const queue = [
    song('Chăm Hoa', 'MONO'),
    song('Lạc Trôi', 'Sơn Tùng M-TP'),
    song('Waiting For You', 'MONO'),
    song('Faded', 'Alan Walker'),
  ];

  it('matches without the diacritics', () => {
    expect(findInQueue(queue, 'cham hoa')).toEqual([{ position: 1, track: queue[0] }]);
  });

  it('matches the artist as readily as the title', () => {
    expect(findInQueue(queue, 'mono').map((match) => match.position)).toEqual([1, 3]);
  });

  it('takes the words in any order, and half-remembered', () => {
    expect(findInQueue(queue, 'hoa mono')).toEqual([{ position: 1, track: queue[0] }]);
    expect(findInQueue(queue, 'lac')).toEqual([{ position: 2, track: queue[1] }]);
  });

  it('reports the positions the queue commands take', () => {
    expect(findInQueue(queue, 'faded')).toEqual([{ position: 4, track: queue[3] }]);
  });

  it('finds nothing for a term that is not there, or for nothing at all', () => {
    expect(findInQueue(queue, 'jazz')).toEqual([]);
    expect(findInQueue(queue, '   ')).toEqual([]);
  });
});

describe('the queue search command', () => {
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(async () => {
    players = new PlayerManager(new FakeAudioBackend(), { defaultVolume: 60, maxQueueSize: 50 });
    service = new MusicService(players, new ResolverRegistry(), { variant: 'sakura' });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([
      song('Playing'),
      song('Chăm Hoa', 'MONO'),
      song('Lạc Trôi', 'Sơn Tùng M-TP'),
      song('Waiting For You', 'MONO'),
    ]);
  });

  it('answers with a card and says how much of the queue matched', async () => {
    const { ctx, replies } = harness();

    await service.findInQueue(ctx, 'mono');

    expect(replies.at(-1)?.attachments?.[0]?.name).toBe(cardFile('queue'));
    expect(replies.at(-1)?.content).toContain('**2** of **3**');
  });

  it('says so rather than drawing an empty card', async () => {
    const { ctx, replies } = harness();

    await service.findInQueue(ctx, 'jazz');

    expect(replies.at(-1)?.content).toContain('Nothing in the queue matches');
    expect(replies.at(-1)?.ephemeral).toBe(true);
    expect(replies.at(-1)?.attachments).toBeUndefined();
  });

  it('refuses when there is no queue at all', async () => {
    await players.destroy('guild');
    const { ctx, replies } = harness();

    await service.findInQueue(ctx, 'mono');

    expect(replies.at(-1)?.content).toContain('queue is empty');
  });

  it('is what `queue <text>` reaches, while `queue 2` still pages', async () => {
    const commands = buildCommands(service, { prefix: '!', botName: 'MusicBot' });
    const queue = commands.find((command) => command.name === 'queue')!;

    const searched = harness({ rest: 'mono' });
    await queue.execute(searched.ctx);
    expect(searched.replies.at(-1)?.content).toContain('match');

    const paged = harness({ rest: '1' });
    await queue.execute(paged.ctx);
    // A page of the queue answers with the card alone, no line above it.
    expect(paged.replies.at(-1)?.content).toBeUndefined();
    expect(paged.replies.at(-1)?.attachments?.[0]?.name).toBe(cardFile('queue'));
  });

  it('leaves the track playing out of the results', async () => {
    const { ctx, replies } = harness();

    // "Playing" holds the highlighted row and is not in the upcoming list, so
    // searching for it finds nothing rather than a row numbered 0.
    await service.findInQueue(ctx, 'playing');

    expect(replies.at(-1)?.content).toContain('Nothing in the queue matches');
  });
});
