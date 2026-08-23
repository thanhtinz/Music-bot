import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  PLAYLIST_SAKURA_PAGE_SIZE,
  PLAYLIST_SAKURA_SIZE,
  renderSakuraPlaylistCard,
  type PlaylistCardData,
  type PlaylistCardEntry,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function entries(count: number): PlaylistCardEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Playlist ${index + 1}`,
    trackCount: 10 + index,
    totalDurationMs: 600_000,
    ownerName: 'thanhtinz',
  }));
}

function data(overrides: Partial<PlaylistCardData> = {}): PlaylistCardData {
  return {
    ownerName: 'thanhtinz',
    entries: entries(4),
    prefix: '/',
    ...overrides,
  };
}

describe('renderSakuraPlaylistCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraPlaylistCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(PLAYLIST_SAKURA_SIZE.width);
    expect(image.height).toBe(PLAYLIST_SAKURA_SIZE.height);
  });

  it('caps the grid at the page size', async () => {
    // Same declared total, so only the grid could differ — and it must not.
    const [exact, overflowing] = await Promise.all([
      renderSakuraPlaylistCard(
        data({ entries: entries(PLAYLIST_SAKURA_PAGE_SIZE), totalCount: 20 }),
      ),
      renderSakuraPlaylistCard(
        data({ entries: entries(PLAYLIST_SAKURA_PAGE_SIZE + 5), totalCount: 20 }),
      ),
    ]);

    expect(exact.equals(overflowing)).toBe(true);
  });

  it('counts every playlist in the header, not just this page', async () => {
    const [onePage, manyPages] = await Promise.all([
      renderSakuraPlaylistCard(data({ entries: entries(2), totalCount: 2 })),
      renderSakuraPlaylistCard(data({ entries: entries(2), totalCount: 40 })),
    ]);

    expect(onePage.equals(manyPages)).toBe(false);
  });

  it('grows the grid with the number of playlists', async () => {
    const [few, many] = await Promise.all([
      renderSakuraPlaylistCard(data({ entries: entries(1) })),
      renderSakuraPlaylistCard(data({ entries: entries(6) })),
    ]);

    expect(few.equals(many)).toBe(false);
  });

  it('renders an empty state instead of an empty grid', async () => {
    const buffer = await renderSakuraPlaylistCard(data({ entries: [] }));
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    // The card is drawn, not blank: something has to be painted over the panel.
    expect(await hasInk(buffer)).toBe(true);
  });

  it('badges private playlists differently', async () => {
    const [publicOnly, withPrivate] = await Promise.all([
      renderSakuraPlaylistCard(data({ entries: entries(1) })),
      renderSakuraPlaylistCard(data({ entries: [{ ...entries(1)[0]!, visibility: 'private' }] })),
    ]);

    expect(publicOnly.equals(withPrivate)).toBe(false);
  });

  it('gives a playlist the same cover colours every render', async () => {
    const [first, second] = await Promise.all([
      renderSakuraPlaylistCard(data({ entries: [{ ...entries(1)[0]!, name: 'Chill' }] })),
      renderSakuraPlaylistCard(data({ entries: [{ ...entries(1)[0]!, name: 'Chill' }] })),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('gives different playlists different covers', async () => {
    const [chill, party] = await Promise.all([
      renderSakuraPlaylistCard(data({ entries: [{ ...entries(1)[0]!, name: 'Chill' }] })),
      renderSakuraPlaylistCard(data({ entries: [{ ...entries(1)[0]!, name: 'Party' }] })),
    ]);

    expect(chill.equals(party)).toBe(false);
  });

  it('shows a page indicator only when there is more than one page', async () => {
    const [single, paged] = await Promise.all([
      renderSakuraPlaylistCard(data({ totalPages: 1 })),
      renderSakuraPlaylistCard(data({ page: 2, totalPages: 3 })),
    ]);

    expect(single.equals(paged)).toBe(false);
  });

  it('reflects the prefix in its hints', async () => {
    const [slash, bang] = await Promise.all([
      renderSakuraPlaylistCard(data({ prefix: '/' })),
      renderSakuraPlaylistCard(data({ prefix: '!' })),
    ]);

    expect(slash.equals(bang)).toBe(false);
  });

  it('survives degenerate entries', async () => {
    const buffer = await renderSakuraPlaylistCard(
      data({
        entries: [{ name: '', trackCount: -3, totalDurationMs: -1 }],
        totalCount: -5,
        page: 99,
        totalPages: 0,
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('truncates a name that would run under the private badge', async () => {
    const buffer = await renderSakuraPlaylistCard(
      data({
        entries: [
          {
            name: 'A playlist name long enough to reach clear across the whole tile',
            trackCount: 4,
            totalDurationMs: 900_000,
            visibility: 'private',
          },
        ],
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});

/** True when the image contains pixels darker than the pastel background. */
async function hasInk(buffer: Buffer): Promise<boolean> {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 160 && (data[i + 1] ?? 255) < 160) return true;
  }
  return false;
}
