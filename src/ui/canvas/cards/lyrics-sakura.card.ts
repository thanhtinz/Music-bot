import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import type { TimedLyricLine } from '../../../lyrics/lyrics-provider';

import { font, registerFonts } from '../fonts';
import { drawGlyph } from '../glyphs';
import { drawMascot } from '../mascot';
import { fillRoundedRect, strokeRoundedRect, truncateText, type Rect } from '../primitives';
import { drawMusicNote, drawSparkle, drawStar, SAKURA_STICKER_COLORS } from '../stickers';
import { encodeCard } from '../encode';

export interface LyricsCardData {
  title: string;
  artist?: string;
  /** Lines for this page, already paginated. */
  lines: string[];
  page?: number;
  totalPages?: number;
  /** Credited on the card, because the words are somebody else's work. */
  provider?: string;
  /**
   * Which line of this page is being sung, as an index into `lines`.
   *
   * Left out when the transcript has no timings, when the song is not the one
   * on the card, or when the reader has paged away from where the music is.
   */
  activeLine?: number;
}

/** A wrapped line, carrying the moment it is sung when there is one. */
export interface LyricsPageLine {
  text: string;
  atMs?: number;
}

const WIDTH = 1200;
const HEIGHT = 900;

export const LYRICS_SAKURA_SIZE = { width: WIDTH, height: HEIGHT } as const;

/** Lines per page — what fits in the body without crowding the mascot. */
export const LYRICS_SAKURA_PAGE_SIZE = 18;

const PANEL: Rect = { x: 24, y: 22, width: WIDTH - 48, height: HEIGHT - 44 };
const BODY = { x: 74, firstBaseline: 216, lineHeight: 34, maxWidth: 860 } as const;

const COLORS = {
  backdrop: '#fdf3f1',
  panel: '#fef6f6',
  panelBorder: '#f8dbe4',
  ink: '#151215',
  inkSoft: '#4c4147',
  inkMuted: '#9c8990',
  pink: '#ec5d84',
  pinkStrong: '#f2406e',
  pinkSoft: '#fbe0e9',
} as const;

/**
 * One page of lyrics.
 *
 * The words are the whole point, so they get the width; the mascot sits in the
 * footer rather than beside them, where it would cost a third of every line.
 */
export async function renderSakuraLyricsCard(data: LyricsCardData): Promise<Buffer> {
  registerFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawStickers(ctx);
  drawHeader(ctx, data);
  drawLines(ctx, data);
  drawFooter(ctx, data);

  // Drawn last, as on every card, so nothing can clip it.
  await drawMascot(ctx, { centerX: 1074, bottomY: 866, height: 128 });

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

  drawMusicNote(ctx, 1044, 92, 40, colors.pink, true);
  drawStar(ctx, 986, 66, 24, colors.yellow, '#eab54f');
  drawSparkle(ctx, 1100, 62, 16, colors.pinkSoft);
  drawSparkle(ctx, 92, 842, 15, colors.pinkSoft);
}

function drawHeader(ctx: SKRSContext2D, data: LyricsCardData): void {
  const iconBox: Rect = { x: 66, y: 56, width: 56, height: 56 };
  fillRoundedRect(ctx, iconBox, 16, COLORS.pinkSoft);
  drawGlyph(
    ctx,
    'note',
    { x: iconBox.x + 14, y: iconBox.y + 14, width: 28, height: 28 },
    COLORS.pinkStrong,
    3,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(34, 'bold');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(truncateText(ctx, data.title || 'Unknown title', 700), 140, 92);

  if (data.artist) {
    ctx.font = font(22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncateText(ctx, data.artist, 700), 140, 124);
  }

  if (data.totalPages && data.totalPages > 1) {
    ctx.textAlign = 'right';
    ctx.font = font(22, 'bold');
    ctx.fillStyle = COLORS.pink;
    ctx.fillText(`${data.page ?? 1}/${data.totalPages}`, WIDTH - 74, 92);
    ctx.textAlign = 'left';
  }
}

function drawLines(ctx: SKRSContext2D, data: LyricsCardData): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  data.lines.slice(0, LYRICS_SAKURA_PAGE_SIZE).forEach((line, index) => {
    const baseline = BODY.firstBaseline + index * BODY.lineHeight;

    // A blank line is a verse break and is kept, because losing it runs the
    // whole song together.
    if (!line.trim()) return;

    const active = index === data.activeLine;
    ctx.font = font(24, active ? 'bold' : 'regular');
    const text = truncateText(ctx, line, BODY.maxWidth);

    if (active) {
      // A pill behind the words rather than colour alone: on a card this size
      // one pink line among seventeen grey ones is easy to miss, and the pill
      // is what the eye lands on before it reads anything.
      const width = ctx.measureText(text).width;
      fillRoundedRect(
        ctx,
        { x: BODY.x - 18, y: baseline - 26, width: width + 36, height: 38 },
        14,
        COLORS.pinkSoft,
      );
    }

    ctx.fillStyle = active ? COLORS.pinkStrong : COLORS.inkSoft;
    ctx.fillText(text, BODY.x, baseline);
  });
}

