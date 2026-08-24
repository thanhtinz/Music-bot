import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { COMMAND_CATALOG } from '../../src/commands/catalog';
import { drawGlyph, glyphFor, type GlyphName } from '../../src/ui/canvas';

/** Every TypeScript file under a directory, recursively. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

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
  'trash',
  'broom',
  'exit',
  'chart',
  'history',
  'warning',
  'megaphone',
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

  it('draws taking a track out as a bin and tidying up as a broom', () => {
    // A rounded square meant "stop" on every one of these.
    expect(glyphFor('remove')).toBe('trash');
    expect(glyphFor('removemine')).toBe('trash');
    expect(glyphFor('clear')).toBe('trash');
    expect(glyphFor('removedupes')).toBe('broom');
    expect(glyphFor('leavecleanup')).toBe('broom');
  });

  it('draws leaving as a door and stats as a chart', () => {
    expect(glyphFor('leave')).toBe('exit');
    expect(glyphFor('disconnect')).toBe('exit');
    expect(glyphFor('stats')).toBe('chart');
  });

  it('has one for every command and alias in the catalog', () => {
    // `remove`, `move`, `jump` and `history` each drew a question mark for a
    // while, having never been given one; this is what catches the next.
    for (const meta of COMMAND_CATALOG) {
      for (const name of [meta.name, ...(meta.aliases ?? [])]) {
        expect(glyphFor(name), `${name} has no glyph`).not.toBe('question');
      }
    }
  });

  it('has one for every icon a reply asks for', () => {
    // Reply payloads name their icon as a bare string, which nothing typed
    // checks — so the source is read and every name asked for is resolved.
    const asked = new Set<string>();

    for (const file of sourceFiles(resolve(__dirname, '../../src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/icon: '([a-z-]+)'/g)) {
        asked.add(match[1] as string);
      }
    }

    expect(asked.size).toBeGreaterThan(5);
    for (const icon of asked) {
      expect(glyphFor(icon), `a reply asks for the ${icon} icon`).not.toBe('question');
    }
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
