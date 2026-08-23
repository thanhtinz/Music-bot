import type { Canvas } from '@napi-rs/canvas';

/** Formats a card can be sent as. */
export type CardFormat = 'webp' | 'png';

/**
 * How a card is turned into bytes.
 *
 * PNG encoding is the entire cost of a card — compositing the template is
 * effectively free, while encoding 1536×1024 takes some 660 ms and produces
 * about 947 KB. WebP encodes the same picture in ~140 ms and 56 KB: seventeen
 * times smaller, and at quality 90 it is indistinguishable from the PNG at 2×
 * zoom, edges of Vietnamese diacritics included.
 *
 * PNG stays available for a client that will not take WebP, or to rule the
 * format out while chasing a rendering problem.
 */
let format: CardFormat = 'webp';

/**
 * WebP quality.
 *
 * 90 rather than the 70 that would also look fine: the difference is 26 KB
 * against a 947 KB baseline, which is not worth spending on a card somebody
 * might zoom into. Quality 100 is lossless in this encoder, but at 826 KB it
 * saves nothing worth having.
 */
let quality = 90;

/** Sets the format cards are encoded in. Called once, at boot. */
export function configureCardEncoding(options: { format?: CardFormat; quality?: number }): void {
  if (options.format) format = options.format;
  if (options.quality !== undefined) quality = Math.min(100, Math.max(1, options.quality));
}

/** The format cards are currently encoded in. */
export function cardFormat(): CardFormat {
  return format;
}

/**
 * Names an attachment for the format it actually holds.
 *
 * Discord reads the extension to decide whether a file is an image worth
 * showing inline, so a WebP called `.png` is a card nobody sees.
 */
export function cardFile(base: string): string {
  return `${base}.${format}`;
}

/** Encodes a finished card. */
export async function encodeCard(canvas: Canvas): Promise<Buffer> {
  return format === 'png' ? canvas.toBuffer('image/png') : canvas.encode('webp', quality);
}
