import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  formatHours,
  renderSakuraStatsCard,
  STATS_SAKURA_ROWS,
  STATS_SAKURA_SIZE,
  type StatsCardData,
  type StatsCardEntry,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function entries(count: number): StatsCardEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `Entry ${index + 1}`,
    detail: 'Artist',
    plays: 20 - index * 3,
  }));
}

function data(overrides: Partial<StatsCardData> = {}): StatsCardData {
  return {
    guildName: 'Melody Test Server',
    totalPlays: 79,
    totalListenedMs: 16_200_000,
    since: 1_751_328_000_000,
    topTracks: entries(5),
    topArtists: entries(5),
    topListeners: entries(4),
    you: { plays: 35, listenedMs: 7_200_000 },
    ...overrides,
  };
}

describe('renderSakuraStatsCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraStatsCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(STATS_SAKURA_SIZE.width);
    expect(image.height).toBe(STATS_SAKURA_SIZE.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraStatsCard(data()),
      renderSakuraStatsCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('draws the counts, not just the names', async () => {
    const changed = data({
      topTracks: data().topTracks.map((entry, index) =>
        index === 0 ? { ...entry, plays: 99 } : entry,
      ),
    });

    expect((await renderSakuraStatsCard(data())).equals(await renderSakuraStatsCard(changed))).toBe(
      false,
    );
  });

  it('fills a full column without overflowing the card', async () => {
    const full = data({ topListeners: entries(STATS_SAKURA_ROWS) });

    const image = await loadImage(await renderSakuraStatsCard(full));
    expect(image.height).toBe(STATS_SAKURA_SIZE.height);
  });

  it('takes more rows than it shows without complaint', async () => {
    const buffer = await renderSakuraStatsCard(data({ topTracks: entries(40) }));
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('renders an empty column as a line rather than a blank box', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ topArtists: [], topListeners: [], topTracks: [] }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('renders without a server name, a period, or a caller line', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ guildName: undefined, since: undefined, you: undefined }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('survives an entry with no detail line', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ topListeners: [{ label: 'Someone', plays: 3 }] }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('does not stretch a bar for a column of zeroes', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ topArtists: [{ label: 'Nobody', plays: 0 }] }),
    );

    // The bar width divides by the highest count; zero must not blow it up.
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});

describe('formatHours', () => {
  it('stays in minutes below an hour', () => {
    expect(formatHours(0)).toBe('0m');
    expect(formatHours(90_000)).toBe('2m');
    expect(formatHours(59 * 60_000)).toBe('59m');
  });

  it('switches to hours, with a decimal while it still helps', () => {
    expect(formatHours(3_600_000)).toBe('1.0h');
    expect(formatHours(16_200_000)).toBe('4.5h');
  });

  it('drops the decimal once the number is big enough', () => {
    expect(formatHours(36_000_000)).toBe('10h');
    expect(formatHours(100 * 3_600_000)).toBe('100h');
  });

  it('never reports negative time', () => {
    expect(formatHours(-5_000)).toBe('0m');
  });
});

describe('renderSakuraStatsCard, for one person', () => {
  const subject = {
    name: 'linh',
    plays: 37,
    listenedMs: 7_560_000,
    rank: 1,
    listenerCount: 4,
  };

  it('draws a different card from the server one', async () => {
    const [guild, member] = await Promise.all([
      renderSakuraStatsCard(data()),
      renderSakuraStatsCard(data({ subject })),
    ]);

    expect(guild.equals(member)).toBe(false);
  });

  it('renders without a rank, for somebody outside the tracked listeners', async () => {
    const buffer = await renderSakuraStatsCard(data({ subject: { ...subject, rank: undefined } }));

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('renders for the only listener on the server', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ subject: { ...subject, listenerCount: 1 }, topListeners: entries(1) }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('picks the highlighted row out of the list', async () => {
    const plain = data({ subject });
    const marked = data({
      subject,
      topListeners: data().topListeners.map((entry, index) =>
        index === 0 ? { ...entry, highlight: true } : entry,
      ),
    });

    expect((await renderSakuraStatsCard(plain)).equals(await renderSakuraStatsCard(marked))).toBe(
      false,
    );
  });

  it('survives a name long enough to run off the card', async () => {
    const buffer = await renderSakuraStatsCard(
      data({ subject: { ...subject, name: 'a'.repeat(200) } }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
