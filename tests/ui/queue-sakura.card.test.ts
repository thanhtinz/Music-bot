import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  paginateSakuraQueue,
  QUEUE_SAKURA_PAGE_SIZE,
  QUEUE_SAKURA_TEMPLATE_SIZE,
  QUEUE_SAKURA_UPCOMING_PER_PAGE,
  renderQueueCard,
  renderSakuraQueueCard,
  type QueueCardData,
  type QueueCardTrack,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

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
    expectCardImage(buffer);

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

    expectCardImage(buffer);
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

    expectCardImage(buffer);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraQueueCard(data()),
      renderSakuraQueueCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('shows a page indicator only once there is more than one page', async () => {
    const [single, paged] = await Promise.all([
      renderSakuraQueueCard(data({ page: 1, totalPages: 1 })),
      renderSakuraQueueCard(data({ page: 1, totalPages: 4 })),
    ]);

    expect(single.equals(paged)).toBe(false);
  });

  it('shows which page it is on', async () => {
    const [second, third] = await Promise.all([
      renderSakuraQueueCard(data({ page: 2, totalPages: 4 })),
      renderSakuraQueueCard(data({ page: 3, totalPages: 4 })),
    ]);

    expect(second.equals(third)).toBe(false);
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

    expectCardImage(buffer);
  });
});

describe('paginateSakuraQueue', () => {
  const items = Array.from({ length: 11 }, (_, index) => index + 1);

  it('splits into pages of four by default', () => {
    expect(QUEUE_SAKURA_UPCOMING_PER_PAGE).toBe(4);

    const first = paginateSakuraQueue(items, 1);
    expect(first.items).toEqual([1, 2, 3, 4]);
    expect(first.totalPages).toBe(3);
    expect(first.firstPosition).toBe(1);
  });

  it('continues positions across pages', () => {
    const second = paginateSakuraQueue(items, 2);
    expect(second.items).toEqual([5, 6, 7, 8]);
    expect(second.firstPosition).toBe(5);

    const third = paginateSakuraQueue(items, 3);
    expect(third.items).toEqual([9, 10, 11]);
    expect(third.firstPosition).toBe(9);
  });

  it('clamps a page past either end', () => {
    expect(paginateSakuraQueue(items, 0).page).toBe(1);
    expect(paginateSakuraQueue(items, -5).page).toBe(1);
    expect(paginateSakuraQueue(items, 99).page).toBe(3);
    expect(paginateSakuraQueue(items, Number.NaN).page).toBe(1);
  });

  it('reports one page for an empty queue', () => {
    const empty = paginateSakuraQueue([], 1);
    expect(empty.items).toEqual([]);
    expect(empty.totalPages).toBe(1);
    expect(empty.firstPosition).toBe(1);
  });

  it('honours a custom page size', () => {
    const slice = paginateSakuraQueue(items, 2, 5);
    expect(slice.items).toEqual([6, 7, 8, 9, 10]);
    expect(slice.totalPages).toBe(3);
  });

  it('refuses a nonsensical page size rather than dividing by zero', () => {
    expect(paginateSakuraQueue(items, 1, 0).items).toEqual([1]);
    expect(paginateSakuraQueue(items, 1, -3).items).toEqual([1]);
  });
});

describe('an autoplayed row', () => {
  it('is marked, so a track nobody asked for says so', async () => {
    const asked = await renderSakuraQueueCard(data());
    const picked = await renderSakuraQueueCard({
      ...data(),
      tracks: data().tracks.map((track, index) =>
        index === 0 ? { ...track, autoplay: true } : track,
      ),
    });

    expect(asked.equals(picked)).toBe(false);
  });

  it('keeps the tag inside the row when the artist is long', async () => {
    const buffer = await renderSakuraQueueCard({
      ...data(),
      tracks: data().tracks.map((track, index) =>
        index === 0 ? { ...track, author: 'A'.repeat(200), autoplay: true } : track,
      ),
    });

    expectCardImage(buffer);
  });
});
