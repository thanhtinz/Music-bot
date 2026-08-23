import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';

import { loadArtwork } from '../artwork';
import { font, registerFonts } from '../fonts';
import {
  drawImageCover,
  formatDuration,
  truncateText,
  withRoundedClip,
  type Rect,
} from '../primitives';
import type { QueueCardData, QueueCardTrack } from './queue.card';

/**
 * Illustrated queue artwork this card composites onto.
 *
 * As with the Now Playing template, everything decorative — panel, stickers,
 * header controls and row chrome — lives in the image; only the per-row data is
 * repainted.
 */
const TEMPLATE_PATH = resolve(__dirname, '../../../../assets/templates/queue-sakura.png');

export const QUEUE_SAKURA_TEMPLATE_SIZE = { width: 1548, height: 1016 } as const;

/** The template draws exactly five rows. */
export const QUEUE_SAKURA_PAGE_SIZE = 5;

/**
 * Upcoming tracks per page.
 *
 * The current track keeps the highlighted first row on every page — it is what
 * that row means — so pagination moves through the other four.
 */
export const QUEUE_SAKURA_UPCOMING_PER_PAGE = 4;

export interface QueuePageSlice<T> {
  /** The items to render on this page. */
  items: T[];
  /** Clamped page number, 1-based. */
  page: number;
  totalPages: number;
  /** 1-based queue position of the first item on this page. */
  firstPosition: number;
}

/**
 * Slices upcoming tracks for one page of the illustrated card.
 *
 * Owning the arithmetic here keeps the button handler from having to redo the
 * off-by-one dance every time someone pages forward.
 */
export function paginateSakuraQueue<T>(
  items: readonly T[],
  page: number,
  perPage = QUEUE_SAKURA_UPCOMING_PER_PAGE,
): QueuePageSlice<T> {
  const size = Math.max(1, Math.floor(perPage));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (current - 1) * size;

  return {
    items: items.slice(start, start + size),
    page: current,
    totalPages,
    firstPosition: start + 1,
  };
}

interface RowGeometry {
  /** Cover art tile. */
  tile: Rect;
  titleBaseline: number;
  artistBaseline: number;
  durationBaseline: number;
  indexBaseline: number;
  /** Widest the title and artist may be before hitting a sticker or the duration. */
  textMaxWidth: number;
  /** Vertical band to clear when the row is unused. */
  top: number;
  bottom: number;
}

/**
 * Row coordinates measured from the template at its native 1548×1016 size.
 *
 * Row 1 is the highlighted "now playing" row: taller, with a bigger tile and a
 * pink duration. Replacing the template means re-measuring all of this.
 */
const ROWS: readonly RowGeometry[] = [
  {
    tile: { x: 182, y: 169, width: 137, height: 134 },
    titleBaseline: 230,
    artistBaseline: 267,
    durationBaseline: 249,
    indexBaseline: 245,
    // Stops short of the music-note sticker sitting inside this row.
    textMaxWidth: 560,
    top: 151,
    bottom: 320,
  },
  {
    tile: { x: 182, y: 330, width: 137, height: 117 },
    titleBaseline: 383,
    artistBaseline: 419,
    durationBaseline: 398,
    indexBaseline: 397,
    textMaxWidth: 880,
    top: 324,
    bottom: 456,
  },
  {
    tile: { x: 182, y: 465, width: 137, height: 117 },
    titleBaseline: 518,
    artistBaseline: 556,
    durationBaseline: 533,
    indexBaseline: 532,
    textMaxWidth: 880,
    top: 458,
    bottom: 591,
  },
  {
    tile: { x: 182, y: 600, width: 137, height: 117 },
    titleBaseline: 653,
    artistBaseline: 689,
    durationBaseline: 668,
    indexBaseline: 667,
    textMaxWidth: 880,
    top: 592,
    bottom: 725,
  },
  {
    tile: { x: 182, y: 734, width: 137, height: 117 },
    titleBaseline: 786,
    artistBaseline: 822,
    durationBaseline: 803,
    indexBaseline: 800,
    textMaxWidth: 880,
    top: 726,
    bottom: 856,
  },
];

const TEXT_X = 360;
const DURATION_RIGHT = 1345;
const INDEX_CENTER = 112;
const TILE_RADIUS = 16;

