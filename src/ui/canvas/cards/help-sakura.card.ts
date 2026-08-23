import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph, glyphFor } from '../glyphs';
import { drawMascot } from '../mascot';
import { fillRoundedRect, truncateText, type Rect } from '../primitives';

/**
 * Illustrated command-list artwork this card composites onto.
 *
 * The panels, search field and stickers live in the image; the sidebar entries
 * and command rows are repainted from the real catalog.
 */
const TEMPLATE_PATH = resolve(__dirname, '../../../../assets/templates/help-sakura.png');

export const HELP_SAKURA_TEMPLATE_SIZE = { width: 1536, height: 1024 } as const;

/** Sidebar slots and command rows the template provides. */
export const HELP_SAKURA_CATEGORY_SLOTS = 9;
export const HELP_SAKURA_PAGE_SIZE = 8;

export interface HelpSakuraCommand {
  /** Command name without the prefix, e.g. `play`. */
  name: string;
  /** Argument hint shown after the name, e.g. `<song>`. */
  args?: string;
  description: string;
  /** Usage example shown in the right-hand pill; defaults to the command name. */
  usage?: string;
}

export interface HelpSakuraCategory {
  /** Sidebar label, e.g. `Music`. */
  title: string;
  /** Total commands in the category, shown as the sidebar count. */
  count: number;
  /** Glyph key; defaults to the title. */
  icon?: string;
}

export interface HelpSakuraCardData {
  categories: HelpSakuraCategory[];
  /** Index into `categories` that this page is showing. */
  activeCategory: number;
  /** Commands of the active category, already sliced to a page. */
  commands: HelpSakuraCommand[];
  /** Guild prefix, shown in the header and in every usage example. */
  prefix: string;
}

// ── Geometry, measured from the template at its native 1536×1024 size ────────

const SIDEBAR = {
  pill: { x: 62, width: 278, height: 66 },
  firstPillY: 196,
  slotSpacing: 72.7,
  firstBaseline: 238,
  labelX: 138,
  countRight: 302,
  iconOffsetY: 16,
  iconSize: 34,
  clear: { x: 56, width: 292, height: 72 },
  pillRadius: 20,
} as const;

const ROW = {
  firstBaseline: 311,
  spacing: 78.3,
  tile: { x: 390, size: 54, radius: 14 },
  nameX: 463,
  descriptionX: 753,
  usageRight: 1445,
  usageHeight: 44,
  usageRadius: 22,
  clear: { x: 380, width: 1078, height: 60, offsetY: -38 },
} as const;

const HEADER_PREFIX = { x: 152, baseline: 132, clear: { x: 148, y: 100, width: 250, height: 44 } };
const FOOTER = { x: 404, baseline: 944, clear: { x: 398, y: 912, width: 400, height: 44 } };

const INK = '#0d0b0c';
const INK_LABEL = '#3a2f33';
const INK_DESCRIPTION = '#4a3a43';
const INK_COUNT = '#4f3b40';
const PINK = '#ec5d84';
const PINK_STRONG = '#f2406e';
const PILL_ACTIVE = '#fe759e';
const TILE_FILL = '#fee5e4';
const USAGE_FILL = '#feeef1';
const ON_PINK = '#ffffff';

/** Points known to be plain background, used to sample patch colours. */
const SAMPLE = {
  sidebar: { x: 50, y: 500 },
  header: { x: 700, y: 120 },
  footer: { x: 1000, y: 935 },
} as const;

let templateCache: Image | undefined;

async function loadTemplate(): Promise<Image> {
  if (templateCache) return templateCache;

  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `Sakura help template missing at ${TEMPLATE_PATH}. ` +
        'Restore assets/templates/help-sakura.png or use the classic variant.',
    );
  }

  templateCache = await loadImage(TEMPLATE_PATH);
  return templateCache;
}

/**
 * Renders the command list onto the illustrated pastel template.
 *
 * Sidebar entries, the active highlight, and every command row are drawn from
 * the supplied catalog — including the row icons, so a row never inherits an
 * unrelated glyph from the artwork.
 */
