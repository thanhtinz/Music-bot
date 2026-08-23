import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { drawGlyph, glyphFor, type GlyphName } from '../../src/ui/canvas';

const ALL_GLYPHS: GlyphName[] = [
  'play',
  'pause',
  'stop',
  'skip',
  'previous',
  'plus',
  'list',
  'search',
  'note',
  'playlist',
  'gear',
  'info',
  'heart',
  'shuffle',
  'loop',
  'sliders',
  'clock',
  'volume',
  'question',
];

/** Renders one glyph on a blank canvas and returns its pixels. */
function render(name: GlyphName): Buffer {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  drawGlyph(ctx, name, { x: 8, y: 8, width: 48, height: 48 }, '#000000');
  return canvas.toBuffer('image/png');
}

describe('glyphFor', () => {
  it('maps command names to a matching glyph', () => {
    expect(glyphFor('play')).toBe('play');
    expect(glyphFor('resume')).toBe('play');
    expect(glyphFor('pause')).toBe('pause');
    expect(glyphFor('skip')).toBe('skip');
    expect(glyphFor('favorite')).toBe('heart');
    expect(glyphFor('shuffle')).toBe('shuffle');
  });

  it('maps category names too', () => {
    expect(glyphFor('playlist')).toBe('playlist');
    expect(glyphFor('settings')).toBe('gear');
    expect(glyphFor('filters')).toBe('sliders');
  });

  it('is case-insensitive', () => {
    expect(glyphFor('PLAY')).toBe('play');
    expect(glyphFor('Settings')).toBe('gear');
  });

  it('falls back to a question mark for anything unknown', () => {
    expect(glyphFor('bandcamp')).toBe('question');
    expect(glyphFor('')).toBe('question');
  });
});

describe('drawGlyph', () => {
  it('draws something for every glyph', () => {
    const blank = createCanvas(64, 64);
    const blankCtx = blank.getContext('2d');
    blankCtx.fillStyle = '#ffffff';
    blankCtx.fillRect(0, 0, 64, 64);
    const empty = blank.toBuffer('image/png');

    for (const name of ALL_GLYPHS) {
      expect(render(name).equals(empty), `${name} drew nothing`).toBe(false);
    }
  });

  it('gives every glyph a distinct silhouette', () => {
    // A command's icon has to mean something; two commands sharing a drawing
    // would be as wrong as inheriting the template's own icon.
    const rendered = new Map<string, GlyphName>();

    for (const name of ALL_GLYPHS) {
      const key = render(name).toString('base64');
      expect(rendered.has(key), `${name} looks identical to ${rendered.get(key)}`).toBe(false);
      rendered.set(key, name);
    }
  });

  it('leaves the context state as it found it', () => {
    const ctx = createCanvas(64, 64).getContext('2d');
    ctx.strokeStyle = '#123456';
    ctx.lineWidth = 7;

    drawGlyph(ctx, 'gear', { x: 0, y: 0, width: 32, height: 32 }, '#ff0000');

    expect(ctx.lineWidth).toBe(7);
    expect(ctx.strokeStyle).toBe('#123456');
  });
});
