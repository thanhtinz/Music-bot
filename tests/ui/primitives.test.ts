import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { font, registerFonts } from '../../src/ui/canvas/fonts';
import { clamp, formatDuration, truncateText, wrapText } from '../../src/ui/canvas/primitives';

function context() {
  registerFonts();
  const ctx = createCanvas(800, 200).getContext('2d');
  ctx.font = font(20);
  return ctx;
}

describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(10 * 60_000 + 7_000)).toBe('10:07');
  });

  it('formats durations of an hour or more as h:mm:ss', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });

  it('is defensive about garbage input', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('clamp', () => {
  it('bounds values to the inclusive range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe('truncateText', () => {
  it('leaves text that already fits untouched', () => {
    const ctx = context();
    expect(truncateText(ctx, 'Faded', 400)).toBe('Faded');
  });

  it('ellipsises overlong text and keeps it within the budget', () => {
    const ctx = context();
    const long = 'Nevada (Extended Mix) — a very long track title that must be truncated';
    const result = truncateText(ctx, long, 240);

    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(long.length);
    expect(ctx.measureText(result).width).toBeLessThanOrEqual(240);
  });

  it('handles a budget too small for any glyph', () => {
    const ctx = context();
    expect(truncateText(ctx, 'Faded', 1)).toBe('…');
  });

  it('preserves Vietnamese diacritics while truncating', () => {
    const ctx = context();
    const result = truncateText(ctx, 'Chạy Ngay Đi — Sơn Tùng M-TP', 120);
    expect(result).toMatch(/^Chạ?/u);
  });
});

describe('wrapText', () => {
  it('wraps within the line budget', () => {
    const ctx = context();
    const lines = wrapText(ctx, 'một hai ba bốn năm sáu bảy tám chín mười', 160, 3);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(160);
    }
  });

  it('returns a single line when everything fits', () => {
    const ctx = context();
    expect(wrapText(ctx, 'ngắn', 400, 3)).toEqual(['ngắn']);
  });
});
