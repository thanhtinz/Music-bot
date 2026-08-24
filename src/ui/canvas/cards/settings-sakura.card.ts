import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph, glyphFor } from '../glyphs';
import { drawMascot } from '../mascot';
import { fillRoundedRect, strokeRoundedRect, truncateText, type Rect } from '../primitives';
import { drawMusicNote, drawSparkle, drawStar, SAKURA_STICKER_COLORS } from '../stickers';
import { encodeCard } from '../encode';

export interface SettingsCardRow {
  /** The key someone types, e.g. `prefix`. */
  key: string;
  label: string;
  /** Current value, already formatted. */
  value: string;
  description: string;
  /** Glyph key; defaults to the setting's own key. */
  icon?: string;
}

export interface SettingsCardData {
  rows: SettingsCardRow[];
  /** Server name, shown in the header. */
  guildName?: string;
  /** Prefix used in the footer hint. */
  prefix?: string;
}

const WIDTH = 1200;

/**
 * As many rows as the settings list has.
 *
 * The card is drawn in code, so it grows instead of cutting the list off — a
 * sheet that silently stopped at five would hide whichever setting was added
 * last, which is exactly what happened when `announce` arrived and pushed 24/7
 * off the bottom.
 */
export const SETTINGS_SAKURA_MAX_ROWS = 10;

/** Height of a sheet with `rows` settings on it. */
export function settingsCardHeight(rows: number): number {
  const count = Math.min(Math.max(1, rows), SETTINGS_SAKURA_MAX_ROWS);
  // Below the last row: the gap the footer sat in when the card was fixed at
  // five rows, plus the footer itself.
  return ROWS.firstY + (count - 1) * ROWS.spacing + ROWS.height + 196;
}

/** The size of a full-length sheet, for tests and layout maths. */
export const SETTINGS_SAKURA_SIZE = {
  width: WIDTH,
  get height() {
    return settingsCardHeight(SETTINGS_SAKURA_MAX_ROWS);
  },
} as const;
const HEADER_BASELINE = 96;

const ROWS = {
  x: 60,
  firstY: 168,
  spacing: 96,
  width: WIDTH - 120,
  height: 82,
  radius: 20,
} as const;

const COLORS = {
  backdrop: '#fdf3f1',
  panel: '#fef6f6',
  panelBorder: '#f8dbe4',
  row: '#ffffff',
  rowBorder: '#f6d9e2',
  ink: '#151215',
  inkSoft: '#6b5b60',
  inkMuted: '#9c8990',
  pink: '#ec5d84',
  pinkStrong: '#f2406e',
  pinkSoft: '#fbe0e9',
} as const;

/**
 * The guild's settings, one row each.
 *
 * Drawn in code rather than composited onto a template: the row count follows
 * the descriptor list, so adding a setting cannot leave a stale row showing.
 */
export async function renderSakuraSettingsCard(data: SettingsCardData): Promise<Buffer> {
  registerFonts();

  const rows = data.rows.slice(0, SETTINGS_SAKURA_MAX_ROWS);
  const height = settingsCardHeight(rows.length);

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, height);
  drawStickers(ctx);
  drawHeader(ctx, data);

  rows.forEach((row, index) => drawRow(ctx, row, index));

  drawFooter(ctx, data, height);

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1062, bottomY: height - 30, height: 158 });

  return encodeCard(canvas);
}

function drawBackground(ctx: SKRSContext2D, height: number): void {
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, WIDTH, height);

  const panel: Rect = { x: 24, y: 22, width: WIDTH - 48, height: height - 44 };
  fillRoundedRect(ctx, panel, 32, COLORS.panel);
  strokeRoundedRect(ctx, panel, 32, COLORS.panelBorder, 2);
}

function drawStickers(ctx: SKRSContext2D): void {
  const colors = SAKURA_STICKER_COLORS;

  drawMusicNote(ctx, 1006, 84, 38, colors.pink, true);
  drawStar(ctx, 950, 60, 24, colors.yellow, '#eab54f');
  drawSparkle(ctx, 1062, 56, 16, colors.pinkSoft);
  // Kept clear of the footer line, which runs along the bottom left.
  drawSparkle(ctx, 646, 782, 16, colors.pinkSoft);
  drawStar(ctx, 700, 766, 20, colors.yellow, '#eab54f');
}

function drawHeader(ctx: SKRSContext2D, data: SettingsCardData): void {
  const iconBox: Rect = { x: 60, y: 52, width: 56, height: 56 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'gear',
    { x: iconBox.x + 13, y: iconBox.y + 13, width: 30, height: 30 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(36, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('SETTINGS', 136, HEADER_BASELINE - 10);

  if (data.guildName) {
    ctx.font = font(22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, data.guildName, 520), 136, HEADER_BASELINE + 22);
  }
}

function drawRow(ctx: SKRSContext2D, row: SettingsCardRow, index: number): void {
  const box: Rect = {
    x: ROWS.x,
    y: ROWS.firstY + index * ROWS.spacing,
    width: ROWS.width,
    height: ROWS.height,
  };

  fillRoundedRect(ctx, box, ROWS.radius, COLORS.row);
  strokeRoundedRect(ctx, box, ROWS.radius, COLORS.rowBorder, 2);

  const tile: Rect = { x: box.x + 20, y: box.y + 17, width: 48, height: 48 };
  fillRoundedRect(ctx, tile, 14, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    glyphFor(row.icon ?? row.key),
    { x: tile.x + 13, y: tile.y + 13, width: 22, height: 22 },
    COLORS.pinkStrong,
    2.6,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const textX = tile.x + tile.width + 20;
  ctx.font = font(26, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(truncateText(ctx, row.label, 300), textX, box.y + 36);

  ctx.font = font(19);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(truncateText(ctx, row.description, 380), textX, box.y + 63);

  // The value is right-aligned so the column reads down the card, and the key
  // sits under it because that is what someone has to type to change it.
  const right = box.x + box.width - 24;
  ctx.textAlign = 'right';
  ctx.font = font(26, 'bold');
  ctx.fillStyle = COLORS.pink;
  ctx.fillText(truncateText(ctx, row.value, 300), right, box.y + 36);

  ctx.font = font(18);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(row.key, right, box.y + 63);
  ctx.textAlign = 'left';
}

function drawFooter(ctx: SKRSContext2D, data: SettingsCardData, height: number): void {
  const prefix = data.prefix ?? '/';
  const baseline = height - 64;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const label = 'Change one with ';
  ctx.font = font(20);
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText(label, ROWS.x, baseline);
  // Measured in the font it was drawn in; measuring after the switch to bold
  // would leave the command overlapping the label.
  const width = ctx.measureText(label).width;

  ctx.font = font(20, 'bold');
  ctx.fillStyle = COLORS.pinkStrong;
  ctx.fillText(`${prefix}settings <name> <value>`, ROWS.x + width, baseline);
}
