import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import { font, registerFonts } from '../fonts';
import { drawGlyph, glyphFor, type GlyphName } from '../glyphs';
import { drawMascot } from '../mascot';
import { fillRoundedRect, strokeRoundedRect, truncateText, type Rect } from '../primitives';
import { drawMusicNote, drawSparkle, drawStar, SAKURA_STICKER_COLORS } from '../stickers';

/**
 * How loudly a notice should read.
 *
 * Only the accent colour and the default icon change: a warning that redesigned
 * the whole card would stop looking like it came from the same bot.
 */
export type NoticeTone = 'success' | 'info' | 'warning' | 'error';

export interface NoticeCardData {
  /** Headline, e.g. `Volume`. Falls back to the tone's own word. */
  title?: string;
  /** The sentence itself. `**bold**` and `` `code` `` are drawn in the accent colour. */
  message: string;
  /** Glyph key; anything {@link glyphFor} understands. */
  icon?: string;
  tone?: NoticeTone;
  /** Small line under the message, e.g. a hint at the next command. */
  footnote?: string;
}

const WIDTH = 1200;
const HEIGHT = 420;

export const NOTICE_SAKURA_SIZE = { width: WIDTH, height: HEIGHT } as const;

const PANEL: Rect = { x: 24, y: 22, width: WIDTH - 48, height: HEIGHT - 44 };
const ICON: Rect = { x: 76, y: 148, width: 108, height: 108 };
const TEXT_X = 224;
const TITLE_BASELINE = 176;
const MESSAGE_TOP = 208;
const MESSAGE_LINE_HEIGHT = 44;
/** Two lines is what fits above the footnote without crowding the mascot. */
const MESSAGE_MAX_LINES = 2;
const FOOTNOTE_BASELINE = 336;
/** Text stops here so it cannot run under the mascot. */
const TEXT_MAX_WIDTH = 626;

const COLORS = {
  backdrop: '#fdf3f1',
  panel: '#fef6f6',
  panelBorder: '#f8dbe4',
  ink: '#151215',
  inkSoft: '#6b5b60',
  inkMuted: '#9c8990',
} as const;

/** Accent and default icon per tone. */
const TONES: Record<NoticeTone, { accent: string; soft: string; icon: GlyphName; title: string }> =
  {
    success: { accent: '#ec5d84', soft: '#fbe0e9', icon: 'note', title: 'Done' },
    info: { accent: '#7c6cf0', soft: '#e7e3fd', icon: 'info', title: 'Heads up' },
    warning: { accent: '#e08b2f', soft: '#fdeed6', icon: 'info', title: 'Hold on' },
    error: { accent: '#e0455f', soft: '#fbdde2', icon: 'info', title: 'That did not work' },
  };

/**
 * A single-message panel in the same pastel style as the other cards.
 *
 * Every command that used to answer with a line of text answers with one of
 * these, so a reply looks like it came from the same place as the Now Playing
 * and queue panels rather than from a different bot.
 */
export async function renderSakuraNoticeCard(data: NoticeCardData): Promise<Buffer> {
  registerFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const tone = TONES[data.tone ?? 'success'];

  drawBackground(ctx);
  drawStickers(ctx);
  drawIcon(ctx, data, tone);
  drawText(ctx, data, tone);

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1030, bottomY: 388, height: 272 });

  return canvas.toBuffer('image/png');
}

function drawBackground(ctx: SKRSContext2D): void {
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  fillRoundedRect(ctx, PANEL, 32, COLORS.panel);
  strokeRoundedRect(ctx, PANEL, 32, COLORS.panelBorder, 2);
}

function drawStickers(ctx: SKRSContext2D): void {
  const colors = SAKURA_STICKER_COLORS;

  drawMusicNote(ctx, 862, 108, 40, colors.pink, true);
  drawStar(ctx, 806, 74, 26, colors.yellow, '#eab54f');
  drawSparkle(ctx, 916, 62, 16, colors.pinkSoft);
  drawSparkle(ctx, 92, 92, 18, colors.pinkSoft);
  drawStar(ctx, 148, 350, 22, colors.yellow, '#eab54f');
  drawSparkle(ctx, 96, 322, 14, colors.pinkSoft);
}

