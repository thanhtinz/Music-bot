import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { LyricsService } from '../../src/application/services/lyrics.service';
import type { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import type { Lyrics, LyricsProvider } from '../../src/lyrics';
import { ResolverError } from '../../src/resolvers';

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    commandName: 'lyrics',
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

function track(title = 'Chăm Hoa'): Track {
  return createTrack({
    source: 'youtube',
    identifier: 'a',
    title,
    author: 'MONO',
    durationMs: 212_000,
    requesterId: 'user',
  });
}

function music(current?: Track) {
  return { currentTrack: vi.fn(() => current) } as unknown as MusicService;
}

const LYRICS: Lyrics = {
  title: 'Chăm Hoa',
  artist: 'MONO',
  text: Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join('\n'),
  provider: 'LRCLIB',
};

function provider(result: Lyrics | undefined | Error): LyricsProvider {
  return {
    name: 'Fake',
    find: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('LyricsService', () => {
  let service: LyricsService;

  beforeEach(() => {
    service = new LyricsService(provider(LYRICS), music(track()), {
      pageComponents: (page, totalPages) => [{ page, totalPages }],
    });
  });

  it('renders the current track’s lyrics', async () => {
    const { ctx, replies } = harness();

    await service.show(ctx, '');

    expect(replies[0]?.title).toBe('Chăm Hoa — MONO');
    expect(replies[0]?.content).toContain('Line 1');
  });

  it('pages a long song and attaches the buttons', async () => {
    const { ctx, replies } = harness();

    await service.show(ctx, '');

    // 40 lines do not fit on one page, so there has to be more than one.
    expect(replies[0]?.components).toEqual([{ page: 1, totalPages: 3 }]);
  });

  it('looks up what was asked for rather than what is playing', async () => {
    const find = vi.fn(async () => LYRICS);
    const withQuery = new LyricsService({ name: 'Fake', find }, music(track()));

    await withQuery.show(harness().ctx, 'Lạc Trôi');

    expect(find).toHaveBeenCalledWith({ title: 'Lạc Trôi' });
  });

  it('passes the artist and length when using the current track', async () => {
    const find = vi.fn(async () => LYRICS);
    const withTrack = new LyricsService({ name: 'Fake', find }, music(track()));

    await withTrack.show(harness().ctx, '');

    expect(find).toHaveBeenCalledWith({
      title: 'Chăm Hoa',
      artist: 'MONO',
      durationMs: 212_000,
    });
  });

  it('asks for a song when nothing is playing and none was given', async () => {
    const idle = new LyricsService(provider(LYRICS), music(undefined));
    const { ctx, replies } = harness();

    await idle.show(ctx, '');

    expect(replies[0]?.content).toContain('Give me a song name');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('says when the provider simply has nothing', async () => {
    const empty = new LyricsService(provider(undefined), music(track()));
    const { ctx, replies } = harness();

    await empty.show(ctx, '');

    expect(replies[0]?.title).toBe('No lyrics');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('explains a provider failure instead of a stack trace', async () => {
    const broken = new LyricsService(
      provider(new ResolverError('RATE_LIMITED', 'Slow down.', { source: 'Fake' })),
      music(track()),
    );
    const { ctx, replies } = harness();

    await broken.show(ctx, '');

    expect(replies[0]?.title).toBe('Lyrics unavailable');
    expect(replies[0]?.tone).toBe('warning');
  });

  it('turns pages without asking the provider again', async () => {
    const find = vi.fn(async () => LYRICS);
    const cached = new LyricsService({ name: 'Fake', find }, music(track()), {
      pageComponents: (page, totalPages) => [{ page, totalPages }],
    });

    await cached.show(harness().ctx, '');
    const { ctx, replies } = harness();
    await cached.page(ctx, 2);

    expect(find).toHaveBeenCalledTimes(1);
    expect(replies[0]?.components).toEqual([{ page: 2, totalPages: 3 }]);
  });

  it('clamps a page past the end', async () => {
    await service.show(harness().ctx, '');
    const { ctx, replies } = harness();

    await service.page(ctx, 99);

    expect(replies[0]?.components).toEqual([{ page: 3, totalPages: 3 }]);
  });

  it('says so when a page button outlives the lookup', async () => {
    const { ctx, replies } = harness();

    await service.page(ctx, 2);

    expect(replies[0]?.content).toContain('expired');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('keeps one guild’s lookup out of another’s', async () => {
    await service.show(harness().ctx, '');

    const { ctx, replies } = harness({ guildId: 'other' });
    await service.page(ctx, 2);

    expect(replies[0]?.content).toContain('expired');
  });
});
