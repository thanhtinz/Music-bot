import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';

import { cardFile, cardFormat, configureCardEncoding, encodeCard } from '../../src/ui/canvas';

/** A canvas with something on it, so an encoder has work to do. */
function canvas(width = 320, height = 180) {
  const target = createCanvas(width, height);
  const ctx = target.getContext('2d');

  ctx.fillStyle = '#ffe4ec';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#c2185b';
  ctx.fillRect(20, 20, width - 40, 40);

  return target;
}

describe('card encoding', () => {
  afterEach(() => {
    configureCardEncoding({ format: 'webp', quality: 90 });
  });

  it('encodes WebP by default', async () => {
    const card = await encodeCard(canvas());

    expect(card.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(card.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('names the attachment for what it actually holds', () => {
    // Discord reads the extension to decide whether to show a file inline, so
    // a WebP called `.png` is a card nobody sees.
    expect(cardFile('now-playing')).toBe('now-playing.webp');

    configureCardEncoding({ format: 'png' });
    expect(cardFile('now-playing')).toBe('now-playing.png');
  });

  it('falls back to PNG when asked', async () => {
    configureCardEncoding({ format: 'png' });

    const card = await encodeCard(canvas());

    expect(cardFormat()).toBe('png');
    expect(card.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('keeps the drawing at its full size', async () => {
    const image = await loadImage(await encodeCard(canvas(640, 360)));

    expect([image.width, image.height]).toEqual([640, 360]);
  });

  it('is far smaller than the same picture as PNG', async () => {
    const drawing = canvas(1536, 1024);

    const webp = await encodeCard(drawing);
    configureCardEncoding({ format: 'png' });
    const png = await encodeCard(drawing);

    // The whole reason for the switch: a Now Playing card goes from ~947 KB to
    // ~56 KB, which is what makes a panel cheap enough to send often.
    expect(webp.byteLength).toBeLessThan(png.byteLength);
  });

  it('refuses a quality outside the encoder’s range', async () => {
    // Clamped rather than thrown: a bad number in the environment should not
    // stop the bot from drawing.
    configureCardEncoding({ quality: 5_000 });
    await expect(encodeCard(canvas())).resolves.toBeInstanceOf(Buffer);

    configureCardEncoding({ quality: -20 });
    await expect(encodeCard(canvas())).resolves.toBeInstanceOf(Buffer);
  });
});
