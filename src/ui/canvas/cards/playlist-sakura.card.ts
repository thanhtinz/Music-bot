import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph } from '../glyphs';
import {
  clamp,
  fillRoundedRect,
  formatDuration,
  linearGradient,
  strokeRoundedRect,
  truncateText,
  withRoundedClip,
  type Rect,
} from '../primitives';
import { BOT_NAME, drawMascot } from '../mascot';
import {
  drawBow,
  drawHeartSwirl,
  drawMusicNote,
  drawSparkle,
  drawStar,
  SAKURA_STICKER_COLORS,
} from '../stickers';

export interface PlaylistCardEntry {
  name: string;
  trackCount: number;
  /** Total playtime; streams count as zero. */
  totalDurationMs: number;
  /** Shown under the name, e.g. the owner's display name. */
  ownerName?: string;
  /** `private` playlists get a badge so the distinction is visible at a glance. */
  visibility?: 'public' | 'private';
}

export interface PlaylistCardData {
  entries: PlaylistCardEntry[];
  /** Whose library this is, shown in the header. */
  ownerName: string;
  page?: number;
  totalPages?: number;
  /** Total playlists across every page. */
  totalCount?: number;
  /** Guild prefix, used in the footer hint. */
  prefix?: string;
}

const WIDTH = 1536;
const HEIGHT = 1024;

/** Six tiles fit without crowding; more would shrink the names past reading. */
export const PLAYLIST_SAKURA_PAGE_SIZE = 6;

const PADDING = 44;
const PANEL: Rect = { x: 28, y: 24, width: WIDTH - 56, height: HEIGHT - 48 };
const HEADER_BASELINE = 108;

const GRID = {
  x: 64,
  y: 190,
  columns: 2,
  rows: 3,
  gapX: 28,
  gapY: 34,
  width: 672,
  height: 186,
} as const;

const COLORS = {
  backdrop: '#fdf3f1',
  panel: '#fef6f6',
  panelBorder: '#f8dbe4',
  tile: '#ffffff',
  tileBorder: '#f6d9e2',
  ink: '#151215',
  inkSoft: '#6b5b60',
  inkMuted: '#9c8990',
  pink: '#ec5d84',
  pinkStrong: '#f2406e',
  pinkSoft: '#fbe0e9',
  badge: '#fdeef2',
} as const;

/** Cover gradients, picked by name so a playlist keeps the same colours. */
const COVER_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#f78fb3', '#f56a9b'],
  ['#a78bfa', '#7c6cf0'],
  ['#6ee7d5', '#38bdf8'],
  ['#fcd34d', '#fb923c'],
  ['#f9a8d4', '#c084fc'],
  ['#86efac', '#4ade80'],
];

/**
 * Renders a user's playlist library (spec §11).
 *
 * Unlike the other pastel cards this one is drawn entirely in code — there is
 * no template behind it — so the layout adapts to however many playlists there
 * are instead of clearing unused rows.
 */
export async function renderSakuraPlaylistCard(data: PlaylistCardData): Promise<Buffer> {
  registerFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawStickers(ctx);
  await drawMascot(ctx, { centerX: 1374, bottomY: 964, height: 150 });
  drawHeader(ctx, data);

  const entries = data.entries.slice(0, PLAYLIST_SAKURA_PAGE_SIZE);
  if (entries.length === 0) {
    // The empty state already says what to do; the footer's "play one" hint
    // would be advice about playlists that do not exist.
    drawEmptyState(ctx, data);
  } else {
    entries.forEach((entry, index) => drawEntry(ctx, entry, index));
    drawFooter(ctx, data);
  }

  return canvas.toBuffer('image/png');
}

function drawBackground(ctx: SKRSContext2D): void {
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  fillRoundedRect(ctx, PANEL, 32, COLORS.panel);
  strokeRoundedRect(ctx, PANEL, 32, COLORS.panelBorder, 2);
}

/** Scatters the decorations that tie this card to the template-backed ones. */
function drawStickers(ctx: SKRSContext2D): void {
  const colors = SAKURA_STICKER_COLORS;

  drawBow(ctx, 1408, 96, 96, colors.pinkSoft, colors.pink);
  drawStar(ctx, 1300, 128, 34, colors.yellow, '#eab54f');
  drawMusicNote(ctx, 1150, 118, 46, colors.pink, true);
  drawSparkle(ctx, 1240, 78, 18, colors.pinkSoft);
  drawSparkle(ctx, 1348, 158, 14, colors.yellow);

  drawHeartSwirl(ctx, 112, 906, 76, colors.pinkSoft);
  drawMusicNote(ctx, 1218, 902, 40, colors.pink);
  drawStar(ctx, 1162, 958, 26, colors.yellow, '#eab54f');
  drawSparkle(ctx, 1272, 968, 16, colors.pinkSoft);
}

