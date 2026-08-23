import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  HISTORY_SAKURA_ROWS,
  HISTORY_SAKURA_SIZE,
  renderSakuraHistoryCard,
  type HistoryCardData,
  type HistoryCardEntry,
} from '../../src/ui/canvas';
import { historyCardHeight } from '../../src/ui/canvas/cards/history-sakura.card';
import { expectCardImage } from '../helpers/card-image';

function entries(count: number): HistoryCardEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `Track ${index + 1}`,
    author: 'MONO',
    durationMs: 200_000,
    requesterName: 'thanhtinz',
  }));
}

function data(overrides: Partial<HistoryCardData> = {}): HistoryCardData {
  return { entries: entries(HISTORY_SAKURA_ROWS), guildName: 'Melody Test Server', ...overrides };
}

describe('renderSakuraHistoryCard', () => {
  it('renders a PNG at the full size when the history is full', async () => {
    const buffer = await renderSakuraHistoryCard(data());
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(HISTORY_SAKURA_SIZE.width);
    expect(image.height).toBe(HISTORY_SAKURA_SIZE.height);
  });

  it('shrinks to the number of rows it has', async () => {
    const short = await loadImage(await renderSakuraHistoryCard(data({ entries: entries(2) })));

    // A room that has played two songs should not stare at four empty rows.
    expect(short.height).toBeLessThan(HISTORY_SAKURA_SIZE.height);
    expect(short.height).toBe(historyCardHeight(2));
  });

  it('keeps a floor for an empty history', async () => {
    const image = await loadImage(await renderSakuraHistoryCard(data({ entries: [] })));

    expect(image.height).toBe(historyCardHeight(0));
    expect(historyCardHeight(0)).toBe(historyCardHeight(1));
  });

  it('leaves room under the last row for the mascot', () => {
    // Without the band the mascot sits on the final row's duration.
    const rowsBottom = 168 + HISTORY_SAKURA_ROWS * 86 - 8;

    expect(historyCardHeight(HISTORY_SAKURA_ROWS) - rowsBottom).toBeGreaterThanOrEqual(140);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraHistoryCard(data()),
      renderSakuraHistoryCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('draws the tracks, not just the frame', async () => {
    const changed = data({
      entries: data().entries.map((entry, index) =>
        index === 0 ? { ...entry, title: 'Something else' } : entry,
      ),
    });

    expect(
      (await renderSakuraHistoryCard(data())).equals(await renderSakuraHistoryCard(changed)),
    ).toBe(false);
  });

  it('shows no more rows than it has room for', async () => {
    const [full, more] = await Promise.all([
      renderSakuraHistoryCard(data({ entries: entries(HISTORY_SAKURA_ROWS) })),
      renderSakuraHistoryCard(data({ entries: entries(HISTORY_SAKURA_ROWS + 10) })),
    ]);

    expect(full.equals(more)).toBe(false);
    expect((await loadImage(more)).height).toBe(HISTORY_SAKURA_SIZE.height);
  });

  it('says how many were kept when more played than fit', async () => {
    const [plain, counted] = await Promise.all([
      renderSakuraHistoryCard(data()),
      renderSakuraHistoryCard(data({ totalCount: 40 })),
    ]);

    expect(plain.equals(counted)).toBe(false);
  });

  it('marks a stream as live rather than showing a length', async () => {
    const [live, timed] = await Promise.all([
      renderSakuraHistoryCard(
        data({ entries: [{ title: 'Radio', author: 'FM', durationMs: 0, isStream: true }] }),
      ),
      renderSakuraHistoryCard(data({ entries: [{ title: 'Radio', author: 'FM', durationMs: 0 }] })),
    ]);

    expect(live.equals(timed)).toBe(false);
  });

  it('renders an entry with no requester, and a very long one', async () => {
    const buffer = await renderSakuraHistoryCard(
      data({
        entries: [
          { title: 't'.repeat(200), author: 'a'.repeat(200), durationMs: 1_000 },
          { title: 'Named', author: 'MONO', durationMs: 1_000, requesterName: 'n'.repeat(200) },
        ],
      }),
    );

    expectCardImage(buffer);
  });
});