/** Header count, e.g. the `(5)` in `QUEUE (5)`. */
const COUNT = { x: 283, baseline: 116, clear: { x: 276, y: 80, width: 90, height: 46 } };

/**
 * Page indicator, drawn in the empty stretch of header between the count and
 * the sticker. Only appears once there is more than one page.
 */
const PAGE_LABEL = { x: 372, baseline: 116 };
const PAGE_INK = '#9b8388';

const TITLE_INK = '#111011';
const ARTIST_INK = '#635456';
const DURATION_INK = '#5f585a';
const DURATION_INK_CURRENT = '#ec5f80';
const INDEX_INK = '#8f5f66';
const COUNT_INK = '#ef6f93';

/** Points known to be plain background, used to sample patch colours. */
const SAMPLE = {
  currentRow: { x: 1200, y: 300 },
  plainRow: { x: 1200, y: 480 },
  header: { x: 400, y: 100 },
} as const;

let templateCache: Image | undefined;

async function loadTemplate(): Promise<Image> {
  if (templateCache) return templateCache;

  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `Sakura queue template missing at ${TEMPLATE_PATH}. ` +
        'Restore assets/templates/queue-sakura.png or use the classic variant.',
    );
  }

  templateCache = await loadImage(TEMPLATE_PATH);
  return templateCache;
}

/** A row as the renderer sees it: either the current track or a queued one. */
interface RenderRow {
  track: QueueCardTrack;
  isCurrent: boolean;
  artworkUrl?: string;
}

/**
 * Renders the queue onto the illustrated pastel template.
 *
 * The template has five rows, the first styled as "now playing". Fewer tracks
 * clear the rows they would have used, so a short queue does not leave the
 * template's placeholder rows showing.
 */
