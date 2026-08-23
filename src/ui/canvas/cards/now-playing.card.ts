import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';

import { loadArtwork } from '../artwork';
import { font, registerFonts } from '../fonts';
import {
  clamp,
  drawImageCover,
  fillRoundedRect,
  formatDuration,
  linearGradient,
  strokeRoundedRect,
  truncateText,
  withRoundedClip,
  withShadow,
  type Rect,
} from '../primitives';
import { resolveTheme, type CanvasTheme } from '../theme';
import type { LoopMode } from '../../../domain/music/queue';

export type { LoopMode };

export interface NowPlayingCardData {
  title: string;
  author: string;
  /** Remote artwork URL. Falls back to a generated cover when missing. */
  artworkUrl?: string;
  durationMs: number;
  positionMs: number;
  /** Live streams have no meaningful duration and render a LIVE badge. */
  isStream?: boolean;
  paused?: boolean;
  requesterName: string;
  volume: number;
  loop: LoopMode;
  autoplay?: boolean;
  queueLength: number;
  filterPreset?: string;
  /** Where the audio came from, e.g. `youtube` or `spotify`. */
  source?: string;
  /** Theme name; unknown values fall back to the default theme. */
  theme?: string;
}

const WIDTH = 1000;
const HEIGHT = 420;
/** Rendering scale — cards are drawn at 2x so Discord downsamples them crisply. */
const SCALE = 2;

const PADDING = 44;
const ARTWORK_SIZE = 232;
const ARTWORK_TOP = 72;
const COLUMN_X = PADDING + ARTWORK_SIZE + 32;
const COLUMN_WIDTH = WIDTH - PADDING - COLUMN_X;

const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Off',
  song: 'Track',
  queue: 'Queue',
};

/**
 * Renders the Now Playing panel as a PNG.
 *
 * The card is self-contained: it performs its own artwork loading and never
 * throws on bad input, so callers can hand it raw player state.
 */
