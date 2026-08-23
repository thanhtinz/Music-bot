import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  QUEUE_CARD_WIDTH,
  QUEUE_PAGE_SIZE,
  queueCardHeight,
  renderQueueCard,
  type QueueCardData,
  type QueueCardTrack,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

const SCALE = 2;

function rows(count: number): QueueCardTrack[] {
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    title: `Track ${index + 1}`,
    author: 'Artist',
    durationMs: 200_000,
    requesterName: 'thanhtinz',
  }));
}

function data(overrides: Partial<QueueCardData> = {}): QueueCardData {
  return {
    tracks: rows(5),
    page: 1,
    totalPages: 1,
    totalTracks: 5,
    totalDurationMs: 1_000_000,
    loop: 'off',
    ...overrides,
  };
}

describe('renderQueueCard', () => {
  it('renders a PNG at the declared width', async () => {
    const buffer = await renderQueueCard(data());
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(QUEUE_CARD_WIDTH * SCALE);
  });

  it('grows in height with the number of rows', async () => {
    const [short, long] = await Promise.all([
      renderQueueCard(data({ tracks: rows(2) })),
      renderQueueCard(data({ tracks: rows(10) })),
    ]);

    const [shortImage, longImage] = await Promise.all([loadImage(short), loadImage(long)]);
    expect(longImage.height).toBeGreaterThan(shortImage.height);
  });

  it('matches the height predicted by queueCardHeight', async () => {
    const input = data({ tracks: rows(7) });
    const image = await loadImage(await renderQueueCard(input));

    expect(image.height).toBe(queueCardHeight(input) * SCALE);
  });

  it('caps the page at QUEUE_PAGE_SIZE rows', async () => {
    const capped = await loadImage(await renderQueueCard(data({ tracks: rows(QUEUE_PAGE_SIZE) })));
    const overflowing = await loadImage(
      await renderQueueCard(data({ tracks: rows(QUEUE_PAGE_SIZE + 15) })),
    );

    expect(overflowing.height).toBe(capped.height);
  });

  it('renders an empty-state row when there is nothing queued', async () => {
    const buffer = await renderQueueCard(
      data({ tracks: [], totalTracks: 0, totalDurationMs: 0, totalPages: 0 }),
    );

    expectCardImage(buffer);
    const image = await loadImage(buffer);
    expect(image.height).toBeGreaterThan(0);
  });

  it('reserves extra space for the now-playing panel', async () => {
    const without = await loadImage(await renderQueueCard(data()));
    const withCurrent = await loadImage(
      await renderQueueCard(
        data({
          current: {
            title: 'Faded',
            author: 'Alan Walker',
            durationMs: 212_000,
            positionMs: 78_000,
          },
        }),
      ),
    );

    expect(withCurrent.height).toBeGreaterThan(without.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([renderQueueCard(data()), renderQueueCard(data())]);

    expect(first.equals(second)).toBe(true);
  });

  it('survives a nonsense page count and negative totals', async () => {
    const buffer = await renderQueueCard(
      data({ page: 9, totalPages: 0, totalTracks: -3, totalDurationMs: -1 }),
    );

    expectCardImage(buffer);
  });
});
