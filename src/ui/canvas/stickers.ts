import type { SKRSContext2D } from '@napi-rs/canvas';

/**
 * Pastel decorations drawn from paths.
 *
 * The template-backed cards get their stickers from the artwork; a card drawn
 * entirely in code needs its own, or it reads as a plain table next to them.
 */
export interface StickerColors {
  pink: string;
  pinkSoft: string;
  yellow: string;
  ink: string;
  paper: string;
}

export const SAKURA_STICKER_COLORS: StickerColors = {
  pink: '#f78fb3',
  pinkSoft: '#fbc7dc',
  yellow: '#fbd46d',
  ink: '#8a6b74',
  paper: '#ffffff',
};

/** Four-pointed sparkle — the small filler that sits between other stickers. */
export function drawSparkle(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const arm = size / 2;
  // Concave sides are what separate a sparkle from a plus sign.
  ctx.beginPath();
  ctx.moveTo(x, y - arm);
  ctx.quadraticCurveTo(x + arm * 0.18, y - arm * 0.18, x + arm, y);
  ctx.quadraticCurveTo(x + arm * 0.18, y + arm * 0.18, x, y + arm);
  ctx.quadraticCurveTo(x - arm * 0.18, y + arm * 0.18, x - arm, y);
  ctx.quadraticCurveTo(x - arm * 0.18, y - arm * 0.18, x, y - arm);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Rounded five-pointed star. */
export function drawStar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke?: string,
): void {
  const outer = size / 2;
  const inner = outer * 0.46;

  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();

  if (stroke) {
    ctx.lineWidth = Math.max(1.5, size * 0.07);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Eighth note, optionally beamed to a second head. */
export function drawMusicNote(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  double = false,
): void {
  const stem = size * 0.9;
  const headRadius = size * 0.19;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.11;

  ctx.beginPath();
  ctx.ellipse(x, y, headRadius * 1.2, headRadius, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + headRadius * 1.1, y);
  ctx.lineTo(x + headRadius * 1.1, y - stem);
  ctx.stroke();

  if (double) {
    const secondX = x + size * 0.62;
    ctx.beginPath();
    ctx.ellipse(secondX, y - size * 0.16, headRadius * 1.2, headRadius, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(secondX + headRadius * 1.1, y - size * 0.16);
    ctx.lineTo(secondX + headRadius * 1.1, y - stem);
    ctx.stroke();

    // Beam joining the two stems.
    ctx.lineWidth = size * 0.15;
    ctx.beginPath();
    ctx.moveTo(x + headRadius * 1.1, y - stem);
    ctx.lineTo(secondX + headRadius * 1.1, y - stem);
    ctx.stroke();
  } else {
    ctx.lineWidth = size * 0.13;
    ctx.beginPath();
    ctx.moveTo(x + headRadius * 1.1, y - stem);
    ctx.quadraticCurveTo(x + size * 0.6, y - stem * 0.82, x + size * 0.42, y - stem * 0.45);
    ctx.stroke();
  }

  ctx.restore();
}

/** Ribbon bow — two loops around a knot. */
export function drawBow(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
): void {
  const wing = size * 0.42;
  const height = size * 0.34;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.lineJoin = 'round';

  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + direction * wing * 0.5,
      y - height,
      x + direction * wing * 1.5,
      y - height * 0.8,
      x + direction * wing,
      y,
    );
    ctx.bezierCurveTo(
      x + direction * wing * 1.5,
      y + height * 0.8,
      x + direction * wing * 0.5,
      y + height,
      x,
      y,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.11, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Loose heart-shaped swirl, used as a corner flourish. */
export function drawHeartSwirl(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.lineCap = 'round';

  // A single unbroken outline: the two lobes meeting at a dip, then both sides
  // falling to a point. Drawing it as separate curves left it looking like two
  // stacked loops rather than a heart.
  const top = y - size * 0.22;
  const tip = y + size * 0.46;

  ctx.beginPath();
  ctx.moveTo(x, tip);
  ctx.bezierCurveTo(x - size * 0.62, y + size * 0.02, x - size * 0.44, y - size * 0.52, x, top);
  ctx.bezierCurveTo(x + size * 0.44, y - size * 0.52, x + size * 0.62, y + size * 0.02, x, tip);
  ctx.stroke();
  ctx.restore();
}

/** Cheerful blob mascot with a sprout, matching the queue template's. */
export function drawSproutMascot(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  colors: StickerColors,
): void {
  const bodyWidth = size * 0.62;
  const bodyHeight = size * 0.56;
  const bodyTop = y - bodyHeight / 2;

  ctx.save();
  ctx.lineJoin = 'round';

  // Sprout grows straight out of the body's crown; starting it any higher
  // leaves it visibly floating above the head.
  ctx.strokeStyle = '#8fbf7a';
  ctx.lineWidth = Math.max(2, size * 0.028);
  ctx.beginPath();
  ctx.moveTo(x, bodyTop + size * 0.02);
  ctx.lineTo(x, bodyTop - size * 0.13);
  ctx.stroke();

  ctx.fillStyle = '#a8d18d';
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + direction * size * 0.075,
      bodyTop - size * 0.13,
      size * 0.085,
      size * 0.05,
      direction * 0.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.fillStyle = colors.paper;
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = Math.max(2, size * 0.022);
  ctx.beginPath();
  ctx.ellipse(x, y, bodyWidth / 2, bodyHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Face: sized against the body rather than the sticker box, or it reads as a
  // large blank circle with a tiny expression in the middle.
  ctx.fillStyle = colors.ink;
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + direction * bodyWidth * 0.22,
      y - bodyHeight * 0.04,
      bodyWidth * 0.05,
      bodyHeight * 0.075,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = Math.max(2, bodyWidth * 0.035);
  ctx.beginPath();
  ctx.arc(x, y + bodyHeight * 0.06, bodyWidth * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.fillStyle = colors.pinkSoft;
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + direction * bodyWidth * 0.36,
      y + bodyHeight * 0.1,
      bodyWidth * 0.1,
      bodyHeight * 0.07,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}
