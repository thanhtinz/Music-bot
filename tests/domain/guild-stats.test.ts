import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../src/domain/music';
import {
  createGuildStats,
  MAX_TRACKED_TRACKS,
  MAX_TRACKED_USER_TRACKS,
  rankOf,
  recordPlay,
  statsFor,
  topArtists,
  topArtistsFor,
  topListeners,
  topTracks,
  topTracksFor,
  type GuildStats,
} from '../../src/domain/stats';

function song(title: string, author = 'MONO', identifier = title.toLowerCase()): Track {
  return createTrack({
    source: 'youtube',
    identifier,
    title,
    author,
    durationMs: 200_000,
    requesterId: 'someone',
  });
}

/** Applies a run of plays, so a test reads as what happened. */
function play(
  stats: GuildStats,
  track: Track,
  userId: string,
  listenedMs = 200_000,
  playedAt = 1000,
): GuildStats {
  return recordPlay(stats, { track, userId, listenedMs, playedAt });
}

describe('recordPlay', () => {
  it('counts a play against the track, the user and the totals', () => {
    const stats = play(createGuildStats('guild', 0), song('Chăm Hoa'), 'alice', 180_000);

    expect(stats.totalPlays).toBe(1);
    expect(stats.totalListenedMs).toBe(180_000);
    expect(stats.tracks[0]).toMatchObject({ title: 'Chăm Hoa', plays: 1, listenedMs: 180_000 });
    expect(stats.users[0]).toMatchObject({ userId: 'alice', plays: 1 });
  });

  it('does not mutate what it was given', () => {
    const before = createGuildStats('guild', 0);
    play(before, song('Chăm Hoa'), 'alice');

    expect(before.totalPlays).toBe(0);
    expect(before.tracks).toHaveLength(0);
  });

  it('counts the same song twice as one track played twice', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('Chăm Hoa'), 'alice', 100_000);
    stats = play(stats, song('Chăm Hoa'), 'bob', 50_000);

    expect(stats.tracks).toHaveLength(1);
    expect(stats.tracks[0]).toMatchObject({ plays: 2, listenedMs: 150_000 });
    expect(stats.users).toHaveLength(2);
  });

  it('matches on source and identifier, not on the title', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('Chăm Hoa', 'MONO', 'abc'), 'alice');
    stats = play(stats, song('Cham Hoa (Official MV)', 'MONO', 'abc'), 'alice');

    // The same upload retitled is still the same song.
    expect(stats.tracks).toHaveLength(1);
    // And the newest title is the one shown.
    expect(stats.tracks[0]?.title).toBe('Cham Hoa (Official MV)');
  });

  it('adds nothing for a negative or nonsense listen time', () => {
    const stats = play(createGuildStats('guild', 0), song('Chăm Hoa'), 'alice', -5000);

    expect(stats.totalListenedMs).toBe(0);
    expect(stats.tracks[0]?.listenedMs).toBe(0);
  });

  it('records a skipped track as a play with little listening', () => {
    const stats = play(createGuildStats('guild', 0), song('Chăm Hoa'), 'alice', 3_000);

    // Skipping still says something about what gets queued.
    expect(stats.tracks[0]).toMatchObject({ plays: 1, listenedMs: 3_000 });
  });

  it('keeps the most played once it is full', () => {
    let stats = createGuildStats('guild', 0);

    // One well-played song, then more one-off songs than the cap allows.
    for (let i = 0; i < 5; i += 1) stats = play(stats, song('Favourite', 'A', 'fav'), 'alice');
    for (let i = 0; i < MAX_TRACKED_TRACKS + 20; i += 1) {
      stats = play(stats, song(`Filler ${i}`, 'B', `filler-${i}`), 'alice');
    }

    expect(stats.tracks).toHaveLength(MAX_TRACKED_TRACKS);
    expect(stats.tracks.some((track) => track.key === 'youtube:fav')).toBe(true);
    // The totals are not pruned, so they still count everything ever played.
    expect(stats.totalPlays).toBe(MAX_TRACKED_TRACKS + 25);
  });
});

describe('topTracks', () => {
  it('orders by plays, then by whichever was more recent', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('Twice', 'A', 'twice'), 'alice', 1000, 10);
    stats = play(stats, song('Twice', 'A', 'twice'), 'alice', 1000, 20);
    stats = play(stats, song('Older', 'A', 'older'), 'alice', 1000, 5);
    stats = play(stats, song('Newer', 'A', 'newer'), 'alice', 1000, 30);

    expect(topTracks(stats, 3).map((track) => track.title)).toEqual(['Twice', 'Newer', 'Older']);
  });

  it('returns nothing for an empty guild or a nonsense limit', () => {
    const stats = createGuildStats('guild', 0);

    expect(topTracks(stats, 5)).toEqual([]);
    expect(topTracks(play(stats, song('One'), 'alice'), -1)).toEqual([]);
  });
});

