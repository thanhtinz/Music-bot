import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph } from '../glyphs';
import { drawMascot } from '../mascot';
import { fillRoundedRect, strokeRoundedRect, truncateText, type Rect } from '../primitives';
import { drawMusicNote, drawSparkle, drawStar, SAKURA_STICKER_COLORS } from '../stickers';
import { encodeCard } from '../encode';

export interface StatsCardEntry {
  /** Track title, artist name, or a person's display name. */
  label: string;
  /** Second line: the artist, or how long they listened. */
  detail?: string;
  plays: number;
  /** Picks this row out of the list — the person whose card this is. */
  highlight?: boolean;
}

export interface StatsCardData {
  /** Server name, shown in the header. */
  guildName?: string;
  totalPlays: number;
  totalListenedMs: number;
  /** When counting started, so the numbers have a period. */
  since?: number;
  topTracks: StatsCardEntry[];
  topArtists: StatsCardEntry[];
  topListeners: StatsCardEntry[];
  /** The caller's own line, when they have one. */
  you?: { plays: number; listenedMs: number };
  /**
   * Whose card this is, when it is one person's rather than the server's.
   *
   * Set, the columns are read as that person's and the summary becomes their
   * own totals and their place among the guild's listeners.
   */
  subject?: {
    name: string;
    plays: number;
    listenedMs: number;
    /** Their place among the listeners, counting from 1. */
    rank?: number;
    listenerCount: number;
  };
}

const WIDTH = 1200;
const HEIGHT = 900;

export const STATS_SAKURA_SIZE = { width: WIDTH, height: HEIGHT } as const;

/** Five rows a column — enough to be a chart, short enough to read at a glance. */
export const STATS_SAKURA_ROWS = 5;

const PANEL: Rect = { x: 24, y: 22, width: WIDTH - 48, height: HEIGHT - 44 };

const SUMMARY = { y: 150, height: 92, gap: 16, count: 3 } as const;
const COLUMNS = {
  y: 282,
  height: 300,
  gap: 20,
  count: 2,
  rowHeight: 46,
  firstRow: 62,
} as const;
/**
 * The listeners panel stops short of the right edge.
 *
 * It is the full width of the card otherwise, and the mascot sits in that
 * corner — running the panel under it hid the play counts entirely. Its height
 * holds all five rows: at 178 the fifth fell out of the bottom of the box.
 */
const LISTENERS = { y: 594, height: 276, gutter: 200 } as const;

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
  /** One shade up, for the row the card is about. */
  pinkMid: '#f7c8d8',
} as const;

/**
 * What a server listens to.
 *
 * Drawn in code, so the columns follow the data: a guild with no artists yet
 * gets a "nothing here" line rather than an empty box that looks broken.
 */
export async function renderSakuraStatsCard(data: StatsCardData): Promise<Buffer> {
  registerFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawStickers(ctx);
  drawHeader(ctx, data);
  drawSummary(ctx, data);

  const columnWidth = (PANEL.width - 72 - COLUMNS.gap) / COLUMNS.count;
  drawColumn(ctx, 'Top tracks', data.topTracks, {
    x: 60,
    y: COLUMNS.y,
    width: columnWidth,
    height: COLUMNS.height,
  });
  drawColumn(ctx, 'Top artists', data.topArtists, {
    x: 60 + columnWidth + COLUMNS.gap,
    y: COLUMNS.y,
    width: columnWidth,
    height: COLUMNS.height,
  });

  drawColumn(ctx, 'Top listeners', data.topListeners, {
    x: 60,
    y: LISTENERS.y,
    width: PANEL.width - 72 - LISTENERS.gutter,
    height: LISTENERS.height,
  });

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1078, bottomY: 848, height: 138 });

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
  drawSparkle(ctx, 1152, 132, 15, colors.pinkSoft);
}

