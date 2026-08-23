import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { InMemoryStatsRepository, parseUserId, StatsService } from '../../src/application/stats';
import { createTrack, type Track } from '../../src/domain/music';
import { createGuildStats, recordPlay, type GuildStats } from '../../src/domain/stats';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

describe('StatsService', () => {
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
    const { ctx, replies } = harness();

    await service.show(ctx);

    const attachment = replies[0]?.attachments?.[0];
    expect(attachment?.name).toBe('stats.png');
    expect(attachment?.data.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('says so plainly when nothing has been played', async () => {
    const { ctx, replies } = harness();

    await service.show(ctx);

    // An empty chart looks broken; a sentence does not.
    expect(replies[0]?.attachments).toBeUndefined();
    expect(replies[0]?.title).toBe('No stats yet');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('treats a guild nobody has played in as empty rather than failing', async () => {
    const { ctx, replies } = harness({ guildId: 'never-seen' });

    await service.show(ctx);

    expect(replies[0]?.title).toBe('No stats yet');
  });

  it('renders a different card for a caller with their own numbers', async () => {
    await repository.save(seeded());

    const mine = harness({ userId: IDS.me });
    const theirs = harness({ userId: '900000000000000009' });
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
    const { ctx, replies } = harness();

    await service.show(ctx);
    await anonymous.show(ctx);

    // A raw snowflake is unreadable and is somebody's account id, so the card
    // falls back to a stand-in rather than printing it.
    expect(replies[1]?.attachments?.[0]?.data.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(replies[0]?.attachments?.[0]?.data.equals(replies[1]!.attachments![0]!.data)).toBe(
      false,
    );
  });

  it('reads only — showing the card records nothing', async () => {
    const before = seeded();
    await repository.save(before);

    await service.show(harness().ctx);

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

    expect(replies[0]?.attachments?.[0]?.name).toBe('stats.png');
  });

  it('reads the slash option and the message argument the same way', async () => {
    const slash = harness({ option: (name) => (name === 'user' ? `<@${IDS.linh}>` : undefined) });
    const prefix = harness({ args: [`<@!${IDS.linh}>`] });

    await service.show(slash.ctx);
    await service.show(prefix.ctx);

    expect(
      slash.replies[0]?.attachments?.[0]?.data.equals(prefix.replies[0]!.attachments![0]!.data),
    ).toBe(true);
  });

  it('shows that person, not the server', async () => {
    const member = harness({ args: [IDS.linh] });
    const guild = harness();

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