function drawHeader(ctx: SKRSContext2D, data: PlaylistCardData): void {
  const iconBox: Rect = { x: PADDING + 24, y: 56, width: 60, height: 60 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'playlist',
    { x: iconBox.x + 14, y: iconBox.y + 14, width: 32, height: 32 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const titleX = iconBox.x + iconBox.width + 22;
  ctx.font = font(38, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('PLAYLISTS', titleX, HEADER_BASELINE - 12);
  // Measured with the font it was drawn in — measuring after switching fonts
  // put the count flush against the title.
  const titleWidth = ctx.measureText('PLAYLISTS').width;

  const total = data.totalCount ?? data.entries.length;
  ctx.font = font(34, 'bold');
  ctx.fillStyle = COLORS.pink;
  ctx.fillText(`(${total})`, titleX + titleWidth + 14, HEADER_BASELINE - 12);

  ctx.font = font(22);
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText(
    truncateText(ctx, `${BOT_NAME}  ·  saved by ${data.ownerName}`, 520),
    iconBox.x + iconBox.width + 22,
    HEADER_BASELINE + 24,
  );

  const totalPages = Math.max(1, data.totalPages ?? 1);
  if (totalPages > 1) {
    const page = clamp(data.page ?? 1, 1, totalPages);
    ctx.font = font(24, 'bold');
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${page}/${totalPages}`, 1060, HEADER_BASELINE - 12);
    ctx.textAlign = 'left';
  }
}

function entryRect(index: number): Rect {
  const column = index % GRID.columns;
  const row = Math.floor(index / GRID.columns);

  return {
    x: GRID.x + column * (GRID.width + GRID.gapX),
    y: GRID.y + row * (GRID.height + GRID.gapY),
    width: GRID.width,
    height: GRID.height,
  };
}

function drawEntry(ctx: SKRSContext2D, entry: PlaylistCardEntry, index: number): void {
  const rect = entryRect(index);

  fillRoundedRect(ctx, rect, 22, COLORS.tile);
  strokeRoundedRect(ctx, rect, 22, COLORS.tileBorder, 2);

  const cover: Rect = { x: rect.x + 22, y: rect.y + 24, width: 138, height: 138 };
  drawCover(ctx, cover, entry.name);

  const textX = cover.x + cover.width + 22;
  const textWidth = rect.x + rect.width - textX - 24;
  // The badge sits in the same band as the name, so the name gets less room.
  const nameWidth = entry.visibility === 'private' ? textWidth - 116 : textWidth;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(28, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(truncateText(ctx, entry.name || 'Untitled playlist', nameWidth), textX, rect.y + 66);

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkSoft;
  const tracks = `${Math.max(0, entry.trackCount)} ${entry.trackCount === 1 ? 'track' : 'tracks'}`;
  const duration = formatDuration(Math.max(0, entry.totalDurationMs));
  ctx.fillText(truncateText(ctx, `${tracks}  ·  ${duration}`, textWidth), textX, rect.y + 104);

  if (entry.ownerName) {
    ctx.font = font(18);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, entry.ownerName, textWidth), textX, rect.y + 136);
  }

  if (entry.visibility === 'private') drawVisibilityBadge(ctx, rect);
}

/** Gradient cover with the playlist's initial, matching the artwork fallback. */
function drawCover(ctx: SKRSContext2D, rect: Rect, name: string): void {
  const palette = COVER_PALETTES[hashOf(name) % COVER_PALETTES.length] as readonly [string, string];

  withRoundedClip(ctx, rect, 18, () => {
    ctx.fillStyle = linearGradient(ctx, rect, palette, 'vertical');
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = rect.width * 0.05;
    for (let i = 1; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.arc(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        (rect.width / 2.4) * (i / 3),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }

    const initial = (name.trim()[0] ?? '♪').toUpperCase();
    ctx.font = font(rect.height * 0.46, 'bold');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, rect.x + rect.width / 2, rect.y + rect.height / 2 + rect.height * 0.02);
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  strokeRoundedRect(ctx, rect, 18, 'rgba(0, 0, 0, 0.06)', 2);
}

function drawVisibilityBadge(ctx: SKRSContext2D, rect: Rect): void {
  const label = 'PRIVATE';

  ctx.font = font(15, 'bold');
  const width = ctx.measureText(label).width + 30;
  const badge: Rect = {
    x: rect.x + rect.width - width - 20,
    y: rect.y + 24,
    width,
    height: 30,
  };

  fillRoundedRect(ctx, badge, 15, COLORS.badge);
  strokeRoundedRect(ctx, badge, 15, COLORS.pinkSoft, 1.5);

  ctx.fillStyle = COLORS.pink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badge.x + badge.width / 2, badge.y + badge.height / 2 + 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Shown instead of the grid when the library is empty. */
function drawEmptyState(ctx: SKRSContext2D, data: PlaylistCardData): void {
  const prefix = data.prefix ?? '/';
  const centerX = 620;
  const centerY = GRID.y + 290;

  drawGlyph(
    ctx,
    'playlist',
    { x: centerX - 44, y: centerY - 110, width: 88, height: 88 },
    COLORS.pinkSoft,
    5,
  );

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(30, 'bold');
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText('No playlists yet', centerX, centerY + 20);

  ctx.font = font(22);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(`Make one with ${prefix}playlist create <name>`, centerX, centerY + 60);

  ctx.textAlign = 'left';
}

function drawFooter(ctx: SKRSContext2D, data: PlaylistCardData): void {
  const prefix = data.prefix ?? '/';
  const y = HEIGHT - 74;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkSoft;
  const lead = 'Play one with ';
  ctx.fillText(lead, GRID.x + 8, y);
  let cursor = GRID.x + 8 + ctx.measureText(lead).width;

  ctx.font = font(21, 'bold');
  ctx.fillStyle = COLORS.pinkStrong;
  const command = `${prefix}playlist play <name>`;
  ctx.fillText(command, cursor, y);
  cursor += ctx.measureText(command).width;

  ctx.font = font(21);
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText('  ·  add the current track with ', cursor, y);
  cursor += ctx.measureText('  ·  add the current track with ').width;

  ctx.font = font(21, 'bold');
  ctx.fillStyle = COLORS.pinkStrong;
  ctx.fillText(`${prefix}playlist add <name>`, cursor, y);
}

/** Stable hash so a playlist keeps its cover colours between renders. */
function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

export const PLAYLIST_SAKURA_SIZE = { width: WIDTH, height: HEIGHT } as const;
