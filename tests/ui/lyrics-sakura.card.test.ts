import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  LYRICS_SAKURA_PAGE_SIZE,
  LYRICS_SAKURA_SIZE,
  paginateLyrics,
  renderSakuraLyricsCard,
  type LyricsCardData,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function data(overrides: Partial<LyricsCardData> = {}): LyricsCardData {
  return {
    title: 'Chăm Hoa',
    artist: 'MONO',
    lines: ['Line one', 'Line two', '', 'Line three'],
    page: 1,
    totalPages: 2,
    provider: 'LRCLIB',
    ...overrides,
  };
}

describe('paginateLyrics', () => {
  it('fills pages up to the page size', () => {
    const text = Array.from({ length: LYRICS_SAKURA_PAGE_SIZE * 2 }, (_, i) => `L${i}`).join('\n');
    const { pages, totalPages } = paginateLyrics(text);

    expect(totalPages).toBe(2);
    expect(pages[0]).toHaveLength(LYRICS_SAKURA_PAGE_SIZE);
  });

  it('keeps blank lines, because they are the verse breaks', () => {
    const { pages } = paginateLyrics('one\n\ntwo');
    expect(pages[0]).toEqual(['one', '', 'two']);
  });

  it('wraps a line too long for the card rather than cutting it', () => {
    const long = `${'word '.repeat(60).trim()}`;
    const { pages } = paginateLyrics(long);

    expect(pages[0]!.length).toBeGreaterThan(1);
    // Nothing is lost in the wrap.
    expect(pages.flat().join(' ').split(/\s+/)).toHaveLength(60);
  });

  it('gives one empty page for empty lyrics rather than none', () => {
    const { pages, totalPages } = paginateLyrics('');

    expect(totalPages).toBe(1);
    expect(pages).toEqual([[]]);
  });

  it('respects a page size it is given', () => {
    expect(paginateLyrics('a\nb\nc\nd', 2).totalPages).toBe(2);
  });

  it('survives a nonsense page size', () => {
    expect(paginateLyrics('a\nb', 0).totalPages).toBeGreaterThan(0);
  });
});

describe('renderSakuraLyricsCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraLyricsCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(LYRICS_SAKURA_SIZE.width);
    expect(image.height).toBe(LYRICS_SAKURA_SIZE.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraLyricsCard(data()),
      renderSakuraLyricsCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('shows the page indicator only when there is more than one page', async () => {
    const [single, paged] = await Promise.all([
      renderSakuraLyricsCard(data({ totalPages: 1 })),
      renderSakuraLyricsCard(data({ page: 2, totalPages: 4 })),
    ]);

    expect(single.equals(paged)).toBe(false);
  });

  it('renders without an artist or a provider', async () => {
    const buffer = await renderSakuraLyricsCard(data({ artist: undefined, provider: undefined }));
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('survives an empty page and an over-long one', async () => {
    expect(
      (await renderSakuraLyricsCard(data({ lines: [] }))).subarray(0, 8).equals(PNG_MAGIC),
    ).toBe(true);

    const many = data({ lines: Array.from({ length: 200 }, (_, i) => `Line ${i}`) });
    expect((await renderSakuraLyricsCard(many)).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
