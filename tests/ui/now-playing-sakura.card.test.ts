import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  renderNowPlayingCard,
  renderSakuraNowPlayingCard,
  SAKURA_TEMPLATE_SIZE,
  type NowPlayingCardData,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

const BASE: NowPlayingCardData = {
  title: 'Chăm Hoa',
  author: 'MONO',
  durationMs: 211_000,
  positionMs: 84_000,
  requesterName: 'thanhtinz',
  volume: 70,
  loop: 'off',
  queueLength: 8,
  source: 'youtube',
  variant: 'sakura',
};

describe('renderSakuraNowPlayingCard', () => {
  it('renders a PNG at the template size', async () => {
    const buffer = await renderSakuraNowPlayingCard(BASE);
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(SAKURA_TEMPLATE_SIZE.width);
    expect(image.height).toBe(SAKURA_TEMPLATE_SIZE.height);
  });

  it('is reachable through the variant field', async () => {
    const viaVariant = await renderNowPlayingCard(BASE);
    const direct = await renderSakuraNowPlayingCard(BASE);

    expect(viaVariant.equals(direct)).toBe(true);
  });

  it('differs from the classic card for the same data', async () => {
    const classic = await renderNowPlayingCard({ ...BASE, variant: 'classic' });
    const sakura = await renderNowPlayingCard(BASE);

    expect(classic.equals(sakura)).toBe(false);
  });

  it('moves the progress knob with the playback position', async () => {
    const [early, late] = await Promise.all([
      renderSakuraNowPlayingCard({ ...BASE, positionMs: 5_000 }),
      renderSakuraNowPlayingCard({ ...BASE, positionMs: 200_000 }),
    ]);

    expect(early.equals(late)).toBe(false);
  });

  it('swaps the transport glyph when paused', async () => {
    const [playing, paused] = await Promise.all([
      renderSakuraNowPlayingCard(BASE),
      renderSakuraNowPlayingCard({ ...BASE, paused: true }),
    ]);

    expect(playing.equals(paused)).toBe(false);
  });

  it('draws a distinct mark for every known source', async () => {
    // Each source owns its silhouette: a play tile means YouTube and nothing
    // else, so no two badges may render identically.
    const sources = ['youtube', 'spotify', 'applemusic', 'deezer', 'soundcloud', 'radio', 'http'];
    const rendered = await Promise.all(
      sources.map((source) => renderSakuraNowPlayingCard({ ...BASE, source })),
    );

    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(
          rendered[i]!.equals(rendered[j]!),
          `${sources[i]} and ${sources[j]} render the same badge`,
        ).toBe(false);
      }
    }
  });

  it('falls back to the generic mark for an unknown source', async () => {
    const [unknown, http] = await Promise.all([
      renderSakuraNowPlayingCard({ ...BASE, source: 'bandcamp' }),
      renderSakuraNowPlayingCard({ ...BASE, source: 'http' }),
    ]);

    // Same mark, different label — so the images differ but neither throws.
    expectCardImage(unknown);
    expect(unknown.equals(http)).toBe(false);
  });

  it('renders live streams without a knob', async () => {
    const buffer = await renderSakuraNowPlayingCard({
      ...BASE,
      title: 'Lo-fi Radio',
      isStream: true,
      durationMs: 0,
      positionMs: 0,
      source: 'radio',
    });

    expectCardImage(buffer);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraNowPlayingCard(BASE),
      renderSakuraNowPlayingCard(BASE),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('survives degenerate player state', async () => {
    const buffer = await renderSakuraNowPlayingCard({
      ...BASE,
      title: '',
      author: '',
      durationMs: 0,
      positionMs: 999_999,
      source: undefined,
    });

    expectCardImage(buffer);
  });

  it('truncates a title that would run into the stickers', async () => {
    const buffer = await renderSakuraNowPlayingCard({
      ...BASE,
      title: 'A ridiculously long track title that could never fit beside the artwork frame',
    });

    expectCardImage(buffer);
  });
});
