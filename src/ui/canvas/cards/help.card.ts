import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import {
  fillRoundedRect,
  linearGradient,
  strokeRoundedRect,
  truncateText,
  type Rect,
} from '../primitives';
import { resolveTheme, type CanvasTheme } from '../theme';
import { encodeCard } from '../encode';

export interface HelpCardCommand {
  name: string;
  description: string;
  aliases?: string[];
}

export interface HelpCardGroup {
  /** Section heading, e.g. `Playback`. */
  title: string;
  commands: HelpCardCommand[];
}

export interface HelpCardData {
  groups: HelpCardGroup[];
  /** Guild prefix, shown in the header and in the usage examples. */
  prefix: string;
  /** Bot display name used for the `@Bot` example. */
  botName: string;
  theme?: string;
}

const WIDTH = 1000;
const SCALE = 2;
const PADDING = 40;
const COLUMN_GAP = 28;
const COLUMNS = 2;
const COLUMN_WIDTH = (WIDTH - PADDING * 2 - COLUMN_GAP) / COLUMNS;

const HEADER_HEIGHT = 128;
const GROUP_HEADER_HEIGHT = 38;
const ROW_HEIGHT = 40;
const GROUP_GAP = 14;
const FOOTER_HEIGHT = 58;

interface Block {
  group: HelpCardGroup;
  height: number;
}

function blockHeight(group: HelpCardGroup): number {
  return GROUP_HEADER_HEIGHT + group.commands.length * ROW_HEIGHT + GROUP_GAP;
}

/**
 * Splits groups across columns, always feeding the currently shorter column.
 *
 * Keeps the card compact without ever breaking a category across a column
 * boundary, which would be far harder to read.
 */
function layout(groups: HelpCardGroup[]): { columns: Block[][]; height: number } {
  const columns: Block[][] = Array.from({ length: COLUMNS }, () => []);
  const heights = new Array<number>(COLUMNS).fill(0);

  for (const group of groups) {
    const height = blockHeight(group);
    let target = 0;
    for (let i = 1; i < COLUMNS; i += 1) {
      if ((heights[i] as number) < (heights[target] as number)) target = i;
    }
    (columns[target] as Block[]).push({ group, height });
    heights[target] = (heights[target] as number) + height;
  }

  return { columns, height: Math.max(...heights, ROW_HEIGHT) };
}

/** Renders the full command matrix as a PNG (spec §5). */
export async function renderHelpCard(data: HelpCardData): Promise<Buffer> {
  registerFonts();

  const theme = resolveTheme(data.theme);
  const { columns, height: bodyHeight } = layout(data.groups);
  const height = HEADER_HEIGHT + bodyHeight + FOOTER_HEIGHT;

  const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  drawBackground(ctx, theme, height);
  drawHeader(ctx, theme, data);

  columns.forEach((blocks, index) => {
    let y = HEADER_HEIGHT;
    const x = PADDING + index * (COLUMN_WIDTH + COLUMN_GAP);

    for (const block of blocks) {
      drawGroup(ctx, theme, block.group, x, y, data.prefix);
      y += block.height;
    }
  });

  drawFooter(ctx, theme, data, height);

  return encodeCard(canvas);
}

function drawBackground(ctx: SKRSContext2D, theme: CanvasTheme, height: number): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, WIDTH, height);

  // A soft accent wash at the top keeps the header from reading as a flat slab.
  const wash = ctx.createLinearGradient(0, 0, WIDTH, HEADER_HEIGHT);
  wash.addColorStop(0, `${theme.accent[0]}22`);
  wash.addColorStop(1, `${theme.accent[1]}11`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WIDTH, HEADER_HEIGHT);
}

function drawHeader(ctx: SKRSContext2D, theme: CanvasTheme, data: HelpCardData): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(30, 'bold');
  ctx.fillStyle = theme.textPrimary;
  ctx.fillText('COMMANDS', PADDING, 54);

  ctx.font = font(16);
  ctx.fillStyle = theme.textSecondary;
  ctx.fillText('Every command works three ways — pick whichever you like:', PADDING, 82);

  const examples = [`/play`, `${data.prefix}play`, `@${data.botName} play`];
  let x = PADDING;
  for (const example of examples) {
    x += drawChip(ctx, theme, example, x, 96) + 10;
  }
}

/** Draws a pill at `(x, y)` and returns its width so callers can advance. */
function drawChip(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  text: string,
  x: number,
  y: number,
): number {
  ctx.font = font(14, 'bold');
  const width = ctx.measureText(text).width + 24;
  const rect: Rect = { x, y, width, height: 26 };

  fillRoundedRect(ctx, rect, 13, theme.surface);
  strokeRoundedRect(ctx, rect, 13, theme.surfaceBorder, 1);

  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, y + 14);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return width;
}

function drawGroup(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  group: HelpCardGroup,
  x: number,
  y: number,
  prefix: string,
): void {
  fillRoundedRect(
    ctx,
    { x, y: y + 8, width: 4, height: 18 },
    2,
    linearGradient(ctx, { x, y: y + 8, width: 4, height: 18 }, theme.accent, 'vertical'),
  );

  ctx.font = font(16, 'bold');
  ctx.fillStyle = theme.textPrimary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(group.title.toUpperCase(), x + 14, y + 23);

  group.commands.forEach((command, index) => {
    const rowY = y + GROUP_HEADER_HEIGHT + index * ROW_HEIGHT;

    if (index % 2 === 0) {
      fillRoundedRect(
        ctx,
        { x, y: rowY - 4, width: COLUMN_WIDTH, height: ROW_HEIGHT - 6 },
        10,
        'rgba(255, 255, 255, 0.035)',
      );
    }

    const label = `${prefix}${command.name}`;
    ctx.font = font(15, 'bold');
    ctx.fillStyle = theme.accent[0];
    ctx.fillText(label, x + 12, rowY + 12);
    const labelWidth = ctx.measureText(label).width;

    if (command.aliases?.length) {
      const aliasText = `· ${command.aliases.map((alias) => prefix + alias).join(' ')}`;
      ctx.font = font(12);
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(
        truncateText(ctx, aliasText, COLUMN_WIDTH - labelWidth - 40),
        x + 18 + labelWidth,
        rowY + 12,
      );
    }

    ctx.font = font(13);
    ctx.fillStyle = theme.textMuted;
    ctx.fillText(truncateText(ctx, command.description, COLUMN_WIDTH - 24), x + 12, rowY + 28);
  });
}

function drawFooter(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  data: HelpCardData,
  height: number,
): void {
  const bar: Rect = {
    x: PADDING,
    y: height - FOOTER_HEIGHT + 4,
    width: WIDTH - PADDING * 2,
    height: FOOTER_HEIGHT - 20,
  };

  fillRoundedRect(ctx, bar, 12, theme.surface);
  strokeRoundedRect(ctx, bar, 12, theme.surfaceBorder, 1);

  ctx.font = font(14);
  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `Prefix for this server: ${data.prefix}   ·   DJ-only commands need the DJ role`,
    WIDTH / 2,
    bar.y + bar.height / 2,
  );
}

export const HELP_CARD_WIDTH = WIDTH;
