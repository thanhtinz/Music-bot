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

export interface HistoryCardEntry {
  title: string;
  author: string;
  durationMs: number;
  /** Who queued it, or the stand-in for a track the bot chose. */
  requesterName?: string;
  /** A live stream has no length to show. */
  isStream?: boolean;
}

export interface HistoryCardData {
  /** Newest first, already sliced to a page. */
  entries: HistoryCardEntry[];
  /** Server name, shown in the header. */
  guildName?: string;
  /** Total remembered, when more were played than fit. */
  totalCount?: number;
  /** Guild prefix, for the footer hint. */
  prefix?: string;
}

const WIDTH = 1200;

/**
 * Six rows a card.
 *
 * The history is kept for `previous` to walk back through, not as an archive;
 * six is what a room can remember arguing about.
 */
export const HISTORY_SAKURA_ROWS = 6;

const ROWS = { x: 60, y: 168, height: 78, gap: 8 } as const;

/**
 * The card is as tall as the history is long.
 *
 * A fixed height would leave a room that has played two songs staring at four
 * empty rows' worth of nothing.
 */
export function historyCardHeight(count: number): number {
  const rows = Math.min(Math.max(count, 1), HISTORY_SAKURA_ROWS);
  const bottom = ROWS.y + rows * (ROWS.height + ROWS.gap) - ROWS.gap;

  // The band below the last row holds the footer hint and the mascot; without
  // enough of it the mascot sits on top of the final row's duration.
  return bottom + 150;
}

/** The size of a full card, for callers that need one number. */
export const HISTORY_SAKURA_SIZE = {
  width: WIDTH,
  height: historyCardHeight(HISTORY_SAKURA_ROWS),
} as const;

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

/**
 * What the room has already heard, newest first.
 *
 * Numbered like the queue card, but counting backwards in time: row 1 is what
 * just finished, which is what somebody asking "what was that song" means.
 */
export async function renderSakuraHistoryCard(data: HistoryCardData): Promise<Buffer> {
  registerFonts();

  const entries = data.entries.slice(0, HISTORY_SAKURA_ROWS);
  const height = historyCardHeight(entries.length);

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, height);
  drawStickers(ctx);
  drawHeader(ctx, data);
  drawEntries(ctx, entries);
  drawFooter(ctx, data, height);

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1080, bottomY: height - 26, height: 110 });

  return canvas.toBuffer('image/png');
}

function panelOf(height: number): Rect {
  return { x: 24, y: 22, width: WIDTH - 48, height: height - 44 };
}

function drawBackground(ctx: SKRSContext2D, height: number): void {
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, WIDTH, height);

  const panel = panelOf(height);
  fillRoundedRect(ctx, panel, 32, COLORS.panel);
  strokeRoundedRect(ctx, panel, 32, COLORS.panelBorder, 2);
}

function drawStickers(ctx: SKRSContext2D): void {
  const colors = SAKURA_STICKER_COLORS;

  drawMusicNote(ctx, 1040, 84, 38, colors.pink, true);
  drawStar(ctx, 984, 60, 24, colors.yellow, '#eab54f');
  drawSparkle(ctx, 1096, 56, 16, colors.pinkSoft);
  drawSparkle(ctx, 1152, 132, 15, colors.pinkSoft);
}

function drawHeader(ctx: SKRSContext2D, data: HistoryCardData): void {
  const iconBox: Rect = { x: 60, y: 52, width: 56, height: 56 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'clock',
    { x: iconBox.x + 14, y: iconBox.y + 14, width: 28, height: 28 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(34, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('RECENTLY PLAYED', 136, 88);

  const shown = Math.min(data.entries.length, HISTORY_SAKURA_ROWS);
  const total = data.totalCount ?? data.entries.length;

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkMuted;
  const subtitle = [data.guildName, total > shown ? `${shown} of ${total}` : undefined]
    .filter(Boolean)
    .join('  ·  ');
  if (subtitle) ctx.fillText(truncateText(ctx, subtitle, 700), 136, 118);
}

function drawEntries(ctx: SKRSContext2D, entries: HistoryCardEntry[]): void {
  if (entries.length === 0) {
    ctx.textAlign = 'left';
    ctx.font = font(22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText('Nothing has finished playing yet.', ROWS.x + 8, ROWS.y + 44);
    return;
  }

  entries.forEach((entry, index) => {
    const box: Rect = {
      x: ROWS.x,
      y: ROWS.y + index * (ROWS.height + ROWS.gap),
      width: WIDTH - 48 - 72,
      height: ROWS.height,
    };

    fillRoundedRect(ctx, box, 18, COLORS.card);
    strokeRoundedRect(ctx, box, 18, COLORS.cardBorder, 2);

    drawNumber(ctx, box, index + 1);

    const textX = box.x + 84;
    // Room kept clear on the right for the duration and who queued it.
    const textWidth = box.width - 84 - 220;

    ctx.textAlign = 'left';
    ctx.font = font(23, 'bold');
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(truncateText(ctx, entry.title, textWidth), textX, box.y + 34);

    ctx.font = font(17);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, entry.author, textWidth), textX, box.y + 60);

    drawMeta(ctx, box, entry);
  });
}

/** How far back it was, counting from what just finished. */
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

function drawMeta(ctx: SKRSContext2D, box: Rect, entry: HistoryCardEntry): void {
  const right = box.x + box.width - 24;

  ctx.textAlign = 'right';
  ctx.font = font(21, 'bold');
  ctx.fillStyle = COLORS.pink;
  ctx.fillText(entry.isStream ? 'LIVE' : formatDuration(entry.durationMs), right, box.y + 34);

  if (entry.requesterName) {
    ctx.font = font(16);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, entry.requesterName, 200), right, box.y + 60);
  }

  ctx.textAlign = 'left';
}

function drawFooter(ctx: SKRSContext2D, data: HistoryCardData, height: number): void {
  ctx.textAlign = 'left';
  ctx.font = font(19);
  ctx.fillStyle = COLORS.inkSoft;

  const hint = data.entries.length
    ? `Play one again with ${data.prefix ?? '/'}play, or step back with ${data.prefix ?? '/'}previous.`
    : 'Tracks land here once they finish.';

  ctx.fillText(truncateText(ctx, hint, 860), ROWS.x + 4, height - 46);
}
