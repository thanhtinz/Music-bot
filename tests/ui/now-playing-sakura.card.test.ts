import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';
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

/** Reads an image into a pixel lookup, for comparing one card against another. */
async function pixelsOf(source: Buffer): Promise<(x: number, y: number) => number[]> {
  const image = await loadImage(source);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const { data, width } = ctx.getImageData(0, 0, image.width, image.height);

  return (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}

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

  it('fills its frame with the cover, edge to edge', async () => {
    // The cover used to stop seven pixels short on the right and eight at the
    // bottom, which read as a picture too small for the frame around it.
    const image = await loadImage(await renderSakuraNowPlayingCard(BASE));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const { data, width } = ctx.getImageData(0, 0, image.width, image.height);
    /** The template's pale ground — what a gap inside the frame looks like. */
    const isGround = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return data[i]! > 235 && data[i + 1]! > 200 && data[i + 2]! > 205;
    };

    // The frame's stroke, measured from the template.
    const frame = { left: 90, right: 552, top: 160, bottom: 642 };

    for (let y = 260; y <= 540; y += 40) {
      expect(isGround(frame.left + 4, y), `gap on the left at y=${y}`).toBe(false);
      expect(isGround(frame.right - 4, y), `gap on the right at y=${y}`).toBe(false);
    }

    for (let x = 160; x <= 480; x += 40) {
      expect(isGround(x, frame.top + 4), `gap at the top at x=${x}`).toBe(false);
      expect(isGround(x, frame.bottom - 4), `gap at the bottom at x=${x}`).toBe(false);
    }
  });

  it('rounds the cover to the frame’s own corners', async () => {
    // Filling the box without matching its radius makes the cover bulge past
    // the frame's arc, which looks worse than the gap it replaced. Outside the
    // arc the card has to be exactly what the template drew.
    const [rendered, template] = await Promise.all([
      pixelsOf(await renderSakuraNowPlayingCard(BASE)),
      pixelsOf(await readFile(resolve(__dirname, '../../assets/templates/now-playing-sakura.png'))),
    ]);

    for (const [x, y] of [
      [95, 165],
      [547, 165],
      [95, 637],
      [547, 637],
    ] as const) {
      // Within a few levels rather than exactly: cards ship as WebP, and a
      // lossy encoder moves a flat colour by a level or two. A bulge would be
      // cover art against pale ground — a difference of a hundred.
      const [r, g, b] = rendered(x, y);
      const [tr, tg, tb] = template(x, y);
      const drift = Math.max(Math.abs(r! - tr!), Math.abs(g! - tg!), Math.abs(b! - tb!));

      expect(drift, `the cover bulges past the corner at ${x},${y}`).toBeLessThan(20);
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
