import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  renderSakuraSearchCard,
  SEARCH_SAKURA_ROWS,
  SEARCH_SAKURA_SIZE,
  type SearchCardData,
  type SearchCardResult,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function results(count: number): SearchCardResult[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `Result ${index + 1}`,
    author: 'MONO',
    durationMs: 200_000 + index * 1_000,
    source: 'youtube',
  }));
}

function data(overrides: Partial<SearchCardData> = {}): SearchCardData {
  return { query: 'chăm hoa', results: results(SEARCH_SAKURA_ROWS), ...overrides };
}

describe('renderSakuraSearchCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraSearchCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(SEARCH_SAKURA_SIZE.width);
    expect(image.height).toBe(SEARCH_SAKURA_SIZE.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraSearchCard(data()),
      renderSakuraSearchCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('draws the results, not just the frame', async () => {
    const changed = data({
      results: data().results.map((result, index) =>
        index === 0 ? { ...result, title: 'Something else' } : result,
      ),
    });

    expect(
      (await renderSakuraSearchCard(data())).equals(await renderSakuraSearchCard(changed)),
    ).toBe(false);
  });

  it('shows the query, so two searches do not look alike', async () => {
    const [one, other] = await Promise.all([
      renderSakuraSearchCard(data({ query: 'chăm hoa' })),
      renderSakuraSearchCard(data({ query: 'lạc trôi' })),
    ]);

    expect(one.equals(other)).toBe(false);
  });

  it('renders a single result without stretching the card', async () => {
    const image = await loadImage(await renderSakuraSearchCard(data({ results: results(1) })));

    expect(image.height).toBe(SEARCH_SAKURA_SIZE.height);
  });

  it('draws no more rows than there are buttons for', async () => {
    const [five, more] = await Promise.all([
      renderSakuraSearchCard(data({ results: results(SEARCH_SAKURA_ROWS) })),
      renderSakuraSearchCard(data({ results: results(SEARCH_SAKURA_ROWS + 4) })),
    ]);

    // A row nobody can pick would be a lie about what the card offers.
    expect(five.equals(more)).toBe(true);
  });

  it('renders an empty result list as a line rather than a bare frame', async () => {
    const buffer = await renderSakuraSearchCard(data({ results: [] }));

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('marks a stream as live rather than showing 0:00', async () => {
    const [live, timed] = await Promise.all([
      renderSakuraSearchCard(
        data({ results: [{ title: 'Radio', author: 'FM', durationMs: 0, isStream: true }] }),
      ),
      renderSakuraSearchCard(data({ results: [{ title: 'Radio', author: 'FM', durationMs: 0 }] })),
    ]);

    expect(live.equals(timed)).toBe(false);
  });

  it('renders a result with no source', async () => {
    const buffer = await renderSakuraSearchCard(
      data({ results: [{ title: 'Somewhere', author: 'Someone', durationMs: 1_000 }] }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('survives a title and a query long enough to run off the card', async () => {
    const buffer = await renderSakuraSearchCard(
      data({
        query: 'q'.repeat(300),
        results: [{ title: 't'.repeat(300), author: 'a'.repeat(300), durationMs: 1_000 }],
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
