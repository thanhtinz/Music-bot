import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { InMemoryStatsRepository, StatsService } from '../../src/application/stats';
import { createTrack, type Track } from '../../src/domain/music';
import { createGuildStats, recordPlay, type GuildStats } from '../../src/domain/stats';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    userId: 'thanhtinz',
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
    [song('Chăm Hoa', 'MONO', 'thanhtinz'), 3],
    [song('Lạc Trôi', 'Sơn Tùng M-TP', 'linh'), 2],
    [song('Nevada', 'Vicetone', 'minh'), 1],
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
      displayName: (userId) => ({ thanhtinz: 'thanhtinz', linh: 'linh' })[userId],
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

    const mine = harness({ userId: 'thanhtinz' });
    const theirs = harness({ userId: 'nobody' });
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
