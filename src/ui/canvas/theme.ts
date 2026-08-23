/**
 * Visual tokens shared by every canvas card.
 *
 * A theme is pure data so a guild (or a premium tier) can override colors
 * without the card renderers knowing anything about it.
 */
export interface CanvasTheme {
  readonly name: string;
  /** Card background, painted underneath the blurred artwork. */
  readonly background: string;
  /** Slightly lifted surface used for chips and inner panels. */
  readonly surface: string;
  readonly surfaceBorder: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  /** Gradient used by the progress bar and accent strokes. */
  readonly accent: readonly [string, string];
  /** Track (unfilled) color of progress bars. */
  readonly accentTrack: string;
  readonly danger: string;
  readonly success: string;
  /** How strongly the artwork bleeds through the background, 0..1. */
  readonly artworkBleed: number;
}

export const THEMES = {
  midnight: {
    name: 'midnight',
    background: '#0d1017',
    surface: 'rgba(255, 255, 255, 0.07)',
    surfaceBorder: 'rgba(255, 255, 255, 0.10)',
    textPrimary: '#ffffff',
    textSecondary: '#c3cbd8',
    textMuted: '#8b95a6',
    accent: ['#5b8cff', '#a855f7'],
    accentTrack: 'rgba(255, 255, 255, 0.16)',
    danger: '#ff6b6b',
    success: '#4ade80',
    artworkBleed: 0.38,
  },
  sunset: {
    name: 'sunset',
    background: '#170f14',
    surface: 'rgba(255, 255, 255, 0.08)',
    surfaceBorder: 'rgba(255, 255, 255, 0.12)',
    textPrimary: '#fff7f2',
    textSecondary: '#e5c7bb',
    textMuted: '#a98a7d',
    accent: ['#ff8a3d', '#ff3d81'],
    accentTrack: 'rgba(255, 255, 255, 0.16)',
    danger: '#ff6b6b',
    success: '#facc15',
    artworkBleed: 0.42,
  },
  forest: {
    name: 'forest',
    background: '#0b1410',
    surface: 'rgba(255, 255, 255, 0.06)',
    surfaceBorder: 'rgba(255, 255, 255, 0.10)',
    textPrimary: '#f2fff7',
    textSecondary: '#b7d6c4',
    textMuted: '#7f9d8c',
    accent: ['#34d399', '#22d3ee'],
    accentTrack: 'rgba(255, 255, 255, 0.14)',
    danger: '#f87171',
    success: '#4ade80',
    artworkBleed: 0.36,
  },
} as const satisfies Record<string, CanvasTheme>;

export type ThemeName = keyof typeof THEMES;

export const DEFAULT_THEME: ThemeName = 'midnight';

/** Resolves a theme by name, falling back to {@link DEFAULT_THEME}. */
export function resolveTheme(name?: string): CanvasTheme {
  if (name && name in THEMES) return THEMES[name as ThemeName];
  return THEMES[DEFAULT_THEME];
}
