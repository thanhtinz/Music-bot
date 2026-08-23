import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import {
  InMemoryStatsRepository,
  isServerWord,
  parseUserId,
  StatsService,
} from '../../src/application/stats';
import { createTrack, type Track } from '../../src/domain/music';
import { createGuildStats, recordPlay, type GuildStats } from '../../src/domain/stats';
import { expectCardImage } from '../helpers/card-image';
import { cardFile } from '../../src/ui/canvas';

/** Snowflake-shaped, because that is what a real mention resolves to. */
const IDS = {
  me: '100000000000000001',
  linh: '200000000000000002',
  minh: '300000000000000003',
} as const;

const NAMES: Record<string, string> = {
  [IDS.me]: 'thanhtinz',
  [IDS.linh]: 'linh',
};

function song(title: string, author: string, requesterId: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author,
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
    userId: IDS.me,
    commandName: 'stats',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'member',
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

/** A guild with a little history behind it. */
function seeded(): GuildStats {
  let stats = createGuildStats('guild', 1_000);

  const plays: Array<[Track, number]> = [
    [song('Chăm Hoa', 'MONO', IDS.me), 3],
    [song('Lạc Trôi', 'Sơn Tùng M-TP', IDS.linh), 2],
    [song('Nevada', 'Vicetone', IDS.minh), 1],
  ];

  for (const [track, count] of plays) {
    for (let index = 0; index < count; index += 1) {
      stats = recordPlay(stats, {
        track,
        userId: track.requesterId,
        listenedMs: 180_000,
        playedAt: 2_000,
      });
    }
  }

  return stats;
}

describe('StatsService, for the server', () => {
  let repository: InMemoryStatsRepository;
  let service: StatsService;

  beforeEach(() => {
    repository = new InMemoryStatsRepository();
    service = new StatsService(repository, {
      guildName: () => 'Melody Test Server',
      displayName: (userId) => NAMES[userId],
    });
  });

  it('sends a card once there is something to show', async () => {
    await repository.save(seeded());
    const { ctx, replies } = harness({ args: ['server'] });

    await service.show(ctx);

    const attachment = replies[0]?.attachments?.[0];
    expect(attachment?.name).toBe(cardFile('stats'));
    expectCardImage(attachment?.data);
  });

  it('says so plainly when nothing has been played', async () => {
    const { ctx, replies } = harness({ args: ['server'] });

    await service.show(ctx);

    // An empty chart looks broken; a sentence does not.
    expect(replies[0]?.attachments).toBeUndefined();
    expect(replies[0]?.title).toBe('No stats yet');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('treats a guild nobody has played in as empty rather than failing', async () => {
    const { ctx, replies } = harness({ guildId: 'never-seen', args: ['server'] });

    await service.show(ctx);

    expect(replies[0]?.title).toBe('No stats yet');
  });

  it('renders a different card for a caller with their own numbers', async () => {
    await repository.save(seeded());

    const mine = harness({ userId: IDS.me, args: ['server'] });
    const theirs = harness({ userId: '900000000000000009', args: ['server'] });
    await service.show(mine.ctx);
    await service.show(theirs.ctx);

    // The "queued by you" panel is per caller, so the pictures cannot match.
    const first = mine.replies[0]?.attachments?.[0]?.data;
    const second = theirs.replies[0]?.attachments?.[0]?.data;
    expect(first?.equals(second!)).toBe(false);
  });

  it('renders without a display-name resolver', async () => {
    await repository.save(seeded());
    const anonymous = new StatsService(repository);
    const { ctx, replies } = harness({ args: ['server'] });

    await service.show(ctx);
    await anonymous.show(ctx);

    // A raw snowflake is unreadable and is somebody's account id, so the card
    // falls back to a stand-in rather than printing it.
    expectCardImage(replies[1]?.attachments?.[0]?.data);
    expect(replies[0]?.attachments?.[0]?.data.equals(replies[1]!.attachments![0]!.data)).toBe(
      false,
    );
  });

  it('reads only — showing the card records nothing', async () => {
    const before = seeded();
    await repository.save(before);

    await service.show(harness({ args: ['server'] }).ctx);

    expect(await repository.find('guild')).toEqual(before);
  });
});

describe('StatsService, for one person', () => {
  let repository: InMemoryStatsRepository;
  let service: StatsService;

  beforeEach(async () => {
    repository = new InMemoryStatsRepository();
    service = new StatsService(repository, {
      guildName: () => 'Melody Test Server',
      displayName: (userId) => NAMES[userId],
    });
    await repository.save(seeded());
  });

  it('takes a mention as the person to report on', async () => {
    const { ctx, replies } = harness({ args: [`<@${IDS.linh}>`] });

    await service.show(ctx);

    expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('stats'));
  });

  it('reads the slash option and the message argument the same way', async () => {
    const slash = harness({
      option: (name) => (name === 'target' ? `<@${IDS.linh}>` : undefined),
    });
    const prefix = harness({ args: [`<@!${IDS.linh}>`] });

    await service.show(slash.ctx);
    await service.show(prefix.ctx);

    expect(
      slash.replies[0]?.attachments?.[0]?.data.equals(prefix.replies[0]!.attachments![0]!.data),
    ).toBe(true);
  });

  it('shows that person, not the server', async () => {
    const member = harness({ args: [IDS.linh] });
    const guild = harness({ args: ['server'] });

    await service.show(member.ctx);
    await service.show(guild.ctx);

    expect(
      member.replies[0]?.attachments?.[0]?.data.equals(guild.replies[0]!.attachments![0]!.data),
    ).toBe(false);
  });

  it('says so plainly for somebody who has never queued anything', async () => {
    const { ctx, replies } = harness({ args: [`<@${IDS.minh}999>`] });

    await service.show(ctx);

    // A card of empty columns says less than the sentence does.
    expect(replies[0]?.attachments).toBeUndefined();
    expect(replies[0]?.title).toBe('Nothing to show');
  });

  it('asks again rather than guessing at something that is not a user', async () => {
    const { ctx, replies } = harness({ args: ['nobody'] });

    await service.show(ctx);

    expect(replies[0]?.title).toBe('Who?');
    expect(replies[0]?.content).toContain('nobody');
  });

  it('does not treat a stray argument as an empty-server answer', async () => {
    await repository.save(createGuildStats('empty', 1_000));
    const { ctx, replies } = harness({ guildId: 'empty', args: ['nobody'] });

    await service.show(ctx);

    // The complaint about the argument comes first: telling someone the server
    // is empty does not answer the thing they typed wrong.
    expect(replies[0]?.title).toBe('Who?');
  });
});

describe('parseUserId', () => {
  it('reads a mention, a nickname mention, and a raw id', () => {
    expect(parseUserId('<@100000000000000001>')).toBe('100000000000000001');
    expect(parseUserId('<@!100000000000000001>')).toBe('100000000000000001');
    expect(parseUserId('  100000000000000001 ')).toBe('100000000000000001');
  });

  it('refuses anything that is not an id', () => {
    expect(parseUserId(undefined)).toBeUndefined();
    expect(parseUserId('')).toBeUndefined();
    expect(parseUserId('linh')).toBeUndefined();
    expect(parseUserId('<@&100000000000000001>')).toBeUndefined();
    expect(parseUserId('123')).toBeUndefined();
  });
});

describe('StatsService, choosing who to report on', () => {
  let repository: InMemoryStatsRepository;
  let service: StatsService;

  beforeEach(async () => {
    repository = new InMemoryStatsRepository();
    service = new StatsService(repository, {
      guildName: () => 'Melody Test Server',
      displayName: (userId) => NAMES[userId],
    });
    await repository.save(seeded());
  });

  /** The card a given invocation produces. */
  async function card(overrides: Parameters<typeof harness>[0]): Promise<Buffer> {
    const { ctx, replies } = harness(overrides);
    await service.show(ctx);

    const data = replies[0]?.attachments?.[0]?.data;
    if (!data) throw new Error(`no card: ${JSON.stringify(replies[0]?.title)}`);
    return data;
  }

  it('answers with your own listening when asked for nobody in particular', async () => {
    const [bare, mine] = await Promise.all([
      card({ userId: IDS.me }),
      card({ userId: IDS.me, args: [IDS.me] }),
    ]);

    // `stats` and `stats @yourself` are the same question.
    expect(bare.equals(mine)).toBe(true);
  });

  it('answers for the server only when asked for it by name', async () => {
    const [bare, server] = await Promise.all([
      card({ userId: IDS.me }),
      card({ userId: IDS.me, args: ['server'] }),
    ]);

    expect(bare.equals(server)).toBe(false);
  });

  it('takes the server by any of the words people reach for', async () => {
    const server = await card({ userId: IDS.me, args: ['server'] });

    for (const word of ['guild', 'all', 'everyone', 'SERVER', ' Server ']) {
      expect((await card({ userId: IDS.me, args: [word] })).equals(server)).toBe(true);
    }
  });

  it('reads the server word from the slash option too', async () => {
    const option = await card({
      userId: IDS.me,
      option: (name) => (name === 'target' ? 'server' : undefined),
    });

    expect(option.equals(await card({ userId: IDS.me, args: ['server'] }))).toBe(true);
  });

  it('tells you it is you who has queued nothing, not "Someone"', async () => {
    const { ctx, replies } = harness({ userId: '900000000000000009' });

    await service.show(ctx);

    expect(replies[0]?.title).toBe('Nothing to show');
    expect(replies[0]?.content).toContain('You have not queued');
  });
});

describe('isServerWord', () => {
  it('takes the words people reach for, however they type them', () => {
    for (const word of ['server', 'Server', ' GUILD ', 'all', 'everyone']) {
      expect(isServerWord(word)).toBe(true);
    }
  });

  it('leaves anything else to be read as a person', () => {
    expect(isServerWord('linh')).toBe(false);
    expect(isServerWord('')).toBe(false);
    expect(isServerWord('servers')).toBe(false);
  });
});
