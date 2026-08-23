import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

import { font, registerFonts } from './fonts';
import { linearGradient } from './primitives';

const FETCH_TIMEOUT_MS = 4_000;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/** Hosts we are willing to fetch artwork from. Anything else is placeholdered. */
const ALLOWED_ARTWORK_HOSTS = [
  'i.ytimg.com',
  'img.youtube.com',
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
  'i1.sndcdn.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
];

function isAllowedArtworkUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_ARTWORK_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/** Deterministic hue derived from a string, so a track always looks the same. */
function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * Builds a gradient tile carrying the track's initial.
 *
 * Used when a track has no artwork, when the host is not allowlisted, or when
 * the download fails — the card must never render with a hole in it.
 */
export async function createPlaceholderArtwork(seed: string, size = 512): Promise<Image> {
  registerFonts();

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const hue = hueFromSeed(seed || 'unknown');

  ctx.fillStyle = linearGradient(
    ctx,
    { x: 0, y: 0, width: size, height: size },
    [`hsl(${hue}, 62%, 46%)`, `hsl(${(hue + 48) % 360}, 58%, 26%)`],
    'vertical',
  );
  ctx.fillRect(0, 0, size, size);

  // Concentric arcs read as a stylised vinyl without needing an asset file.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = size * 0.035;
  for (let i = 1; i <= 4; i += 1) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2.4) * (i / 4), 0, Math.PI * 2);
    ctx.stroke();
  }

  const initial = (seed.trim()[0] ?? '♪').toUpperCase();
  ctx.font = font(size * 0.42, 'bold');
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, size / 2, size / 2 + size * 0.02);

  return loadImage(canvas.toBuffer('image/png'));
}

/**
 * Loads track artwork, falling back to a generated placeholder.
 *
 * Never throws: a broken cover must not take down the Now Playing panel.
 */
export async function loadArtwork(url: string | undefined, seed: string): Promise<Image> {
  if (!url || !isAllowedArtworkUrl(url)) return createPlaceholderArtwork(seed);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return createPlaceholderArtwork(seed);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return createPlaceholderArtwork(seed);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ARTWORK_BYTES) {
      return createPlaceholderArtwork(seed);
    }

    return await loadImage(buffer);
  } catch {
    return createPlaceholderArtwork(seed);
  }
}
