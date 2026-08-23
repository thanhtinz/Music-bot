import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';

import type { LoopMode } from '../../../domain/music/queue';
import { loadArtwork } from '../artwork';
import { font, registerFonts } from '../fonts';
import {
  clamp,
  drawImageCover,
  fillRoundedRect,
  formatDuration,
  linearGradient,
  strokeRoundedRect,
  truncateText,
  withRoundedClip,
  type Rect,
} from '../primitives';
import { resolveTheme, type CanvasTheme } from '../theme';

export interface QueueCardTrack {
  /** 1-based position as shown to the user. */
  position: number;
  title: string;
  author: string;
  durationMs: number;
  isStream?: boolean;
  requesterName: string;
}

export interface QueueCardData {
  /** The track playing right now, rendered above the list. */
  current?: {
    title: string;
    author: string;
    artworkUrl?: string;
    durationMs: number;
    positionMs: number;
    isStream?: boolean;
    paused?: boolean;
  };
  /** Tracks on the current page, already sliced by the caller. */
  tracks: QueueCardTrack[];
  page: number;
  totalPages: number;
  /** Total upcoming tracks across every page. */
  totalTracks: number;
  /** Total playtime of every upcoming track. */
  totalDurationMs: number;
  loop: LoopMode;
  theme?: string;
}

const WIDTH = 1000;
const SCALE = 2;
const PADDING = 40;

const HEADER_HEIGHT = 78;
const CURRENT_HEIGHT = 110;
const ROW_HEIGHT = 62;
const FOOTER_HEIGHT = 66;

/** Rows beyond this are the caller's job to paginate. */
export const QUEUE_PAGE_SIZE = 10;

const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Off',
  song: 'Track',
  queue: 'Queue',
};

/** Height the card will occupy for a given page — useful for layout tests. */
export function queueCardHeight(data: Pick<QueueCardData, 'tracks' | 'current'>): number {
  const rows = Math.min(data.tracks.length, QUEUE_PAGE_SIZE);
  const listHeight = rows > 0 ? rows * ROW_HEIGHT : ROW_HEIGHT;
  return HEADER_HEIGHT + (data.current ? CURRENT_HEIGHT : 0) + listHeight + FOOTER_HEIGHT + PADDING;
}

/**
 * Renders the queue as a PNG list.
 *
 * The card grows with the number of rows on the page, so a short queue does not
 * render as a mostly-empty image.
 */
export async function renderQueueCard(data: QueueCardData): Promise<Buffer> {
  registerFonts();

  const theme = resolveTheme(data.theme);
  const rows = data.tracks.slice(0, QUEUE_PAGE_SIZE);
  const height = queueCardHeight({ tracks: rows, current: data.current });

  const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const artwork = data.current
    ? await loadArtwork(data.current.artworkUrl, `${data.current.title} ${data.current.author}`)
    : undefined;

  drawBackground(ctx, theme, height, artwork);
  drawHeader(ctx, theme, data);

  let y = HEADER_HEIGHT;
  if (data.current) {
    drawCurrent(ctx, theme, data.current, artwork, y);
    y += CURRENT_HEIGHT;
  }

  drawRows(ctx, theme, rows, y);
  drawFooter(ctx, theme, data, height);

  return canvas.toBuffer('image/png');
}

function drawBackground(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  height: number,
  artwork: Image | undefined,
): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, WIDTH, height);

  if (artwork) {
    withRoundedClip(ctx, { x: 0, y: 0, width: WIDTH, height }, 0, () => {
      ctx.save();
      ctx.globalAlpha = theme.artworkBleed * 0.7;
      ctx.filter = 'blur(56px)';
      drawImageCover(ctx, artwork, { x: -80, y: -160, width: WIDTH + 160, height: height + 320 });
      ctx.restore();
    });
  }

  ctx.fillStyle = linearGradient(
    ctx,
    { x: 0, y: 0, width: WIDTH, height },
    ['rgba(6, 8, 12, 0.62)', 'rgba(6, 8, 12, 0.94)'],
    'vertical',
  );
  ctx.fillRect(0, 0, WIDTH, height);
}

function drawHeader(ctx: SKRSContext2D, theme: CanvasTheme, data: QueueCardData): void {
  const centerY = 40;

  // Accent bar standing in for an icon.
  fillRoundedRect(
    ctx,
    { x: PADDING, y: centerY - 12, width: 5, height: 24 },
    2.5,
    linearGradient(
      ctx,
      { x: PADDING, y: centerY - 12, width: 5, height: 24 },
      theme.accent,
      'vertical',
    ),
  );

  ctx.font = font(24, 'bold');
  ctx.fillStyle = theme.textPrimary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('QUEUE', PADDING + 18, centerY);

  const pageLabel = `Page ${clamp(data.page, 1, Math.max(1, data.totalPages))}/${Math.max(1, data.totalPages)}`;
  ctx.font = font(15, 'bold');
  const width = ctx.measureText(pageLabel).width + 26;
  const pill: Rect = { x: WIDTH - PADDING - width, y: centerY - 15, width, height: 30 };

  fillRoundedRect(ctx, pill, 15, theme.surface);
  strokeRoundedRect(ctx, pill, 15, theme.surfaceBorder, 1);
  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'center';
  ctx.fillText(pageLabel, pill.x + width / 2, centerY + 1);
}

