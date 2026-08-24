/**
 * How each audio source is coloured and named on a card.
 *
 * One table rather than one per card: a badge on the Now Playing panel and a
 * row on the search card are labelling the same thing, and two copies drift the
 * moment a source is added — which is exactly what happened when Apple Music
 * and Deezer arrived and only one of the two knew about them.
 */
const COLORS: Record<string, string> = {
  youtube: '#ff0033',
  spotify: '#1db954',
  applemusic: '#fa243c',
  deezer: '#a238ff',
  soundcloud: '#ff5500',
  radio: '#f2668f',
  http: '#8b8b8b',
};

/**
 * Names that are not just the key in capitals.
 *
 * `APPLEMUSIC` is what the source is called in code; it is not what the service
 * is called.
 */
const LABELS: Record<string, string> = {
  applemusic: 'APPLE MUSIC',
};

const FALLBACK_COLOR = '#8b8b8b';

/** Brand colour for a source, grey for one nothing knows about. */
export function sourceColor(source: string | undefined): string {
  return COLORS[(source ?? '').toLowerCase()] ?? FALLBACK_COLOR;
}

/** The name shown on a badge, in the capitals the cards draw. */
export function sourceLabel(source: string | undefined): string {
  const key = (source ?? 'unknown').toLowerCase();
  return LABELS[key] ?? key.toUpperCase();
}
