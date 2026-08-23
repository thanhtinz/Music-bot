import type { FilterOptions } from 'shoukaku';

/** Filter presets offered to users (spec §9). */
export const FILTER_PRESETS = [
  'default',
  'bass',
  'nightcore',
  'vaporwave',
  'chill',
  'party',
  'karaoke',
  '8d',
  'tremolo',
  'vibrato',
] as const;

export type FilterPreset = (typeof FILTER_PRESETS)[number];

/** Equalizer curve that lifts the low bands without muddying the mids. */
const BASS_BANDS = [
  { band: 0, gain: 0.32 },
  { band: 1, gain: 0.28 },
  { band: 2, gain: 0.22 },
  { band: 3, gain: 0.14 },
  { band: 4, gain: 0.06 },
];

const CHILL_BANDS = [
  { band: 0, gain: 0.12 },
  { band: 1, gain: 0.1 },
  { band: 10, gain: -0.05 },
  { band: 11, gain: -0.08 },
  { band: 12, gain: -0.1 },
];

const PARTY_BANDS = [
  { band: 0, gain: 0.25 },
  { band: 1, gain: 0.2 },
  { band: 8, gain: 0.12 },
  { band: 9, gain: 0.16 },
  { band: 10, gain: 0.18 },
];

/**
 * Translates a preset name into Lavalink filter settings.
 *
 * Returning an empty object for `default` is what clears whatever was applied
 * before — Lavalink treats an absent key as "leave it alone", so every preset
 * lists all the fields it wants reset (spec §9).
 */
export function toFilterOptions(preset: string | undefined): FilterOptions {
  const cleared: FilterOptions = {
    equalizer: [],
    timescale: null,
    tremolo: null,
    vibrato: null,
    rotation: null,
    karaoke: null,
    lowPass: null,
  };

  switch (preset) {
    case undefined:
    case 'default':
      return cleared;

    case 'bass':
      return { ...cleared, equalizer: BASS_BANDS };

    case 'nightcore':
      return { ...cleared, timescale: { speed: 1.2, pitch: 1.2, rate: 1 } };

    case 'vaporwave':
      return {
        ...cleared,
        timescale: { speed: 0.82, pitch: 0.85, rate: 1 },
        equalizer: CHILL_BANDS,
      };

    case 'chill':
      return { ...cleared, equalizer: CHILL_BANDS, lowPass: { smoothing: 12 } };

    case 'party':
      return { ...cleared, equalizer: PARTY_BANDS, tremolo: { frequency: 4, depth: 0.2 } };

    case 'karaoke':
      return {
        ...cleared,
        karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 },
      };

    case '8d':
      return { ...cleared, rotation: { rotationHz: 0.2 } };

    case 'tremolo':
      return { ...cleared, tremolo: { frequency: 4, depth: 0.6 } };

    case 'vibrato':
      return { ...cleared, vibrato: { frequency: 4, depth: 0.6 } };

    default:
      throw new Error(`Unknown filter preset: ${preset}`);
  }
}

/** Whether a name is one of the presets we ship. */
export function isFilterPreset(name: string): name is FilterPreset {
  return (FILTER_PRESETS as readonly string[]).includes(name);
}
