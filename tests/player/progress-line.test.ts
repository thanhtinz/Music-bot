import { describe, expect, it } from 'vitest';

import { progressBar, progressLine, PROGRESS_SEGMENTS } from '../../src/application/player';

/** Where the knob sits, counting from 0. */
function knobAt(bar: string): number {
  return [...bar].indexOf('🔘');
}

describe('progressBar', () => {
  it('keeps the same width from the first second to the last', () => {
    // Otherwise the line would reflow under the card as the song plays.
    for (const position of [0, 1_000, 100_000, 199_000, 200_000, 900_000]) {
      expect([...progressBar(position, 200_000)]).toHaveLength(PROGRESS_SEGMENTS);
    }
  });

  it('moves the knob with the position', () => {
    expect(knobAt(progressBar(0, 200_000))).toBe(0);
    expect(knobAt(progressBar(100_000, 200_000))).toBe(PROGRESS_SEGMENTS / 2);
    expect(knobAt(progressBar(200_000, 200_000))).toBe(PROGRESS_SEGMENTS - 1);
  });

  it('never runs off either end', () => {
    // A position past the duration is normal: the player reports where it is,
    // and a track can be a beat past its own length.
    expect(knobAt(progressBar(999_000, 200_000))).toBe(PROGRESS_SEGMENTS - 1);
    expect(knobAt(progressBar(-5_000, 200_000))).toBe(0);
  });

  it('survives a track with no length to be a fraction of', () => {
    expect([...progressBar(60_000, 0)]).toHaveLength(PROGRESS_SEGMENTS);
    expect([...progressBar(60_000, Number.NaN)]).toHaveLength(PROGRESS_SEGMENTS);
  });
});

describe('progressLine', () => {
  it('reads as a clock beside the bar', () => {
    const line = progressLine({ positionMs: 90_000, durationMs: 245_000 });

    expect(line).toContain('`1:30 / 4:05`');
    expect(line).toContain('🔘');
  });

  it('says a paused player is paused', () => {
    // A stopped bar and a broken bar look the same otherwise.
    expect(progressLine({ positionMs: 90_000, durationMs: 245_000, paused: true })).toMatch(
      /paused$/,
    );
  });

  it('shows a live stream as live rather than as a fraction', () => {
    expect(progressLine({ positionMs: 90_000, durationMs: 0, isStream: true })).toContain('LIVE');
  });
});
