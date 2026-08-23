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

/**
 * Cheerful sprout mascot, matching the one in the queue artwork.
 *
 * The silhouette is a pear rather than a circle — narrow crown widening to a
 * broad base with a bump on each side — which is most of what makes it read as
 * a character instead of a face drawn on a ball.
 */
export function drawSproutMascot(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  colors: StickerColors,
): void {
  // Nearly as wide as it is tall: the reference reads as a round dumpling, and
  // a taller ratio turns it into an egg.
  const width = size * 0.72;
  const height = size * 0.6;
  const top = y - height * 0.52;
  const bottom = y + height * 0.48;
  const halfBase = width * 0.5;
  const halfCrown = width * 0.36;

  const outline = '#a08d84';
  const body = '#fdfbf8';
  const leaf = '#a6c97e';
  const leafEdge = '#7fa85f';

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawSprout(ctx, x, top, width, height, leaf, leafEdge);

  ctx.beginPath();
  ctx.moveTo(x, top);
  // Right: crown → side bump → base.
  // The apex control stays close to the centreline: pushing it out sideways at
  // the crown's own height flattens the head into a purse instead of doming it.
  ctx.bezierCurveTo(
    x + halfCrown * 0.62,
    top,
    x + halfBase * 1.0,
    y - height * 0.26,
    x + halfBase * 0.9,
    y + height * 0.06,
  );
  ctx.bezierCurveTo(
    x + halfBase * 1.1,
    y + height * 0.24,
    x + halfBase * 0.98,
    bottom - height * 0.02,
    x + halfBase * 0.6,
    bottom,
  );
  // Base, with a shallow dip so it sits rather than balances on a point.
  ctx.bezierCurveTo(
    x + halfBase * 0.28,
    bottom + height * 0.05,
    x - halfBase * 0.28,
    bottom + height * 0.05,
    x - halfBase * 0.6,
    bottom,
  );
  ctx.bezierCurveTo(
    x - halfBase * 0.98,
    bottom - height * 0.02,
    x - halfBase * 1.1,
    y + height * 0.24,
    x - halfBase * 0.9,
    y + height * 0.06,
  );
  ctx.bezierCurveTo(x - halfBase * 1.0, y - height * 0.26, x - halfCrown * 0.62, top, x, top);
  ctx.closePath();

  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(1.6, size * 0.013);
  ctx.stroke();

  drawFace(ctx, x, y, width, height, colors.pinkSoft);
  ctx.restore();
}

/** Two rounded leaves on a short stem, sitting on the crown. */
function drawSprout(
  ctx: SKRSContext2D,
  x: number,
  top: number,
  width: number,
  height: number,
  leaf: string,
  leafEdge: string,
): void {
  const stemTop = top - height * 0.11;

  ctx.strokeStyle = leafEdge;
  ctx.lineWidth = Math.max(1.6, width * 0.026);
  ctx.beginPath();
  ctx.moveTo(x, top + height * 0.02);
  ctx.quadraticCurveTo(x - width * 0.02, top - height * 0.08, x, stemTop);
  ctx.stroke();

  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + direction * width * 0.105,
      stemTop - height * 0.01,
      width * 0.115,
      height * 0.075,
      direction * 0.42,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = leaf;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, width * 0.018);
    ctx.strokeStyle = leafEdge;
    ctx.stroke();
  }
}

/** Dot eyes, an `ω` mouth and two blushes. */
function drawFace(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  blush: string,
): void {
  // The face sits in the upper half of the body, as it does in the artwork;
  // centring it makes the character look like it is slumping.
  const eyeY = y - height * 0.17;

  ctx.fillStyle = '#4a3f3c';
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + direction * width * 0.17, eyeY, width * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  // Blush sits outside the eyes and slightly lower, the way a cheek does.
  ctx.fillStyle = blush;
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + direction * width * 0.26,
      eyeY + height * 0.055,
      width * 0.072,
      height * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Two downward humps side by side make the small `ω` smile.
  const mouthRadius = width * 0.033;
  const mouthY = eyeY + height * 0.08;
  ctx.strokeStyle = '#8a746d';
  ctx.lineWidth = Math.max(1.4, width * 0.02);
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + direction * mouthRadius, mouthY, mouthRadius, 0, Math.PI);
    ctx.stroke();
  }
}