export async function renderSakuraHelpCard(data: HelpSakuraCardData): Promise<Buffer> {
  registerFonts();

  const template = await loadTemplate();
  const canvas = createCanvas(HELP_SAKURA_TEMPLATE_SIZE.width, HELP_SAKURA_TEMPLATE_SIZE.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0, HELP_SAKURA_TEMPLATE_SIZE.width, HELP_SAKURA_TEMPLATE_SIZE.height);

  drawPrefix(ctx, data);
  drawSidebar(ctx, data);
  drawRows(ctx, data);
  drawFooter(ctx, data);

  // Bottom-right, in the footer band beside the hint. The artwork's own
  // character used to sit here and has been removed from the template, so the
  // mascot simply takes the space rather than covering anything. Drawn last, as
  // on every card, because the final command row reaches into this corner.
  await drawMascot(ctx, { centerX: 1402, bottomY: 994, height: 132 });

  return canvas.toBuffer('image/png');
}

/** Paints over a region with a colour sampled from the template itself. */
function cover(ctx: SKRSContext2D, rect: Rect, sampleAt: { x: number; y: number }): void {
  const { data: pixel } = ctx.getImageData(sampleAt.x, sampleAt.y, 1, 1);
  ctx.fillStyle = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawPrefix(ctx: SKRSContext2D, data: HelpSakuraCardData): void {
  cover(ctx, HEADER_PREFIX.clear, SAMPLE.header);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(26, 'bold');
  ctx.fillStyle = INK_LABEL;
  const label = 'Prefix: ';
  ctx.fillText(label, HEADER_PREFIX.x, HEADER_PREFIX.baseline);

  ctx.fillStyle = PINK_STRONG;
  ctx.fillText(data.prefix, HEADER_PREFIX.x + ctx.measureText(label).width, HEADER_PREFIX.baseline);
}

function slotPill(index: number): Rect {
  return {
    x: SIDEBAR.pill.x,
    y: SIDEBAR.firstPillY + index * SIDEBAR.slotSpacing,
    width: SIDEBAR.pill.width,
    height: SIDEBAR.pill.height,
  };
}

function drawSidebar(ctx: SKRSContext2D, data: HelpSakuraCardData): void {
  const slots = Math.min(data.categories.length, HELP_SAKURA_CATEGORY_SLOTS);

  // Every slot is cleared first, including the template's own highlight: the
  // active category is rarely the one the artwork happens to highlight.
  for (let index = 0; index < HELP_SAKURA_CATEGORY_SLOTS; index += 1) {
    const pill = slotPill(index);
    cover(
      ctx,
      {
        x: SIDEBAR.clear.x,
        y: pill.y - 3,
        width: SIDEBAR.clear.width,
        height: SIDEBAR.clear.height,
      },
      SAMPLE.sidebar,
    );
  }

  for (let index = 0; index < slots; index += 1) {
    const category = data.categories[index];
    if (!category) continue;

    const pill = slotPill(index);
    const baseline = SIDEBAR.firstBaseline + index * SIDEBAR.slotSpacing;
    const active = index === data.activeCategory;

    if (active) fillRoundedRect(ctx, pill, SIDEBAR.pillRadius, PILL_ACTIVE);

    const ink = active ? ON_PINK : INK_LABEL;
    drawGlyph(
      ctx,
      glyphFor(category.icon ?? category.title),
      {
        x: pill.x + 20,
        y: pill.y + SIDEBAR.iconOffsetY,
        width: SIDEBAR.iconSize,
        height: SIDEBAR.iconSize,
      },
      ink,
      2.6,
    );

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(26, active ? 'bold' : 'regular');
    ctx.fillStyle = ink;
    ctx.fillText(truncateText(ctx, category.title, 132), SIDEBAR.labelX, baseline);

    ctx.textAlign = 'right';
    ctx.font = font(24, 'bold');
    ctx.fillStyle = active ? ON_PINK : INK_COUNT;
    ctx.fillText(String(Math.max(0, category.count)), SIDEBAR.countRight, baseline);
  }
}

function drawRows(ctx: SKRSContext2D, data: HelpSakuraCardData): void {
  const commands = data.commands.slice(0, HELP_SAKURA_PAGE_SIZE);

  for (let index = 0; index < HELP_SAKURA_PAGE_SIZE; index += 1) {
    const baseline = ROW.firstBaseline + index * ROW.spacing;
    const command = commands[index];

    // Sampling inside the row itself keeps alternating row tints intact.
    const sample = { x: 1465, y: Math.round(baseline - 10) };
    cover(
      ctx,
      {
        x: ROW.clear.x,
        y: baseline + ROW.clear.offsetY,
        width: ROW.clear.width,
        height: ROW.clear.height,
      },
      sample,
    );

    if (!command) continue;
    drawRow(ctx, command, baseline, data.prefix);
  }
}

function drawRow(
  ctx: SKRSContext2D,
  command: HelpSakuraCommand,
  baseline: number,
  prefix: string,
): void {
  const tile: Rect = {
    x: ROW.tile.x,
    y: baseline - 33,
    width: ROW.tile.size,
    height: ROW.tile.size,
  };
  fillRoundedRect(ctx, tile, ROW.tile.radius, TILE_FILL);
  drawGlyph(
    ctx,
    glyphFor(command.name),
    { x: tile.x + 13, y: tile.y + 13, width: 28, height: 28 },
    PINK,
    2.8,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(27, 'bold');
  ctx.fillStyle = INK;
  const name = `${prefix}${command.name}`;
  ctx.fillText(name, ROW.nameX, baseline);

  if (command.args) {
    const nameWidth = ctx.measureText(name).width;
    ctx.font = font(24, 'bold');
    ctx.fillStyle = PINK;
    ctx.fillText(command.args, ROW.nameX + nameWidth + 14, baseline);
  }

  // The usage pill is sized first: the description gets whatever space is left,
  // so a long example shortens the description instead of colliding with it.
  const pill = drawUsagePill(ctx, command, baseline, prefix);

  // The pill centres its own text; restore left/alphabetic before continuing.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(23);
  ctx.fillStyle = INK_DESCRIPTION;
  ctx.fillText(
    truncateText(ctx, command.description, pill.x - 24 - ROW.descriptionX),
    ROW.descriptionX,
    baseline,
  );
}

/** Draws the right-hand usage pill and returns the rect it occupies. */
function drawUsagePill(
  ctx: SKRSContext2D,
  command: HelpSakuraCommand,
  baseline: number,
  prefix: string,
): Rect {
  const text = `${prefix}${command.usage ?? command.name}`;

  ctx.font = font(22, 'bold');
  // Wide enough for the template's longest example, still clear of the
  // description column.
  const width = Math.min(ctx.measureText(text).width + 44, 340);
  const rect: Rect = {
    x: ROW.usageRight - width,
    y: baseline - 33,
    width,
    height: ROW.usageHeight,
  };

  fillRoundedRect(ctx, rect, ROW.usageRadius, USAGE_FILL);

  ctx.fillStyle = PINK_STRONG;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    truncateText(ctx, text, rect.width - 24),
    rect.x + rect.width / 2,
    rect.y + rect.height / 2 + 1,
  );

  return rect;
}

function drawFooter(ctx: SKRSContext2D, data: HelpSakuraCardData): void {
  cover(ctx, FOOTER.clear, SAMPLE.footer);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(24);
  ctx.fillStyle = INK_LABEL;
  const lead = 'Use ';
  ctx.fillText(lead, FOOTER.x, FOOTER.baseline);
  let cursor = FOOTER.x + ctx.measureText(lead).width;

  ctx.font = font(24, 'bold');
  ctx.fillStyle = PINK_STRONG;
  const command = `${data.prefix}help [command]`;
  ctx.fillText(command, cursor, FOOTER.baseline);
  cursor += ctx.measureText(command).width;

  ctx.font = font(24);
  ctx.fillStyle = INK_LABEL;
  ctx.fillText(' for more details', cursor, FOOTER.baseline);
}
