import { describe, expect, it } from 'vitest';

import { sourceColor, sourceLabel } from '../../src/ui/canvas/sources';

describe('source labels', () => {
  it('spells a service the way the service does', () => {
    // `APPLEMUSIC` is what the source is called in code, not what Apple calls it.
    expect(sourceLabel('applemusic')).toBe('APPLE MUSIC');
    expect(sourceLabel('deezer')).toBe('DEEZER');
    expect(sourceLabel('youtube')).toBe('YOUTUBE');
  });

  it('names an unknown source rather than drawing a blank', () => {
    expect(sourceLabel('bandcamp')).toBe('BANDCAMP');
    expect(sourceLabel(undefined)).toBe('UNKNOWN');
  });
});

describe('source colours', () => {
  it('gives every source we resolve its own colour', () => {
    const colors = ['youtube', 'spotify', 'applemusic', 'deezer', 'soundcloud', 'radio'].map(
      (source) => sourceColor(source),
    );

    expect(new Set(colors).size).toBe(colors.length);
  });

  it('falls back to grey for one nothing knows about', () => {
    expect(sourceColor('bandcamp')).toBe(sourceColor(undefined));
  });
});