export async function renderNowPlayingCard(data: NowPlayingCardData): Promise<Buffer> {
  registerFonts();

  const theme = resolveTheme(data.theme);
  const canvas = createCanvas(WIDTH * SCALE, HEIGHT * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const artwork = await loadArtwork(data.artworkUrl, `${data.title} ${data.author}`);

  drawBackground(ctx, theme, artwork);
  drawHeader(ctx, theme, data);
  drawArtwork(ctx, theme, artwork, Boolean(data.paused));
  drawTrackInfo(ctx, theme, data);
  drawWaveform(ctx, theme, data);
  drawProgress(ctx, theme, data);
  drawMetaBar(ctx, theme, data);

  return canvas.toBuffer('image/png');
}

function drawBackground(ctx: SKRSContext2D, theme: CanvasTheme, artwork: Image): void {
  const card: Rect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The artwork is blown up far past the card and blurred so it reads as an
  // ambient wash rather than a recognisable second copy of the cover.
  withRoundedClip(ctx, card, 0, () => {
    ctx.save();
    ctx.globalAlpha = theme.artworkBleed;
    ctx.filter = 'blur(48px)';
    drawImageCover(ctx, artwork, { x: -80, y: -160, width: WIDTH + 160, height: HEIGHT + 320 });
    ctx.restore();
  });

  ctx.fillStyle = linearGradient(
    ctx,
    card,
    ['rgba(6, 8, 12, 0.55)', 'rgba(6, 8, 12, 0.92)'],
    'vertical',
  );
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawHeader(ctx: SKRSContext2D, theme: CanvasTheme, data: NowPlayingCardData): void {
  const y = 34;

  drawEqualizerGlyph(ctx, theme, PADDING, y + 16, Boolean(data.paused));

  ctx.font = font(17, 'bold');
  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const label = data.paused ? 'PAUSED' : 'NOW PLAYING';
  ctx.fillText(label, PADDING + 34, y + 16);

  const badgeText = (data.source ?? 'unknown').toUpperCase();
  drawBadge(ctx, theme, badgeText, WIDTH - PADDING, y + 16);
}

/** Five bars whose heights encode "playing" (varied) vs "paused" (flat). */
function drawEqualizerGlyph(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  x: number,
  centerY: number,
  paused: boolean,
): void {
  const heights = paused ? [8, 8, 8, 8, 8] : [10, 20, 14, 24, 12];
  const barWidth = 3.5;
  const gap = 3;

  ctx.fillStyle = theme.accent[0];
  heights.forEach((height, index) => {
    const barX = x + index * (barWidth + gap);
    fillRoundedRect(
      ctx,
      { x: barX, y: centerY - height / 2, width: barWidth, height },
      barWidth / 2,
      theme.accent[index % 2 === 0 ? 0 : 1],
    );
  });
}

/** Right-aligned pill used for the source badge. */
function drawBadge(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  text: string,
  rightX: number,
  centerY: number,
): void {
  ctx.font = font(14, 'bold');
  const textWidth = ctx.measureText(text).width;
  const width = textWidth + 28;
  const height = 30;
  const rect: Rect = { x: rightX - width, y: centerY - height / 2, width, height };

  fillRoundedRect(ctx, rect, height / 2, theme.surface);
  strokeRoundedRect(ctx, rect, height / 2, theme.surfaceBorder, 1);

  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x + width / 2, centerY + 1);
}

function drawArtwork(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  artwork: Image,
  paused: boolean,
): void {
  const rect: Rect = { x: PADDING, y: ARTWORK_TOP, width: ARTWORK_SIZE, height: ARTWORK_SIZE };

  withShadow(ctx, { color: 'rgba(0, 0, 0, 0.55)', blur: 30, offsetY: 12 }, () => {
    fillRoundedRect(ctx, rect, 22, theme.background);
  });

  withRoundedClip(ctx, rect, 22, () => {
    drawImageCover(ctx, artwork, rect);
    if (paused) {
      ctx.fillStyle = 'rgba(6, 8, 12, 0.55)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      drawPauseGlyph(ctx, rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
  });

  strokeRoundedRect(ctx, rect, 22, 'rgba(255, 255, 255, 0.14)', 1.5);
}

function drawPauseGlyph(ctx: SKRSContext2D, centerX: number, centerY: number): void {
  const barWidth = 12;
  const barHeight = 46;
  const gap = 12;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  for (const offset of [-(gap / 2 + barWidth), gap / 2]) {
    fillRoundedRect(
      ctx,
      { x: centerX + offset, y: centerY - barHeight / 2, width: barWidth, height: barHeight },
      4,
      'rgba(255, 255, 255, 0.92)',
    );
  }
}

function drawTrackInfo(ctx: SKRSContext2D, theme: CanvasTheme, data: NowPlayingCardData): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = font(36, 'bold');
  ctx.fillStyle = theme.textPrimary;
  ctx.fillText(truncateText(ctx, data.title || 'Unknown title', COLUMN_WIDTH), COLUMN_X, 84);

  ctx.font = font(23);
  ctx.fillStyle = theme.textSecondary;
  ctx.fillText(truncateText(ctx, data.author || 'Unknown artist', COLUMN_WIDTH), COLUMN_X, 134);
}

/**
 * Decorative waveform above the progress bar.
 *
 * Bar heights are derived deterministically from the track title so the same
 * track always renders the same silhouette — we do not decode the audio.
 */
function drawWaveform(ctx: SKRSContext2D, theme: CanvasTheme, data: NowPlayingCardData): void {
  const bars = 68;
  const gap = 3;
  const barWidth = (COLUMN_WIDTH - gap * (bars - 1)) / bars;
  const maxHeight = 34;
  const baseline = 198;

  const ratio = data.isStream
    ? 1
    : clamp(data.durationMs > 0 ? data.positionMs / data.durationMs : 0, 0, 1);
  const playedBars = Math.round(bars * ratio);

  let seed = 0;
  const key = `${data.title}${data.author}`;
  for (let i = 0; i < key.length; i += 1) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;

  const gradient = linearGradient(
    ctx,
    { x: COLUMN_X, y: 0, width: COLUMN_WIDTH, height: 0 },
    theme.accent,
  );

  for (let i = 0; i < bars; i += 1) {
    // Two out-of-phase sines plus the seed give an organic, non-repeating shape.
    const noise = Math.abs(Math.sin(i * 0.7 + seed * 0.0001) * 0.6 + Math.sin(i * 0.19) * 0.4);
    const height = Math.max(4, noise * maxHeight);
    const x = COLUMN_X + i * (barWidth + gap);
    const played = i < playedBars;

    fillRoundedRect(
      ctx,
      { x, y: baseline - height, width: barWidth, height },
      barWidth / 2,
      played ? gradient : 'rgba(255, 255, 255, 0.12)',
    );
  }
}

function drawProgress(ctx: SKRSContext2D, theme: CanvasTheme, data: NowPlayingCardData): void {
  const barY = 208;
  const barHeight = 12;
  const track: Rect = { x: COLUMN_X, y: barY, width: COLUMN_WIDTH, height: barHeight };

  fillRoundedRect(ctx, track, barHeight / 2, theme.accentTrack);

  const ratio = data.isStream
    ? 1
    : clamp(data.durationMs > 0 ? data.positionMs / data.durationMs : 0, 0, 1);
  const filledWidth = Math.max(barHeight, COLUMN_WIDTH * ratio);
  const filled: Rect = { ...track, width: filledWidth };

  fillRoundedRect(ctx, filled, barHeight / 2, linearGradient(ctx, track, theme.accent));

  if (!data.isStream) {
    const knobX = COLUMN_X + filledWidth;
    withShadow(ctx, { color: 'rgba(0, 0, 0, 0.45)', blur: 10 }, () => {
      ctx.beginPath();
      ctx.arc(knobX, barY + barHeight / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });
  }

  ctx.font = font(17, 'bold');
  ctx.fillStyle = theme.textSecondary;
  ctx.textBaseline = 'top';

  ctx.textAlign = 'left';
  ctx.fillText(data.isStream ? 'LIVE' : formatDuration(data.positionMs), COLUMN_X, barY + 24);

  ctx.textAlign = 'right';
  ctx.fillText(
    data.isStream ? '∞' : formatDuration(data.durationMs),
    COLUMN_X + COLUMN_WIDTH,
    barY + 24,
  );
}

/** Bottom strip of key/value chips describing the player state. */
function drawMetaBar(ctx: SKRSContext2D, theme: CanvasTheme, data: NowPlayingCardData): void {
  const chips: Array<{ label: string; value: string }> = [
    { label: 'Requested by', value: data.requesterName || 'Unknown' },
    { label: 'Volume', value: `${clamp(Math.round(data.volume), 0, 1000)}%` },
    { label: 'Loop', value: LOOP_LABEL[data.loop] ?? 'Off' },
    { label: 'Queue', value: `${Math.max(0, data.queueLength)} tracks` },
  ];

  if (data.filterPreset && data.filterPreset !== 'default') {
    chips.push({ label: 'Filter', value: data.filterPreset });
  }
  if (data.autoplay) {
    chips.push({ label: 'Autoplay', value: 'On' });
  }

  const barY = 322;
  const barHeight = 62;
  const bar: Rect = { x: PADDING, y: barY, width: WIDTH - PADDING * 2, height: barHeight };

  fillRoundedRect(ctx, bar, 18, theme.surface);
  strokeRoundedRect(ctx, bar, 18, theme.surfaceBorder, 1);

  const cellWidth = bar.width / chips.length;
  chips.forEach((chip, index) => {
    const centerX = bar.x + cellWidth * index + cellWidth / 2;

    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(bar.x + cellWidth * index, bar.y + 14);
      ctx.lineTo(bar.x + cellWidth * index, bar.y + barHeight - 14);
      ctx.strokeStyle = theme.surfaceBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.font = font(13);
    ctx.fillStyle = theme.textMuted;
    ctx.fillText(truncateText(ctx, chip.label, cellWidth - 20), centerX, bar.y + 13);

    ctx.font = font(18, 'bold');
    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(truncateText(ctx, chip.value, cellWidth - 20), centerX, bar.y + 32);
  });
}

/** Card dimensions, exported for tests and layout assertions. */
export const NOW_PLAYING_CARD_SIZE = {
  width: WIDTH,
  height: HEIGHT,
  scale: SCALE,
} as const;
