import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';

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
  type Rect,
} from '../primitives';
import type { NowPlayingCardData } from './now-playing.card';

/**
 * Pre-rendered artwork this card composites onto.
 *
 * Everything decorative — the pastel ground, stickers, transport row and the
 * framed cover tile — lives in the image. The renderer only paints the parts
 * that change, which keeps the illustrated look without redrawing it in code.
 */
const TEMPLATE_PATH = resolve(__dirname, '../../../../assets/templates/now-playing-sakura.png');

export const SAKURA_TEMPLATE_SIZE = { width: 1536, height: 1024 } as const;

/**
 * Coordinates measured from the template at its native 1536×1024 size.
 *
 * They are pixel measurements of a specific image, so they only make sense
 * together with that file: replacing the template means re-measuring these.
 */
const REGION = {
  /** Inside of the framed tile, where the cover art goes. */
  artwork: { x: 92, y: 160, width: 451, height: 472 },
  artworkRadius: 20,

  /** Status pill; only its text is repainted so the icon survives. */
  statusPill: { x: 600, y: 183, width: 291, height: 68 },
  statusText: { x: 676, y: 196, width: 212, height: 44 },

  /**
   * `clearTop` is where the repaint starts. It sits below the sparkle sticker
   * that overhangs the text band, so covering the old title never clips it.
   */
  title: { x: 602, baseline: 378, maxWidth: 585, size: 72, clearTop: 300 },
  artist: { x: 607, baseline: 456, maxWidth: 480, size: 44, clearTop: 414 },

  sourcePill: { x: 600, y: 489, width: 237, height: 63 },

  progress: { x: 603, y: 607, width: 609, height: 16 },
  knobRadius: 15,

  times: { left: 605, right: 1208, baseline: 669, size: 30 },

  playButton: { cx: 759, cy: 813, radius: 60 },
} as const;

const INK = '#2c2724';
const INK_SOFT = '#6f6663';
const TIME_INK = '#776a6a';
const TRACK = '#f2e5e3';
const ACCENT: readonly [string, string] = ['#f78fb3', '#f2668f'];
const BUTTON_PINK = '#f984a7';
const PILL_BORDER = '#f0d6de';

/** Badge colors so a source reads at a glance even without its logo. */
const SOURCE_COLORS: Record<string, string> = {
  youtube: '#ff0033',
  spotify: '#1db954',
  soundcloud: '#ff5500',
  radio: '#f2668f',
  http: '#8b8b8b',
};

let templateCache: Image | undefined;

/** Loads and caches the template image. */
async function loadTemplate(): Promise<Image> {
  if (templateCache) return templateCache;

  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `Sakura card template missing at ${TEMPLATE_PATH}. ` +
        'Restore assets/templates/now-playing-sakura.png or use the classic variant.',
    );
  }

  templateCache = await loadImage(TEMPLATE_PATH);
  return templateCache;
}

/**
 * Renders the illustrated pastel Now Playing card.
 *
 * Layout is fixed by the template, so this only repaints the dynamic regions:
 * cover art, status label, title, artist, source badge, progress and times, and
 * the play/pause glyph.
 */
export async function renderSakuraNowPlayingCard(data: NowPlayingCardData): Promise<Buffer> {
  registerFonts();

  const template = await loadTemplate();
  const canvas = createCanvas(SAKURA_TEMPLATE_SIZE.width, SAKURA_TEMPLATE_SIZE.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0, SAKURA_TEMPLATE_SIZE.width, SAKURA_TEMPLATE_SIZE.height);

  const artwork = await loadArtwork(data.artworkUrl, `${data.title} ${data.author}`);

  drawArtwork(ctx, artwork);
  drawStatusLabel(ctx, data);
  drawTitleAndArtist(ctx, data);
  drawSourceBadge(ctx, data);
  drawProgress(ctx, data);
  drawTimes(ctx, data);
  drawPlayButton(ctx, data);

  return canvas.toBuffer('image/png');
}

/**
 * Paints over a region using the template's own background colour.
 *
 * Sampling rather than hard-coding the pink keeps the patch invisible even
 * though the illustrated ground is very slightly uneven.
 */
function coverWithBackground(ctx: SKRSContext2D, rect: Rect, sampleAt: { x: number; y: number }) {
  const { data: pixel } = ctx.getImageData(sampleAt.x, sampleAt.y, 1, 1);
  ctx.fillStyle = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawArtwork(ctx: SKRSContext2D, artwork: Image): void {
  const rect: Rect = { ...REGION.artwork };
  withRoundedClip(ctx, rect, REGION.artworkRadius, () => drawImageCover(ctx, artwork, rect));
}

function drawStatusLabel(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const pill = REGION.statusPill;
  const text = REGION.statusText;

  // Sample inside the pill, clear of both the icon and the baked-in label.
  coverWithBackground(ctx, text, { x: pill.x + pill.width - 6, y: pill.y + pill.height / 2 });

  ctx.font = font(24, 'bold');
  ctx.fillStyle = INK;
  // Centred in the space left of the pill's icon, so the shorter PAUSED label
  // does not leave the pill looking lopsided.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    data.paused ? 'PAUSED' : 'NOW PLAYING',
    text.x + text.width / 2,
    pill.y + pill.height / 2 + 1,
  );
}

