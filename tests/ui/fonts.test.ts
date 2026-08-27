import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { font, registerFonts } from '../../src/ui/canvas/fonts';

/**
 * Renders one string and returns its ink as a hex digest of the pixel bytes.
 *
 * Two different characters that both fall back to `.notdef` produce the very
 * same box, so identical ink between two unrelated glyphs is the signature of
 * a missing font — which is exactly what a user sees as `□`.
 */
function ink(text: string): string {
  registerFonts();
  const canvas = createCanvas(200, 90);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 200, 90);
  ctx.font = font(56, 'bold');
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 45);
  return canvas.toBuffer('image/png').toString('base64');
}

describe('font coverage', () => {
  it('draws Vietnamese diacritics, including stacked ones', () => {
    expect(ink('ế')).not.toBe(ink('e'));
    expect(ink('ượ')).not.toBe(ink('uo'));
  });

  // Anime openings and K-pop are a large share of what a music bot is asked
  // for, so a CJK title has to survive the trip to the card.
  it('draws Japanese, Korean and Chinese titles rather than boxes', () => {
    expect(ink('夜')).not.toBe(ink('春'));
    expect(ink('か')).not.toBe(ink('め'));
    expect(ink('봄')).not.toBe(ink('날'));
  });

  it('does not collapse a CJK title onto the Latin fallback box', () => {
    // A tofu box is the same shape whatever character asked for it: if the
    // Japanese and the Korean glyph render identically, neither is real.
    expect(ink('夜')).not.toBe(ink('봄'));
  });
});
