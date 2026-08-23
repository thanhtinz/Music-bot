import { expect } from 'vitest';

import { cardFormat } from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Whether a buffer really holds an image in the format cards are encoded in.
 *
 * Checked against the configured format rather than against PNG, so switching
 * the encoder is a one-line change here instead of seventy assertions.
 */
export function isCardImage(buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.byteLength < 12) return false;

  if (cardFormat() === 'png') return buffer.subarray(0, 8).equals(PNG_MAGIC);

  // A WebP file is a RIFF container whose form type says WEBP.
  return (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

/** Fails with the first bytes shown, which is what tells a truncated file apart. */
export function expectCardImage(buffer: Buffer | undefined): void {
  expect({
    format: cardFormat(),
    head: buffer?.subarray(0, 12).toString('hex'),
    valid: isCardImage(buffer),
  }).toMatchObject({ valid: true });
}