function drawCurrent(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  current: NonNullable<QueueCardData['current']>,
  artwork: Image | undefined,
  top: number,
): void {
  const panel: Rect = {
    x: PADDING,
    y: top,
    width: WIDTH - PADDING * 2,
    height: CURRENT_HEIGHT - 14,
  };

  fillRoundedRect(ctx, panel, 16, theme.surface);
  strokeRoundedRect(ctx, panel, 16, theme.surfaceBorder, 1);

  const art: Rect = { x: panel.x + 14, y: panel.y + 14, width: 68, height: 68 };
  if (artwork) {
    withRoundedClip(ctx, art, 12, () => drawImageCover(ctx, artwork, art));
  } else {
    fillRoundedRect(ctx, art, 12, theme.accentTrack);
  }

  const textX = art.x + art.width + 16;
  const textWidth = panel.x + panel.width - textX - 120;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = font(13, 'bold');
  ctx.fillStyle = theme.textMuted;
  ctx.fillText(current.paused ? 'PAUSED' : 'NOW PLAYING', textX, panel.y + 16);

  ctx.font = font(20, 'bold');
  ctx.fillStyle = theme.textPrimary;
  ctx.fillText(truncateText(ctx, current.title, textWidth), textX, panel.y + 34);

  ctx.font = font(15);
  ctx.fillStyle = theme.textSecondary;
  ctx.fillText(truncateText(ctx, current.author, textWidth), textX, panel.y + 60);

  const time = current.isStream
    ? 'LIVE'
    : `${formatDuration(current.positionMs)} / ${formatDuration(current.durationMs)}`;
  ctx.font = font(15, 'bold');
  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'right';
  ctx.fillText(time, panel.x + panel.width - 16, panel.y + 34);

  // Slim progress bar pinned to the bottom edge of the panel.
  const barWidth = 96;
  const bar: Rect = {
    x: panel.x + panel.width - 16 - barWidth,
    y: panel.y + 64,
    width: barWidth,
    height: 6,
  };
  fillRoundedRect(ctx, bar, 3, theme.accentTrack);

  const ratio = current.isStream
    ? 1
    : clamp(current.durationMs > 0 ? current.positionMs / current.durationMs : 0, 0, 1);
  fillRoundedRect(
    ctx,
    { ...bar, width: Math.max(6, barWidth * ratio) },
    3,
    linearGradient(ctx, bar, theme.accent),
  );
}

function drawRows(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  rows: QueueCardTrack[],
  top: number,
): void {
  if (rows.length === 0) {
    ctx.font = font(17);
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      'The queue is empty — add a track to get started.',
      WIDTH / 2,
      top + ROW_HEIGHT / 2,
    );
    return;
  }

  rows.forEach((row, index) => {
    const y = top + index * ROW_HEIGHT;
    const rect: Rect = { x: PADDING, y, width: WIDTH - PADDING * 2, height: ROW_HEIGHT - 8 };

    // Zebra striping keeps long lists readable without drawing full borders.
    if (index % 2 === 0) fillRoundedRect(ctx, rect, 12, 'rgba(255, 255, 255, 0.035)');

    drawPositionBadge(ctx, theme, row.position, rect);

    const durationText = row.isStream ? 'LIVE' : formatDuration(row.durationMs);
    ctx.font = font(15, 'bold');
    const durationWidth = ctx.measureText(durationText).width;

    const textX = rect.x + 62;
    const textWidth = rect.width - 62 - durationWidth - 32;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = font(18, 'bold');
    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(truncateText(ctx, row.title, textWidth), textX, y + 25);

    ctx.font = font(14);
    ctx.fillStyle = theme.textMuted;
    const subtitle = `${row.author}  ·  ${row.requesterName}`;
    ctx.fillText(truncateText(ctx, subtitle, textWidth), textX, y + 45);

    ctx.font = font(15, 'bold');
    ctx.fillStyle = theme.textSecondary;
    ctx.textAlign = 'right';
    ctx.fillText(durationText, rect.x + rect.width - 16, y + 34);
  });
}

function drawPositionBadge(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  position: number,
  row: Rect,
): void {
  const badge: Rect = { x: row.x + 12, y: row.y + 11, width: 36, height: 32 };

  fillRoundedRect(ctx, badge, 10, theme.surface);
  strokeRoundedRect(ctx, badge, 10, theme.surfaceBorder, 1);

  ctx.font = font(15, 'bold');
  ctx.fillStyle = theme.textSecondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(position), badge.x + badge.width / 2, badge.y + badge.height / 2 + 1);
}

function drawFooter(
  ctx: SKRSContext2D,
  theme: CanvasTheme,
  data: QueueCardData,
  height: number,
): void {
  const y = height - FOOTER_HEIGHT - 8;
  const bar: Rect = { x: PADDING, y, width: WIDTH - PADDING * 2, height: FOOTER_HEIGHT - 12 };

  fillRoundedRect(ctx, bar, 14, theme.surface);
  strokeRoundedRect(ctx, bar, 14, theme.surfaceBorder, 1);

  const chips = [
    `${Math.max(0, data.totalTracks)} tracks in queue`,
    `Total ${formatDuration(data.totalDurationMs)}`,
    `Loop: ${LOOP_LABEL[data.loop] ?? 'Off'}`,
  ];

  ctx.textBaseline = 'middle';
  const centerY = bar.y + bar.height / 2;
  const cellWidth = bar.width / chips.length;

  chips.forEach((chip, index) => {
    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(bar.x + cellWidth * index, bar.y + 12);
      ctx.lineTo(bar.x + cellWidth * index, bar.y + bar.height - 12);
      ctx.strokeStyle = theme.surfaceBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.font = font(16, 'bold');
    ctx.fillStyle = theme.textSecondary;
    ctx.textAlign = 'center';
    ctx.fillText(
      truncateText(ctx, chip, cellWidth - 20),
      bar.x + cellWidth * index + cellWidth / 2,
      centerY,
    );
  });
}

export const QUEUE_CARD_WIDTH = WIDTH;
