import { formatDuration } from '../../ui/canvas/primitives';

/** How many blocks the bar is drawn from. */
export const PROGRESS_SEGMENTS = 18;

/** The bar is one repeated block with the playhead sitting in it. */
const TRACK = '▬';
const KNOB = '🔘';

/**
 * The live line above a Now Playing card.
 *
 * Text rather than a redrawn card, and that is the whole point: editing a
 * message's text leaves its attachment untouched, so a viewer's client updates
 * the words in place instead of re-fetching the image. The bar moves and the
 * panel never blinks — and nothing has to be encoded to make it happen, which
 * a redrawn card cannot claim.
 */
export function progressLine(state: {
  positionMs: number;
  durationMs: number;
  isStream?: boolean;
  paused?: boolean;
}): string {
  if (state.isStream) return `${KNOB} **LIVE**`;

  const bar = progressBar(state.positionMs, state.durationMs);
  const clock = `\`${formatDuration(state.positionMs)} / ${formatDuration(state.durationMs)}\``;

  // A paused player's position stops moving, so the line says why rather than
  // looking like a bar that has quietly stopped working.
  return state.paused ? `${bar} ${clock} · paused` : `${bar} ${clock}`;
}

/**
 * The bar itself: a knob at the playhead, blocks either side.
 *
 * The knob replaces a block rather than sitting between two, so the bar keeps
 * the same width from the first second to the last and the line does not
 * reflow under the card as the song plays.
 */
export function progressBar(positionMs: number, durationMs: number): string {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;

  // Nothing to be a fraction of: a live stream or a track of unknown length.
  if (duration === 0) return `${KNOB}${TRACK.repeat(PROGRESS_SEGMENTS - 1)}`;

  const ratio = Math.min(1, position / duration);
  const knob = Math.min(PROGRESS_SEGMENTS - 1, Math.floor(ratio * PROGRESS_SEGMENTS));

  return `${TRACK.repeat(knob)}${KNOB}${TRACK.repeat(PROGRESS_SEGMENTS - 1 - knob)}`;
}
