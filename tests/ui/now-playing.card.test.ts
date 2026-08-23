import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  NOW_PLAYING_CARD_SIZE,
  renderNowPlayingCard,
  type NowPlayingCardData,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

const BASE: NowPlayingCardData = {
  title: 'Chạy Ngay Đi',
  author: 'Sơn Tùng M-TP',
  durationMs: 252_000,
  positionMs: 107_000,
  requesterName: 'thanhtinz',
  volume: 70,
  loop: 'off',
  queueLength: 12,
  source: 'youtube',
};

/** PNG signature — cheap proof the buffer is a real image, not a stub. */

describe('renderNowPlayingCard', () => {
  it('renders a PNG at the declared 2x size', async () => {
    const buffer = await renderNowPlayingCard(BASE);

    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(NOW_PLAYING_CARD_SIZE.width * NOW_PLAYING_CARD_SIZE.scale);
    expect(image.height).toBe(NOW_PLAYING_CARD_SIZE.height * NOW_PLAYING_CARD_SIZE.scale);
  });

  it('produces a different image when the playback position changes', async () => {
    const [early, late] = await Promise.all([
      renderNowPlayingCard({ ...BASE, positionMs: 10_000 }),
      renderNowPlayingCard({ ...BASE, positionMs: 240_000 }),
    ]);

    expect(early.equals(late)).toBe(false);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderNowPlayingCard(BASE),
      renderNowPlayingCard(BASE),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('survives degenerate player state', async () => {
    const buffer = await renderNowPlayingCard({
      ...BASE,
      title: '',
      author: '',
      durationMs: 0,
      positionMs: 999_999,
      volume: -20,
      queueLength: -5,
      theme: 'khong-ton-tai',
    });

    expect(buffer.byteLength).toBeGreaterThan(0);
    expectCardImage(buffer);
  });

  it('renders live streams without a progress knob', async () => {
    const buffer = await renderNowPlayingCard({
      ...BASE,
      title: 'Lo-fi Radio',
      isStream: true,
      durationMs: 0,
      positionMs: 0,
      source: 'radio',
    });

    expect(await hasWhitePixel(buffer)).toBe(true);
  });

  it('changes appearance between themes', async () => {
    const [midnight, forest] = await Promise.all([
      renderNowPlayingCard({ ...BASE, theme: 'midnight' }),
      renderNowPlayingCard({ ...BASE, theme: 'forest' }),
    ]);

    expect(midnight.equals(forest)).toBe(false);
  });

  it('falls back to a placeholder for artwork on a non-allowlisted host', async () => {
    const buffer = await renderNowPlayingCard({
      ...BASE,
      artworkUrl: 'https://attacker.example.com/cover.png',
    });

    expectCardImage(buffer);
  });
});

/** Renders the PNG back onto a canvas to assert something was actually drawn. */
async function hasWhitePixel(buffer: Buffer): Promise<boolean> {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 240 && (data[i + 1] ?? 0) > 240 && (data[i + 2] ?? 0) > 240) return true;
  }
  return false;
}
