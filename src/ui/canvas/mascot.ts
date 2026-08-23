import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * The bot's mascot, cut out of the brand artwork.
 *
 * Every card draws the same file rather than its own approximation, so the
 * character cannot drift between screens.
 */
const MASCOT_PATH = resolve(__dirname, '../../../assets/mascot/melody-cat.png');

/** Brand name shown next to the mascot. */
export const BOT_NAME = 'Melody';

let cache: Image | null | undefined;

/**
 * Loads the mascot once per process.
 *
 * Returns `null` when the asset is missing: a card should still render without
 * its decoration rather than fail outright.
 */
export async function loadMascot(): Promise<Image | null> {
  if (cache !== undefined) return cache;

  cache = existsSync(MASCOT_PATH) ? await loadImage(MASCOT_PATH) : null;
  return cache;
}

export interface MascotPlacement {
  /** Horizontal centre. */
  centerX: number;
  /** Where the mascot's feet sit. */
  bottomY: number;
  /** Rendered height; the width follows the artwork's aspect ratio. */
  height: number;
  /** 0..1, for a mascot that should sit back behind the content. */
  opacity?: number;
}

/** Draws the mascot, doing nothing when the asset is unavailable. */
export async function drawMascot(ctx: SKRSContext2D, placement: MascotPlacement): Promise<void> {
  const mascot = await loadMascot();
  if (!mascot) return;

  const width = placement.height * (mascot.width / mascot.height);
  const x = placement.centerX - width / 2;
  const y = placement.bottomY - placement.height;

  ctx.save();
  if (placement.opacity !== undefined) ctx.globalAlpha = placement.opacity;
  ctx.drawImage(mascot, x, y, width, placement.height);
  ctx.restore();
}
