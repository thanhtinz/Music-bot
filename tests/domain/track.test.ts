import { describe, expect, it } from 'vitest';

import { createTrack, totalDurationMs, trackKey } from '../../src/domain/music';

const input = {
  source: 'youtube' as const,
  identifier: 'dQw4w9WgXcQ',
  title: 'Faded',
  author: 'Alan Walker',
  durationMs: 212_000,
  requesterId: '1',
};

describe('createTrack', () => {
  it('assigns a unique id per enqueue', () => {
    const a = createTrack(input);
    const b = createTrack(input);

    expect(a.id).not.toBe(b.id);
    expect(trackKey(a)).toBe(trackKey(b));
  });

  it('fills in placeholders for blank metadata', () => {
    const track = createTrack({ ...input, title: '   ', author: '' });

    expect(track.title).toBe('Unknown title');
    expect(track.author).toBe('Unknown artist');
  });

  it('treats a zero or invalid duration as a stream', () => {
    expect(createTrack({ ...input, durationMs: 0 }).isStream).toBe(true);
    expect(createTrack({ ...input, durationMs: Number.NaN }).durationMs).toBe(0);
    expect(createTrack({ ...input, durationMs: -5 }).durationMs).toBe(0);
  });

  it('honours an explicit isStream flag over the duration heuristic', () => {
    expect(createTrack({ ...input, durationMs: 0, isStream: false }).isStream).toBe(false);
  });

  it('freezes metadata so callers cannot mutate a queued track', () => {
    const track = createTrack({ ...input, metadata: { isrc: 'ABC' } });
    expect(() => {
      (track.metadata as Record<string, unknown>).isrc = 'XYZ';
    }).toThrow();
  });
});

describe('totalDurationMs', () => {
  it('sums track durations', () => {
    const tracks = [
      createTrack(input),
      createTrack({ ...input, identifier: 'b', durationMs: 88_000 }),
    ];
    expect(totalDurationMs(tracks)).toBe(300_000);
  });

  it('counts streams as zero-length', () => {
    const tracks = [createTrack(input), createTrack({ ...input, identifier: 'live', durationMs: 0 })];
    expect(totalDurationMs(tracks)).toBe(212_000);
  });

  it('returns zero for an empty list', () => {
    expect(totalDurationMs([])).toBe(0);
  });
});
