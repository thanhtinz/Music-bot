import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph } from '../glyphs';
import { drawMascot } from '../mascot';
import {
  fillRoundedRect,
  formatDuration,
  strokeRoundedRect,
  truncateText,
  type Rect,
} from '../primitives';
import { drawMusicNote, drawSparkle, drawStar, SAKURA_STICKER_COLORS } from '../stickers';
import { encodeCard } from '../encode';

export interface SearchCardResult {
  title: string;
  author: string;
  durationMs: number;
  /** Where it came from, shown as a small label. */
  source?: string;
  /** A stream has no length to show. */
  isStream?: boolean;
}

export interface SearchCardData {
  /** What was searched for, shown in the header. */
  query: string;
  results: SearchCardResult[];
  /** Guild prefix, used in the footer hint. */
  prefix?: string;
}

const WIDTH = 1200;
const HEIGHT = 780;

export const SEARCH_SAKURA_SIZE = { width: WIDTH, height: HEIGHT } as const;

/**
 * Five results a card.
 *
 * Enough to have chosen from, few enough that the numbers fit on one row of
 * buttons — Discord allows five to a row.
 */
export const SEARCH_SAKURA_ROWS = 5;

const PANEL: Rect = { x: 24, y: 22, width: WIDTH - 48, height: HEIGHT - 44 };

const ROWS = { x: 60, y: 168, height: 78, gap: 8 } as const;
const FOOTER_BASELINE = 648;

const COLORS = {
  backdrop: '#fdf3f1',
  panel: '#fef6f6',
  panelBorder: '#f8dbe4',
  card: '#ffffff',
  cardBorder: '#f6d9e2',
  ink: '#151215',
  inkSoft: '#5d4f54',
  inkMuted: '#9c8990',
  pink: '#ec5d84',
  pinkStrong: '#f2406e',
  pinkSoft: '#fbe0e9',
} as const;

/** Brand colour per source, so the label is placed before it is read. */
const SOURCE_COLORS: Record<string, string> = {
  youtube: '#ff0033',
  spotify: '#1db954',
  soundcloud: '#ff5500',
  radio: '#f2668f',
  http: '#8b8b8b',
};

/**
 * What a search turned up, numbered so it can be picked from.
 *
 * Drawn in code rather than composited onto a template: the card is as long as
 * the results are, and a fixed illustration would have to be redrawn for every
 * count between one and five.
 */
export async function renderSakuraSearchCard(data: SearchCardData): Promise<Buffer> {
  registerFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawStickers(ctx);
  drawHeader(ctx, data);
  drawResults(ctx, data.results.slice(0, SEARCH_SAKURA_ROWS));
  drawFooter(ctx, data);

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1074, bottomY: 742, height: 128 });

  return encodeCard(canvas);
}

function drawBackground(ctx: SKRSContext2D): void {
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  fillRoundedRect(ctx, PANEL, 32, COLORS.panel);
  strokeRoundedRect(ctx, PANEL, 32, COLORS.panelBorder, 2);
}

function drawStickers(ctx: SKRSContext2D): void {
  const colors = SAKURA_STICKER_COLORS;

  drawMusicNote(ctx, 1040, 84, 38, colors.pink, true);
  drawStar(ctx, 984, 60, 24, colors.yellow, '#eab54f');
  drawSparkle(ctx, 1096, 56, 16, colors.pinkSoft);
  drawSparkle(ctx, 92, 700, 15, colors.pinkSoft);
}

function drawHeader(ctx: SKRSContext2D, data: SearchCardData): void {
  const iconBox: Rect = { x: 60, y: 52, width: 56, height: 56 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'search',
    { x: iconBox.x + 14, y: iconBox.y + 14, width: 28, height: 28 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(34, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('SEARCH RESULTS', 136, 88);

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(truncateText(ctx, `“${data.query}”`, 700), 136, 118);
}

function drawResults(ctx: SKRSContext2D, results: SearchCardResult[]): void {
  if (results.length === 0) {
    ctx.textAlign = 'left';
    ctx.font = font(22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText('Nothing found.', ROWS.x + 8, ROWS.y + 44);
    return;
  }

  results.forEach((result, index) => {
    const box: Rect = {
      x: ROWS.x,
      y: ROWS.y + index * (ROWS.height + ROWS.gap),
      width: PANEL.width - 72,
      height: ROWS.height,
    };

    fillRoundedRect(ctx, box, 18, COLORS.card);
    strokeRoundedRect(ctx, box, 18, COLORS.cardBorder, 2);

    drawNumber(ctx, box, index + 1);

    const textX = box.x + 84;
    // Room kept clear on the right for the duration and the source label.
    const textWidth = box.width - 84 - 200;

    ctx.textAlign = 'left';
    ctx.font = font(23, 'bold');
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(truncateText(ctx, result.title, textWidth), textX, box.y + 34);

    ctx.font = font(17);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, result.author, textWidth), textX, box.y + 60);

    drawMeta(ctx, box, result);
  });
}

/** The pick number, matching the button under the card. */
function drawNumber(ctx: SKRSContext2D, box: Rect, position: number): void {
  const radius = 22;
  const cx = box.x + 26 + radius;
  const cy = box.y + box.height / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.pinkSoft;
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = font(22, 'bold');
  ctx.fillStyle = COLORS.pinkStrong;
  ctx.fillText(String(position), cx, cy + 8);
  ctx.textAlign = 'left';
}

function drawMeta(ctx: SKRSContext2D, box: Rect, result: SearchCardResult): void {
  const right = box.x + box.width - 24;

  ctx.textAlign = 'right';
  ctx.font = font(21, 'bold');
  ctx.fillStyle = COLORS.pink;
  ctx.fillText(result.isStream ? 'LIVE' : formatDuration(result.durationMs), right, box.y + 34);

  if (result.source) {
    const label = result.source.toUpperCase();

    ctx.font = font(15, 'bold');
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(label, right, box.y + 60);

    // A dot in the source's own colour, left of its name.
    const width = ctx.measureText(label).width;
    ctx.beginPath();
    ctx.arc(right - width - 12, box.y + 55, 5, 0, Math.PI * 2);
    ctx.fillStyle = SOURCE_COLORS[result.source.toLowerCase()] ?? COLORS.inkMuted;
    ctx.fill();
  }

  ctx.textAlign = 'left';
}

function drawFooter(ctx: SKRSContext2D, data: SearchCardData): void {
  ctx.textAlign = 'left';
  ctx.font = font(19);
  ctx.fillStyle = COLORS.inkSoft;

  const hint = data.results.length
    ? 'Pick a number below. Choices expire after two minutes.'
    : `Try another search with ${data.prefix ?? '/'}search.`;

  ctx.fillText(truncateText(ctx, hint, 860), ROWS.x + 4, FOOTER_BASELINE);
}