export async function renderSakuraQueueCard(data: QueueCardData): Promise<Buffer> {
  registerFonts();

  const template = await loadTemplate();
  const canvas = createCanvas(QUEUE_SAKURA_TEMPLATE_SIZE.width, QUEUE_SAKURA_TEMPLATE_SIZE.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(
    template,
    0,
    0,
    QUEUE_SAKURA_TEMPLATE_SIZE.width,
    QUEUE_SAKURA_TEMPLATE_SIZE.height,
  );

  const rows = buildRows(data);

  drawHeaderCount(ctx, data, rows.length);
  clearUnusedRows(ctx, rows.length);

  for (const [index, row] of rows.entries()) {
    const geometry = ROWS[index];
    if (!geometry) break;
    await drawRow(ctx, geometry, row, index === 0);
  }

  return canvas.toBuffer('image/png');
}

/** Current track first, then upcoming tracks, capped at the template's rows. */
function buildRows(data: QueueCardData): RenderRow[] {
  const rows: RenderRow[] = [];

  if (data.current) {
    rows.push({
      isCurrent: true,
      artworkUrl: data.current.artworkUrl,
      track: {
        position: 1,
        title: data.current.title,
        author: data.current.author,
        durationMs: data.current.durationMs,
        isStream: data.current.isStream,
        requesterName: '',
      },
    });
  }

  for (const track of data.tracks) {
    if (rows.length >= QUEUE_SAKURA_PAGE_SIZE) break;
    rows.push({ track, isCurrent: false });
  }

  return rows;
}

/**
 * Paints over a region with a colour sampled from the template itself.
 *
 * Sampling keeps the patch invisible against the illustrated ground, which is
 * subtly uneven and differs between the highlighted row and the plain ones.
 */
function cover(ctx: SKRSContext2D, rect: Rect, sampleAt: { x: number; y: number }): void {
  const { data: pixel } = ctx.getImageData(sampleAt.x, sampleAt.y, 1, 1);
  ctx.fillStyle = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawHeaderCount(ctx: SKRSContext2D, data: QueueCardData, visibleRows: number): void {
  // The header counts everything queued, not just what fits on this page.
  const total = (data.current ? 1 : 0) + Math.max(0, data.totalTracks);
  const label = `(${total || visibleRows})`;

  cover(ctx, COUNT.clear, SAMPLE.header);

  ctx.font = font(34, 'bold');
  ctx.fillStyle = COUNT_INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, COUNT.x, COUNT.baseline);

  // Without this, paging through a long queue gives no clue where you are.
  const totalPages = Math.max(1, Math.floor(data.totalPages) || 1);
  if (totalPages > 1) {
    const page = Math.min(Math.max(1, Math.floor(data.page) || 1), totalPages);
    ctx.font = font(26, 'bold');
    ctx.fillStyle = PAGE_INK;
    ctx.fillText(`Page ${page}/${totalPages}`, PAGE_LABEL.x, PAGE_LABEL.baseline);
  }
}

/** Clears the template rows this page does not fill. */
function clearUnusedRows(ctx: SKRSContext2D, used: number): void {
  if (used >= ROWS.length) return;

  const first = ROWS[used];
  const last = ROWS[ROWS.length - 1];
  if (!first || !last) return;

  // Sampled from a plain row, never the highlighted one: when the queue is
  // empty that pink row is itself being cleared, so its colour must not spread.
  cover(
    ctx,
    { x: 40, y: first.top, width: 1470, height: last.bottom - first.top },
    SAMPLE.plainRow,
  );
}

async function drawRow(
  ctx: SKRSContext2D,
  geometry: RowGeometry,
  row: RenderRow,
  isFirstRow: boolean,
): Promise<void> {
  const sample = isFirstRow ? SAMPLE.currentRow : SAMPLE.plainRow;

  const artwork = await loadArtwork(row.artworkUrl, `${row.track.title} ${row.track.author}`);
  withRoundedClip(ctx, geometry.tile, TILE_RADIUS, () =>
    drawImageCover(ctx, artwork, geometry.tile),
  );

  // The clear bands run past each baseline far enough to take the descenders of
  // the template's own text with them; stopping at the baseline leaves the tail
  // of a `g` behind.
  cover(
    ctx,
    {
      x: TEXT_X - 8,
      y: geometry.titleBaseline - 30,
      width: geometry.textMaxWidth + 16,
      height: 44,
    },
    sample,
  );
  cover(
    ctx,
    {
      x: TEXT_X - 8,
      y: geometry.artistBaseline - 22,
      width: geometry.textMaxWidth + 16,
      height: 34,
    },
    sample,
  );

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(isFirstRow ? 31 : 29, 'bold');
  ctx.fillStyle = TITLE_INK;
  ctx.fillText(
    truncateText(ctx, row.track.title || 'Unknown title', geometry.textMaxWidth),
    TEXT_X,
    geometry.titleBaseline,
  );

  ctx.font = font(22);
  ctx.fillStyle = ARTIST_INK;
  ctx.fillText(
    truncateText(ctx, row.track.author || 'Unknown artist', geometry.textMaxWidth),
    TEXT_X,
    geometry.artistBaseline,
  );

  drawDuration(ctx, geometry, row, sample);
  if (!isFirstRow) drawIndex(ctx, geometry, row, sample);
}

function drawDuration(
  ctx: SKRSContext2D,
  geometry: RowGeometry,
  row: RenderRow,
  sample: { x: number; y: number },
): void {
  cover(ctx, { x: 1250, y: geometry.durationBaseline - 30, width: 112, height: 38 }, sample);

  ctx.font = font(30, 'bold');
  ctx.fillStyle = row.isCurrent ? DURATION_INK_CURRENT : DURATION_INK;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    row.track.isStream ? 'LIVE' : formatClock(row.track.durationMs),
    DURATION_RIGHT,
    geometry.durationBaseline,
  );
}

/**
 * Repaints the row number.
 *
 * The template has 2–5 baked in, which is only correct on the first page, so
 * the real queue position is always drawn.
 */
function drawIndex(
  ctx: SKRSContext2D,
  geometry: RowGeometry,
  row: RenderRow,
  sample: { x: number; y: number },
): void {
  cover(ctx, { x: 82, y: geometry.indexBaseline - 28, width: 62, height: 36 }, sample);

  ctx.font = font(29, 'bold');
  ctx.fillStyle = INDEX_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(Math.max(1, row.track.position)), INDEX_CENTER, geometry.indexBaseline);
}

/** Zero-padded `mm:ss`, matching the timestamps drawn into the template. */
function formatClock(ms: number): string {
  const formatted = formatDuration(ms);
  return /^\d:/.test(formatted) ? `0${formatted}` : formatted;
}