describe('topArtists', () => {
  it('sums an artist across their tracks', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('One', 'MONO', 'one'), 'alice', 1000);
    stats = play(stats, song('Two', 'MONO', 'two'), 'alice', 2000);
    stats = play(stats, song('Other', 'Sơn Tùng M-TP', 'other'), 'alice', 5000);

    expect(topArtists(stats, 2)).toEqual([
      { author: 'MONO', plays: 2, listenedMs: 3000 },
      { author: 'Sơn Tùng M-TP', plays: 1, listenedMs: 5000 },
    ]);
  });

  it('treats one artist named two ways as one', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('One', 'MONO', 'one'), 'alice');
    stats = play(stats, song('Two', 'mono', 'two'), 'alice');

    expect(topArtists(stats, 5)).toHaveLength(1);
  });

  it('names a missing artist rather than showing a blank row', () => {
    const stats = play(createGuildStats('guild', 0), song('One', '   ', 'one'), 'alice');

    expect(topArtists(stats, 1)[0]?.author).toBe('Unknown artist');
  });
});

describe('topListeners and statsFor', () => {
  it('ranks the people who queue the most', () => {
    let stats = createGuildStats('guild', 0);
    stats = play(stats, song('One', 'A', 'one'), 'alice');
    stats = play(stats, song('Two', 'A', 'two'), 'alice');
    stats = play(stats, song('Three', 'A', 'three'), 'bob');

    expect(topListeners(stats, 2).map((entry) => entry.userId)).toEqual(['alice', 'bob']);
  });

  it('finds one person, and says nothing for someone who never queued', () => {
    const stats = play(createGuildStats('guild', 0), song('One'), 'alice');

    expect(statsFor(stats, 'alice')?.plays).toBe(1);
    expect(statsFor(stats, 'nobody')).toBeUndefined();
  });
});

describe('per-user tracks', () => {
  const chamHoa = song('Chăm Hoa', 'MONO');
  const lacTroi = song('Lạc Trôi', 'Sơn Tùng M-TP');

  /** Two people with different taste in the same guild. */
  function mixed(): GuildStats {
    let stats = createGuildStats('guild', 0);

    for (let index = 0; index < 3; index += 1) {
      stats = recordPlay(stats, { track: chamHoa, userId: 'linh', listenedMs: 1_000, playedAt: 1 });
    }
    stats = recordPlay(stats, { track: lacTroi, userId: 'minh', listenedMs: 1_000, playedAt: 2 });

    return stats;
  }

  it('keeps what each person queues, not just the guild total', () => {
    const stats = mixed();

    expect(topTracksFor(stats, 'linh', 5).map((track) => track.title)).toEqual(['Chăm Hoa']);
    expect(topTracksFor(stats, 'minh', 5).map((track) => track.title)).toEqual(['Lạc Trôi']);
  });

  it('counts a person plays against their own list only', () => {
    expect(topTracksFor(mixed(), 'linh', 5)[0]?.plays).toBe(3);
  });

  it('sums a person artists across their own tracks', () => {
    const stats = mixed();

    expect(topArtistsFor(stats, 'linh', 5)).toEqual([
      { author: 'MONO', plays: 3, listenedMs: 3_000 },
    ]);
  });

  it('has nothing for somebody who has never queued anything', () => {
    expect(topTracksFor(mixed(), 'nobody', 5)).toEqual([]);
    expect(topArtistsFor(mixed(), 'nobody', 5)).toEqual([]);
  });

  it('caps how many tracks it remembers per person', () => {
    let stats = createGuildStats('guild', 0);

    for (let index = 0; index < MAX_TRACKED_USER_TRACKS + 20; index += 1) {
      stats = recordPlay(stats, {
        track: song(`Song ${index}`, 'Artist'),
        userId: 'linh',
        listenedMs: 1_000,
        playedAt: index,
      });
    }

    // Three hundred songs each across three hundred people is a file nobody
    // wants; the guild list is the one that keeps the long tail.
    expect(statsFor(stats, 'linh')?.tracks).toHaveLength(MAX_TRACKED_USER_TRACKS);
    expect(statsFor(stats, 'linh')?.plays).toBe(MAX_TRACKED_USER_TRACKS + 20);
  });

  it('starts collecting for a record written before it kept them', () => {
    const old = createGuildStats('guild', 0);
    const legacy = {
      ...old,
      users: [{ userId: 'linh', plays: 9, listenedMs: 900, lastPlayedAt: 1 }],
      totalPlays: 9,
    } as unknown as GuildStats;

    const stats = recordPlay(legacy, {
      track: chamHoa,
      userId: 'linh',
      listenedMs: 1_000,
      playedAt: 2,
    });

    expect(topTracksFor(stats, 'linh', 5)).toHaveLength(1);
    expect(statsFor(stats, 'linh')?.plays).toBe(10);
  });
});

describe('rankOf', () => {
  function withPlays(counts: Record<string, number>): GuildStats {
    let stats = createGuildStats('guild', 0);

    for (const [userId, plays] of Object.entries(counts)) {
      for (let index = 0; index < plays; index += 1) {
        stats = recordPlay(stats, {
          track: song('Track', 'Artist'),
          userId,
          listenedMs: 1_000,
          playedAt: index,
        });
      }
    }

    return stats;
  }

  it('counts from one, most plays first', () => {
    const stats = withPlays({ linh: 5, minh: 9, khanh: 1 });

    expect(rankOf(stats, 'minh')).toBe(1);
    expect(rankOf(stats, 'linh')).toBe(2);
    expect(rankOf(stats, 'khanh')).toBe(3);
  });

  it('gives no place to somebody who has never queued anything', () => {
    // No place in the ranking rather than last place in it.
    expect(rankOf(withPlays({ linh: 1 }), 'nobody')).toBeUndefined();
  });
});