function drawIcon(
  ctx: SKRSContext2D,
  data: NoticeCardData,
  tone: (typeof TONES)[NoticeTone],
): void {
  fillRoundedRect(ctx, ICON, 28, tone.soft);

  const inset = 30;
  drawGlyph(
    ctx,
    data.icon ? glyphFor(data.icon) : tone.icon,
    {
      x: ICON.x + inset,
      y: ICON.y + inset,
      width: ICON.width - inset * 2,
      height: ICON.height - inset * 2,
    },
    tone.accent,
    4,
  );
}

function drawText(
  ctx: SKRSContext2D,
  data: NoticeCardData,
  tone: (typeof TONES)[NoticeTone],
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(40, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(truncateText(ctx, data.title ?? tone.title, TEXT_MAX_WIDTH), TEXT_X, TITLE_BASELINE);

  ctx.font = font(30);
  drawMessage(ctx, data.message, tone.accent);

  if (data.footnote) {
    ctx.font = font(22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, data.footnote, TEXT_MAX_WIDTH), TEXT_X, FOOTNOTE_BASELINE);
  }
}

export interface MessageWord {
  text: string;
  emphasis: boolean;
  /** Whether a space separated this word from the one before it. */
  spaced: boolean;
}

/**
 * Splits Discord's inline markup into words.
 *
 * The messages were written for a chat client, where the important words are
 * already marked up. Rather than rewrite every one of them, the markup is read
 * and those words are drawn in the accent colour — and the markers themselves
 * are dropped, because on an image `**loud**` is just asterisks.
 */
export function parseNoticeMessage(message: string): MessageWord[] {
  const words: MessageWord[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let index = 0;

  // `spaced` is tracked rather than assumed, because emphasis often ends
  // mid-sentence — `**85%**.` must not come out as `85% .`
  let pendingSpace = false;

  const push = (text: string, emphasis: boolean) => {
    if (!text) return;

    const leading = /^\s/.test(text);
    const parts = text.split(/\s+/).filter(Boolean);

    parts.forEach((word, index) => {
      words.push({ text: word, emphasis, spaced: index > 0 || leading || pendingSpace });
      pendingSpace = false;
    });

    if (parts.length > 0) pendingSpace = /\s$/.test(text);
  };

  for (let match = pattern.exec(message); match; match = pattern.exec(message)) {
    push(message.slice(index, match.index), false);
    push(match[1] ?? match[2] ?? '', true);
    index = match.index + match[0].length;
  }

  push(message.slice(index), false);
  return words;
}

/**
 * Lays the message out word by word.
 *
 * Wrapping the plain text and then trying to colour it after the fact loses
 * track of where a bold run sits once a line breaks inside it; laying out the
 * words themselves keeps each one's colour attached to it.
 */
function drawMessage(ctx: SKRSContext2D, message: string, accent: string): void {
  const words = parseNoticeMessage(message);
  const spaceWidth = ctx.measureText(' ').width;

  let line = 0;
  let x = TEXT_X;

  for (const word of words) {
    if (line >= MESSAGE_MAX_LINES) return;

    const width = ctx.measureText(word.text).width;
    const atLineStart = x === TEXT_X;
    // A word that follows punctuation with no space between them stays glued
    // to it, and so is never a place to break the line.
    const gap = atLineStart || !word.spaced ? 0 : spaceWidth;

    if (word.spaced && !atLineStart && x + gap + width > TEXT_X + TEXT_MAX_WIDTH) {
      line += 1;
      x = TEXT_X;
      if (line >= MESSAGE_MAX_LINES) return;
    }

    const baseline = MESSAGE_TOP + line * MESSAGE_LINE_HEIGHT + 30;
    const text =
      x === TEXT_X && width > TEXT_MAX_WIDTH
        ? truncateText(ctx, word.text, TEXT_MAX_WIDTH)
        : word.text;

    if (x !== TEXT_X && word.spaced) x += spaceWidth;
    ctx.fillStyle = word.emphasis ? accent : COLORS.inkSoft;
    ctx.fillText(text, x, baseline);
    x += ctx.measureText(text).width;
  }
}