function drawTitleAndArtist(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const { title, artist } = REGION;

  coverWithBackground(
    ctx,
    {
      x: title.x - 8,
      y: title.clearTop,
      width: title.maxWidth + 20,
      height: title.baseline + 12 - title.clearTop,
    },
    { x: title.x - 20, y: title.baseline - 20 },
  );
  coverWithBackground(
    ctx,
    {
      x: artist.x - 8,
      y: artist.clearTop,
      width: artist.maxWidth + 20,
      height: artist.baseline + 14 - artist.clearTop,
    },
    { x: artist.x - 20, y: artist.baseline - 10 },
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(title.size, 'bold');
  ctx.fillStyle = INK;
  ctx.fillText(
    truncateText(ctx, data.title || 'Unknown title', title.maxWidth),
    title.x,
    title.baseline,
  );

  ctx.font = font(artist.size);
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(
    truncateText(ctx, data.author || 'Unknown artist', artist.maxWidth),
    artist.x,
    artist.baseline,
  );
}

function drawSourceBadge(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const pill = REGION.sourcePill;
  const source = (data.source ?? 'unknown').toLowerCase();
  const label = source.toUpperCase();

  ctx.font = font(26, 'bold');
  const textWidth = ctx.measureText(label).width;
  const glyphWidth = 40;
  const width = Math.max(pill.width, glyphWidth + textWidth + 62);

  coverWithBackground(
    ctx,
    { x: pill.x - 6, y: pill.y - 8, width: width + 24, height: pill.height + 16 },
    { x: pill.x - 14, y: pill.y - 14 },
  );

  const rect: Rect = { x: pill.x, y: pill.y, width, height: pill.height };
  fillRoundedRect(ctx, rect, pill.height / 2, '#ffffff');
  strokeRoundedRect(ctx, rect, pill.height / 2, PILL_BORDER, 2);

  // Rounded tile + white play triangle, standing in for each source's mark.
  const glyph: Rect = {
    x: rect.x + 22,
    y: rect.y + (rect.height - 28) / 2,
    width: glyphWidth,
    height: 28,
  };
  fillRoundedRect(ctx, glyph, 8, SOURCE_COLORS[source] ?? '#8b8b8b');

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(glyph.x + 16, glyph.y + 8);
  ctx.lineTo(glyph.x + 26, glyph.y + glyph.height / 2);
  ctx.lineTo(glyph.x + 16, glyph.y + glyph.height - 8);
  ctx.closePath();
  ctx.fill();

  ctx.font = font(26, 'bold');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, glyph.x + glyph.width + 14, rect.y + rect.height / 2 + 1);
}

function progressRatio(data: NowPlayingCardData): number {
  if (data.isStream) return 1;
  return clamp(data.durationMs > 0 ? data.positionMs / data.durationMs : 0, 0, 1);
}

function drawProgress(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const bar = REGION.progress;

  coverWithBackground(
    ctx,
    { x: bar.x - 24, y: bar.y - 22, width: bar.width + 48, height: bar.height + 46 },
    { x: bar.x - 30, y: bar.y - 28 },
  );

  const track: Rect = { x: bar.x, y: bar.y, width: bar.width, height: bar.height };
  fillRoundedRect(ctx, track, bar.height / 2, TRACK);

  const ratio = progressRatio(data);
  const filledWidth = Math.max(bar.height, bar.width * ratio);
  fillRoundedRect(
    ctx,
    { ...track, width: filledWidth },
    bar.height / 2,
    linearGradient(ctx, track, ACCENT),
  );

  if (!data.isStream) {
    const knobX = bar.x + filledWidth;
    const knobY = bar.y + bar.height / 2;

    ctx.beginPath();
    ctx.arc(knobX, knobY, REGION.knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ACCENT[1];
    ctx.stroke();
  }
}

function drawTimes(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const times = REGION.times;

  coverWithBackground(
    ctx,
    {
      x: times.left - 10,
      y: times.baseline - times.size,
      width: times.right - times.left + 30,
      height: times.size + 18,
    },
    { x: times.left - 20, y: times.baseline },
  );

  ctx.font = font(times.size, 'bold');
  ctx.fillStyle = TIME_INK;
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.fillText(data.isStream ? 'LIVE' : formatClock(data.positionMs), times.left, times.baseline);

  ctx.textAlign = 'right';
  ctx.fillText(data.isStream ? '∞' : formatClock(data.durationMs), times.right, times.baseline);
}

/**
 * Zero-padded `mm:ss`, matching the timestamps drawn into the template.
 *
 * The shared formatter trims the leading zero, which would make the live text
 * sit differently from the rest of the illustration.
 */
function formatClock(ms: number): string {
  const formatted = formatDuration(ms);
  return /^\d:/.test(formatted) ? `0${formatted}` : formatted;
}

/** Repaints the transport button so its glyph matches the real state. */
function drawPlayButton(ctx: SKRSContext2D, data: NowPlayingCardData): void {
  const { cx, cy, radius } = REGION.playButton;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = BUTTON_PINK;
  ctx.fill();

  ctx.fillStyle = '#ffffff';

  if (data.paused) {
    // Play triangle, nudged right so it reads as centred inside the circle.
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 26);
    ctx.lineTo(cx + 26, cy);
    ctx.lineTo(cx - 16, cy + 26);
    ctx.closePath();
    ctx.fill();
    return;
  }

  const barWidth = 11;
  const barHeight = 46;
  for (const offset of [-18, 7]) {
    fillRoundedRect(
      ctx,
      { x: cx + offset, y: cy - barHeight / 2, width: barWidth, height: barHeight },
      4,
      '#ffffff',
    );
  }
}
