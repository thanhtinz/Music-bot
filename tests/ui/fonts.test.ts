import { readFileSync } from 'node:fs';

import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { cjkFallbackFamilies, font, registerFonts } from '../../src/ui/canvas/fonts';

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

/**
 * Whether this host can render CJK at all.
 *
 * The CJK faces are not vendored — the family is tens of megabytes — so they
 * come from the host, and a machine without one draws boxes no matter what the
 * renderer does. Asserting on the pixels there would be asserting on apt, so
 * those checks skip and the environment tests below carry the guarantee
 * instead: CI and the runtime image both install the font, and CI is where a
 * real regression has to be caught.
 */
const hasCjk = cjkFallbackFamilies().length > 0;

describe('font coverage', () => {
  it('draws Vietnamese diacritics, including stacked ones', () => {
    expect(ink('ế')).not.toBe(ink('e'));
    expect(ink('ượ')).not.toBe(ink('uo'));
  });

  // Anime openings and K-pop are a large share of what a music bot is asked
  // for, so a CJK title has to survive the trip to the card.
  it.skipIf(!hasCjk)('draws Japanese, Korean and Chinese titles rather than boxes', () => {
    expect(ink('夜')).not.toBe(ink('春'));
    expect(ink('か')).not.toBe(ink('め'));
    expect(ink('봄')).not.toBe(ink('날'));
  });

  it.skipIf(!hasCjk)('does not collapse a CJK title onto the Latin fallback box', () => {
    // A tofu box is the same shape whatever character asked for it: if the
    // Japanese and the Korean glyph render identically, neither is real.
    expect(ink('夜')).not.toBe(ink('봄'));
  });

  it.skipIf(!hasCjk)('puts the CJK families in the chain the cards ask for', () => {
    const chain = font(56, 'bold');

    for (const family of cjkFallbackFamilies()) expect(chain).toContain(`"${family}"`);
  });

  it('installs a CJK font wherever the bot actually runs', () => {
    // The check above skips on a bare host, so this is what stops the skip from
    // becoming permanent: every environment that matters ships the font, and on
    // those the pixel checks run for real.
    expect(readFileSync('Dockerfile', 'utf8')).toContain('fonts-noto-cjk');
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('fonts-noto-cjk');
  });
});
