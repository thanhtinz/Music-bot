import type { Image, SKRSContext2D } from '@napi-rs/canvas';

/**
 * `@napi-rs/canvas` declares `CanvasGradient` module-locally, so we recover the
 * type from the context method that produces it instead of naming it directly.
 */
export type CanvasGradient = ReturnType<SKRSContext2D['createLinearGradient']>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Traces a rounded rectangle path. Does not fill or stroke. */
export function roundedRectPath(ctx: SKRSContext2D, rect: Rect, radius: number): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const { x, y, width: w, height: h } = rect;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function fillRoundedRect(
  ctx: SKRSContext2D,
  rect: Rect,
  radius: number,
  fill: string | CanvasGradient,
): void {
  roundedRectPath(ctx, rect, radius);
  ctx.fillStyle = fill as string;
  ctx.fill();
}

export function strokeRoundedRect(
  ctx: SKRSContext2D,
  rect: Rect,
  radius: number,
  stroke: string,
  lineWidth = 1,
): void {
  roundedRectPath(ctx, rect, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** Runs `draw` with the given rounded rect installed as a clip region. */
export function withRoundedClip(
  ctx: SKRSContext2D,
  rect: Rect,
  radius: number,
  draw: () => void,
): void {
  ctx.save();
  roundedRectPath(ctx, rect, radius);
  ctx.clip();
  draw();
  ctx.restore();
}

export function linearGradient(
  ctx: SKRSContext2D,
  rect: Rect,
  colors: readonly string[],
  direction: 'horizontal' | 'vertical' = 'horizontal',
): CanvasGradient {
  const gradient =
    direction === 'horizontal'
      ? ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
      : ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);

  colors.forEach((color, index) => {
    gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
  });
  return gradient;
}

/**
 * Truncates `text` with a trailing ellipsis so it fits within `maxWidth`.
 *
 * `ctx.font` must already be set to the font the text will be drawn with.
 */
export function truncateText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = '…';
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd() + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }

  return low <= 0 ? ellipsis : text.slice(0, low).trimEnd() + ellipsis;
}

/** Word-wraps `text` into at most `maxLines` lines, ellipsising the last one. */
export function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word;

    if (lines.length === maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    // Everything that did not fit is folded into the final line so the
    // ellipsis signals truncated content rather than a clean line break.
    const consumed = lines.join(' ');
    const rest = text.slice(consumed.length).trim();
    if (last !== undefined && rest) {
      lines[maxLines - 1] = truncateText(ctx, `${last} ${rest}`, maxWidth);
    } else if (last !== undefined) {
      lines[maxLines - 1] = truncateText(ctx, last, maxWidth);
    }
  }

  return lines;
}

/** Draws `image` cropped to fill `rect` while preserving its aspect ratio. */
export function drawImageCover(ctx: SKRSContext2D, image: Image, rect: Rect): void {
  const imageRatio = image.width / image.height;
  const rectRatio = rect.width / rect.height;

  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (imageRatio > rectRatio) {
    sw = image.height * rectRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / rectRatio;
    sy = (image.height - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, rect.x, rect.y, rect.width, rect.height);
}

/** Applies a soft drop shadow around `draw`, then clears the shadow state. */
export function withShadow(
  ctx: SKRSContext2D,
  options: { color: string; blur: number; offsetX?: number; offsetY?: number },
  draw: () => void,
): void {
  ctx.save();
  ctx.shadowColor = options.color;
  ctx.shadowBlur = options.blur;
  ctx.shadowOffsetX = options.offsetX ?? 0;
  ctx.shadowOffsetY = options.offsetY ?? 0;
  draw();
  ctx.restore();
}

/** Formats a millisecond duration as `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Clamps `value` into the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
