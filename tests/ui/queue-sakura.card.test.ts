import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  QUEUE_SAKURA_PAGE_SIZE,
  QUEUE_SAKURA_TEMPLATE_SIZE,
  renderQueueCard,
  renderSakuraQueueCard,
  type QueueCardData,
  type QueueCardTrack,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function rows(count: number, from = 2): QueueCardTrack[] {
  return Array.from({ length: count }, (_, index) => ({
    position: from + index,
    title: `Track ${from + index}`,
    author: 'MONO',
    durationMs: 200_000,
    requesterName: 'thanhtinz',
  }));
}

function data(overrides: Partial<QueueCardData> = {}): QueueCardData {
  return {
    current: {
      title: 'Chăm Hoa',
      author: 'MONO',
      durationMs: 211_000,
      positionMs: 84_000,
    },
    tracks: rows(4),
    page: 1,
    totalPages: 1,
    totalTracks: 4,
    totalDurationMs: 800_000,
    loop: 'off',
    variant: 'sakura',
    ...overrides,
  };
}

describe('renderSakuraQueueCard', () => {
  it('renders a PNG at the template size', async () => {
    const buffer = await renderSakuraQueueCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(QUEUE_SAKURA_TEMPLATE_SIZE.width);
    expect(image.height).toBe(QUEUE_SAKURA_TEMPLATE_SIZE.height);
  });

  it('is reachable through the variant field', async () => {
    const viaVariant = await renderQueueCard(data());
    const direct = await renderSakuraQueueCard(data());

    expect(viaVariant.equals(direct)).toBe(true);
  });

  it('differs from the classic queue card', async () => {
    const classic = await renderQueueCard(data({ variant: 'classic' }));
    const sakura = await renderQueueCard(data());

    expect(classic.equals(sakura)).toBe(false);
  });

  it('clears the rows a short queue does not fill', async () => {
    const [full, short] = await Promise.all([
      renderSakuraQueueCard(data()),
      renderSakuraQueueCard(data({ tracks: rows(1), totalTracks: 1 })),
    ]);

    expect(full.equals(short)).toBe(false);
  });

  it('renders with nothing queued at all', async () => {
    const buffer = await renderSakuraQueueCard(
      data({ current: undefined, tracks: [], totalTracks: 0, totalDurationMs: 0 }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('ignores tracks past the page size', async () => {
    const [exact, overflowing] = await Promise.all([
      renderSakuraQueueCard(data({ tracks: rows(QUEUE_SAKURA_PAGE_SIZE - 1), totalTracks: 4 })),
      renderSakuraQueueCard(data({ tracks: rows(QUEUE_SAKURA_PAGE_SIZE + 10), totalTracks: 4 })),
    ]);

    // Same four visible rows and the same header count, so the images match.
    expect(exact.equals(overflowing)).toBe(true);
  });

  it('renders the real queue positions on a later page', async () => {
    const [first, second] = await Promise.all([
      renderSakuraQueueCard(data({ tracks: rows(4, 2), page: 1 })),
      renderSakuraQueueCard(data({ tracks: rows(4, 12), page: 2 })),
    ]);

    expect(first.equals(second)).toBe(false);
  });

  it('reflects the total in the header, not just the visible rows', async () => {
    const [few, many] = await Promise.all([
      renderSakuraQueueCard(data({ totalTracks: 4 })),
      renderSakuraQueueCard(data({ totalTracks: 40 })),
    ]);

    expect(few.equals(many)).toBe(false);
  });

  it('marks a live stream instead of a duration', async () => {
    const buffer = await renderSakuraQueueCard(
      data({
        current: {
          title: 'Lo-fi Radio',
          author: 'Station',
          durationMs: 0,
          positionMs: 0,
          isStream: true,
        },
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraQueueCard(data()),
      renderSakuraQueueCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('survives degenerate rows', async () => {
    const buffer = await renderSakuraQueueCard(
      data({
        tracks: [
          {
            position: -3,
            title: '',
            author: '',
            durationMs: -1,
            requesterName: '',
          },
        ],
        totalTracks: -5,
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
