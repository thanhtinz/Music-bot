import { describe, expect, it, vi } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { LyricsService } from '../../src/application/services/lyrics.service';
import type { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import type { Lyrics, LyricsProvider, TimedLyricLine } from '../../src/lyrics';
import {
  activeLyricLine,
  LYRICS_SAKURA_PAGE_SIZE,
  paginateSyncedLyrics,
} from '../../src/ui/canvas';

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

function track(identifier = 'a'): Track {
  return createTrack({
    source: 'youtube',
    identifier,
    title: 'Chăm Hoa',
    author: 'MONO',
    durationMs: 212_000,
    requesterId: 'user',
  });
}

function music(current: Track | undefined, positionMs?: number) {
  return {
    currentTrack: vi.fn(() => current),
    currentPositionMs: vi.fn(() => (current ? positionMs : undefined)),
  } as unknown as MusicService;
}

/** A timed transcript long enough to run past one page. */
const TIMINGS: TimedLyricLine[] = Array.from({ length: 40 }, (_, index) => ({
  atMs: index * 5_000,
  line: `Line ${index + 1}`,
}));

const SYNCED: Lyrics = {
  title: 'Chăm Hoa',
  artist: 'MONO',
  text: TIMINGS.map((entry) => entry.line).join('\n'),
  provider: 'LRCLIB',
  synced: true,
  timings: TIMINGS,
};

function provider(result: Lyrics): LyricsProvider {
  return { name: 'Fake', find: vi.fn(async () => result) };
}

describe('paginating a timed transcript', () => {
  it('pages it the same way as the plain words', () => {
    const { pages, totalPages } = paginateSyncedLyrics(TIMINGS);

    expect(totalPages).toBe(3);
    expect(pages[0]).toHaveLength(LYRICS_SAKURA_PAGE_SIZE);
    expect(pages[0]?.[0]).toEqual({ text: 'Line 1', atMs: 0 });
  });

  it('gives a wrapped line its stamp once, on the fragment it starts at', () => {
    const long = 'word '.repeat(60).trim();
    const { pages } = paginateSyncedLyrics([{ atMs: 9_000, line: long }]);
    const wrapped = pages[0] ?? [];

    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped[0]?.atMs).toBe(9_000);
    // The rest of the line is unstamped, so "the line being sung" can never
    // land halfway through one.
    expect(wrapped.slice(1).every((line) => line.atMs === undefined)).toBe(true);
  });

  it('is a page of nothing when there is nothing timed', () => {
    expect(paginateSyncedLyrics([])).toEqual({ pages: [[]], totalPages: 1 });
  });
});

describe('finding the line being sung', () => {
  const pages = paginateSyncedLyrics(TIMINGS).pages;

  it('takes the last line whose moment has passed', () => {
    // Line 4 opens at 15s and line 5 at 20s.
    expect(activeLyricLine(pages, 17_000)).toEqual({ page: 1, line: 3 });
    expect(activeLyricLine(pages, 20_000)).toEqual({ page: 1, line: 4 });
  });

  it('crosses onto the page the words are on', () => {
    // Line 19 opens at 90s and is the first line of page two.
    expect(activeLyricLine(pages, 92_000)).toEqual({ page: 2, line: 0 });
  });

  it('has no answer before the first line is sung', () => {
    const late = paginateSyncedLyrics([{ atMs: 8_000, line: 'after the intro' }]).pages;

    expect(activeLyricLine(late, 3_000)).toBeUndefined();
  });

  it('stays on the last line sung through a verse break', () => {
    // A break carries a stamp of its own and draws nothing, so choosing it
    // would put the highlight on a blank row — which the preview caught before
    // any test did.
    const withBreak = paginateSyncedLyrics([
      { atMs: 0, line: 'first' },
      { atMs: 4_000, line: '' },
      { atMs: 8_000, line: 'second' },
    ]).pages;

    expect(activeLyricLine(withBreak, 6_000)).toEqual({ page: 1, line: 0 });
    expect(activeLyricLine(withBreak, 9_000)).toEqual({ page: 1, line: 2 });
  });

  it('stays on the last line once the words run out', () => {
    expect(activeLyricLine(pages, 10 * 60_000)).toEqual({ page: 3, line: 3 });
  });
});

describe('a lyrics card that follows the music', () => {
  it('opens on the page the song is on, not on page one', async () => {
    const playing = track();
    const service = new LyricsService(provider(SYNCED), music(playing, 92_000), {
      pageComponents: (page, totalPages) => [{ page, totalPages }],
    });
    const { ctx, replies } = harness();

    await service.show(ctx, '');

    expect(replies[0]?.components).toEqual([{ page: 2, totalPages: 3 }]);
  });

  it('opens at the top when the song has not reached the words yet', async () => {
    const service = new LyricsService(provider(SYNCED), music(track(), 0), {
      pageComponents: (page, totalPages) => [{ page, totalPages }],
    });
    const { ctx, replies } = harness();

    await service.show(ctx, '');

    expect(replies[0]?.components).toEqual([{ page: 1, totalPages: 3 }]);
  });

  it('draws the line being sung differently from the rest', async () => {
    const service = new LyricsService(provider(SYNCED), music(track(), 17_000));
    const { ctx, replies } = harness();

    await service.show(ctx, '');
    const followed = replies[0]?.content;

    const still = new LyricsService(provider(SYNCED), music(undefined));
    const { ctx: idleCtx, replies: idleReplies } = harness();
    await still.show(idleCtx, 'Chăm Hoa');
    const plain = idleReplies[0]?.content;

    // 17s in, five seconds a line, lands on the fourth line.
    expect(followed).toContain('**▶ Line 4**');
    expect(plain).not.toContain('▶');
  });

  it('does not follow a song somebody searched for', async () => {
    // The words on the card are not the words being sung, so a highlight would
    // be pointing at the wrong song.
    const service = new LyricsService(provider(SYNCED), music(track(), 92_000), {
      pageComponents: (page, totalPages) => [{ page, totalPages }],
    });
    const { ctx, replies } = harness();

    await service.show(ctx, 'Lạc Trôi');

    expect(replies[0]?.components).toEqual([{ page: 1, totalPages: 3 }]);
  });

  it('stops following once the queue has moved on', async () => {
    const music_ = {
      currentTrack: vi.fn(() => track('a')),
      currentPositionMs: vi.fn(() => 92_000),
    } as unknown as MusicService;
    const service = new LyricsService(provider(SYNCED), music_);

    await service.show(harness().ctx, '');

    // The next track is a different song; the card in hand is about the old one.
    (music_.currentTrack as unknown as ReturnType<typeof vi.fn>).mockReturnValue(track('b'));

    const { ctx, replies } = harness();
    await service.page(ctx, 2);

    const followed = replies[0]?.content;

    const same = new LyricsService(provider(SYNCED), music(undefined));
    const { ctx: plainCtx, replies: plainReplies } = harness();
    await same.show(plainCtx, 'Chăm Hoa');
    await same.page(plainCtx, 2);

    expect(followed).toBe(plainReplies[1]?.content);
  });

  it('leaves the highlight behind when the reader pages away from it', async () => {
    const service = new LyricsService(provider(SYNCED), music(track(), 17_000));

    const { ctx, replies } = harness();
    await service.show(ctx, '');
    await service.page(ctx, 3);

    expect(replies[1]?.content).not.toContain('▶');
    expect(replies[1]?.content).toContain('Line 37');
    expect(replies[1]?.content).toContain('Line 40');
  });
});