function drawHeader(ctx: SKRSContext2D, data: StatsCardData): void {
  const iconBox: Rect = { x: 60, y: 52, width: 56, height: 56 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'list',
    { x: iconBox.x + 14, y: iconBox.y + 14, width: 28, height: 28 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(34, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(
    truncateText(ctx, data.subject ? data.subject.name.toUpperCase() : 'LISTENING STATS', 700),
    136,
    88,
  );

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkMuted;
  const subtitle = [
    data.subject ? (data.guildName ? `in ${data.guildName}` : 'listening stats') : data.guildName,
    data.since ? `since ${formatDate(data.since)}` : undefined,
  ]
    .filter(Boolean)
    .join('  ·  ');
  if (subtitle) ctx.fillText(truncateText(ctx, subtitle, 700), 136, 118);
}

function drawSummary(ctx: SKRSContext2D, data: StatsCardData): void {
  const width = (PANEL.width - 72 - SUMMARY.gap * (SUMMARY.count - 1)) / SUMMARY.count;

  const subject = data.subject;

  const cells: Array<[string, string]> = subject
    ? [
        [String(subject.plays), `of ${data.totalPlays} played here`],
        [formatHours(subject.listenedMs), 'spent listening'],
        [
          subject.rank ? `#${subject.rank}` : '—',
          `of ${subject.listenerCount} ${subject.listenerCount === 1 ? 'listener' : 'listeners'}`,
        ],
      ]
    : [
        [String(data.totalPlays), 'tracks played'],
        [formatHours(data.totalListenedMs), 'spent listening'],
        [
          data.you ? `${data.you.plays}` : '—',
          data.you ? `queued by you · ${formatHours(data.you.listenedMs)}` : 'queued by you',
        ],
      ];

  cells.forEach(([value, label], index) => {
    const box: Rect = {
      x: 60 + index * (width + SUMMARY.gap),
      y: SUMMARY.y,
      width,
      height: SUMMARY.height,
    };

    fillRoundedRect(ctx, box, 18, COLORS.card);
    strokeRoundedRect(ctx, box, 18, COLORS.cardBorder, 2);

    ctx.textAlign = 'left';
    ctx.font = font(30, 'bold');
    ctx.fillStyle = COLORS.pink;
    ctx.fillText(truncateText(ctx, value, box.width - 40), box.x + 20, box.y + 42);

    ctx.font = font(18);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, label, box.width - 40), box.x + 20, box.y + 70);
  });
}

function drawColumn(ctx: SKRSContext2D, title: string, entries: StatsCardEntry[], box: Rect): void {
  fillRoundedRect(ctx, box, 20, COLORS.card);
  strokeRoundedRect(ctx, box, 20, COLORS.cardBorder, 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(21, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(title, box.x + 22, box.y + 36);

  if (entries.length === 0) {
    ctx.font = font(18);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText('Nothing yet.', box.x + 22, box.y + COLUMNS.firstRow + 6);
    return;
  }

  const best = Math.max(1, ...entries.map((entry) => entry.plays));

  entries.slice(0, STATS_SAKURA_ROWS).forEach((entry, index) => {
    const top = box.y + COLUMNS.firstRow + index * COLUMNS.rowHeight;
    const countWidth = 74;
    const textWidth = box.width - 44 - countWidth;

    // A bar behind the row, so the shape of the list reads before the numbers.
    // The highlighted one is drawn taller: it is the only bar with an outline,
    // and at the usual height that outline ran straight through the row's
    // second line.
    const bar: Rect = {
      x: box.x + 16,
      y: top - (entry.highlight ? 20 : 16),
      width: Math.max(6, (box.width - 32) * (entry.plays / best)),
      height: entry.highlight ? 44 : 36,
    };
    fillRoundedRect(ctx, bar, 10, entry.highlight ? COLORS.pinkMid : COLORS.pinkSoft);
    if (entry.highlight) strokeRoundedRect(ctx, bar, 10, COLORS.pink, 2);

    ctx.font = font(19, 'bold');
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(truncateText(ctx, entry.label, textWidth), box.x + 26, top + 3);

    if (entry.detail) {
      ctx.font = font(15);
      ctx.fillStyle = COLORS.inkMuted;
      ctx.fillText(truncateText(ctx, entry.detail, textWidth), box.x + 26, top + 21);
    }

    ctx.textAlign = 'right';
    ctx.font = font(19, 'bold');
    ctx.fillStyle = COLORS.pink;
    ctx.fillText(`${entry.plays}`, box.x + box.width - 22, top + 3);
    ctx.textAlign = 'left';
  });
}

/** `3.5h`, or minutes while there is less than an hour of it. */
export function formatHours(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;

  const hours = minutes / 60;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
