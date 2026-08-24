import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';

import { createLogger } from '../../../telemetry/logger';

import { SHOT_FILES } from './shots';

const logger = createLogger('site-assets');

/** Quality for the WebP copies; the same 90 the cards are sent to Discord at. */
const WEBP_QUALITY = 90;

export interface ShotAsset {
  body: Buffer;
  contentType: string;
}

/**
 * The screenshots, re-encoded once and then held in memory.
 *
 * Six cards is 2.9 MB of PNG, which is a landing page that takes a moment to
 * arrive on a phone for no reason: the bot already sends these same cards to
 * Discord as WebP because it is seventeen times smaller at a quality nobody can
 * tell apart. The site had been serving the PNGs.
 *
 * Converted lazily and cached, rather than checked into the repository twice:
 * one copy on disk stays the thing the README shows and the tests compare
 * against, and there is no build step that can be forgotten.
 */
const cache = new Map<string, ShotAsset>();

/**
 * A screenshot, as WebP where the browser said it takes it.
 *
 * The `accept` header is honoured rather than assumed. Every browser released
 * this decade takes WebP, but "every browser" is not the same as "every client"
 * — a link preview fetcher, a scraper or a text browser may not, and serving
 * them bytes they cannot decode to save a few hundred kilobytes is a bad trade.
 */
export async function loadShot(path: string, accept: string): Promise<ShotAsset | undefined> {
  const file = SHOT_FILES[path];
  if (!file) return undefined;

  const webp = accept.includes('image/webp');
  const key = `${path}|${webp ? 'webp' : 'png'}`;

  const cached = cache.get(key);
  if (cached) return cached;

  const png = await readFile(resolve(__dirname, '../../../..', file));
  const asset = webp ? await toWebp(png, path) : { body: png, contentType: 'image/png' };

  cache.set(key, asset);
  return asset;
}

async function toWebp(png: Buffer, path: string): Promise<ShotAsset> {
  try {
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);

    return { body: await canvas.encode('webp', WEBP_QUALITY), contentType: 'image/webp' };
  } catch (error) {
    // A picture that will not re-encode is still a picture: serve the original
    // rather than serving nothing.
    logger.warn({ err: error, path }, 'could not re-encode a screenshot; serving the PNG');
    return { body: png, contentType: 'image/png' };
  }
}

/** Forgets the cached copies. For the tests, and for a redeploy in place. */
export function clearShotCache(): void {
  cache.clear();
}