function drawFooter(ctx: SKRSContext2D, data: LyricsCardData): void {
  if (!data.provider) return;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(19);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(`Lyrics from ${data.provider}`, BODY.x, HEIGHT - 58);
}

/**
 * Splits lyrics into pages of drawable lines.
 *
 * Long lines are wrapped rather than truncated — a chorus that runs past the
 * card is still the chorus — and the wrap happens before paging so a page
 * always holds the number of lines it says it does.
 */
export function paginateLyrics(
  text: string,
  perPage = LYRICS_SAKURA_PAGE_SIZE,
): { pages: string[][]; totalPages: number } {
  const source = text.trim();
  if (!source) return { pages: [[]], totalPages: 1 };

  const { pages, totalPages } = pageOf(
    wrapLines(source.split('\n').map((line) => ({ text: line }))),
    perPage,
  );

  return { pages: pages.map((page) => page.map((line) => line.text)), totalPages };
}

/**
 * The same, for a transcript that carries its timings.
 *
 * A stamp belongs to the first fragment of the line it opened: wrapping splits
 * one sung line into two drawn ones, and the moment it starts is the moment the
 * first of them starts. The second fragment is left unstamped so that looking
 * up "the line being sung" can never land halfway through one.
 */
export function paginateSyncedLyrics(
  timings: readonly TimedLyricLine[],
  perPage = LYRICS_SAKURA_PAGE_SIZE,
): { pages: LyricsPageLine[][]; totalPages: number } {
  if (timings.length === 0) return { pages: [[]], totalPages: 1 };

  return pageOf(
    wrapLines(timings.map((entry) => ({ text: entry.line, atMs: entry.atMs }))),
    perPage,
  );
}

/**
 * Where in a paginated transcript a playback position falls.
 *
 * The last line whose moment has passed, rather than the next one coming up:
 * that is the line being sung. Before the first stamp — an intro, or a song
 * that has only just started — there is no answer, and the card opens on page
 * one with nothing lit up.
 *
 * A verse break carries a stamp of its own and is skipped: it draws nothing, so
 * choosing it would put the highlight on a blank row and read as the card
 * having lost the song. The last line actually sung stays lit through the gap.
 */
export function activeLyricLine(
  pages: readonly (readonly LyricsPageLine[])[],
  positionMs: number,
): { page: number; line: number } | undefined {
  let found: { page: number; line: number } | undefined;

  pages.forEach((page, pageIndex) => {
    page.forEach((line, lineIndex) => {
      if (line.atMs === undefined || line.atMs > positionMs) return;
      if (!line.text.trim()) return;
      found = { page: pageIndex + 1, line: lineIndex };
    });
  });

  return found;
}

/** Wraps lines to the body width, keeping a stamp on the first fragment. */
function wrapLines(source: readonly LyricsPageLine[]): LyricsPageLine[] {
  const measure = createCanvas(10, 10).getContext('2d');
  registerFonts();
  measure.font = font(24);

  const wrapped: LyricsPageLine[] = [];

  for (const entry of source) {
    const line = entry.text.trimEnd();
    const stamp = entry.atMs === undefined ? {} : { atMs: entry.atMs };

    if (!line.trim()) {
      wrapped.push({ text: '', ...stamp });
      continue;
    }

    let first = true;
    let current = '';
    const push = (text: string): void => {
      wrapped.push(first ? { text, ...stamp } : { text });
      first = false;
    };

    for (const word of line.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure.measureText(candidate).width > BODY.maxWidth) {
        push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) push(current);
  }

  return wrapped;
}

function pageOf(
  wrapped: readonly LyricsPageLine[],
  perPage: number,
): { pages: LyricsPageLine[][]; totalPages: number } {
  const size = Math.max(1, perPage);
  const pages: LyricsPageLine[][] = [];

  for (let index = 0; index < wrapped.length; index += size) {
    pages.push(wrapped.slice(index, index + size));
  }

  return { pages: pages.length > 0 ? pages : [[]], totalPages: Math.max(1, pages.length) };
}
