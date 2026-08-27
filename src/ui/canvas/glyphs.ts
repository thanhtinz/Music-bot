import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Image, type SKRSContext2D } from '@napi-rs/canvas';

import type { Rect } from './primitives';
import { assetPath } from './asset-path';

/**
 * Line-art icons, drawn from Lucide's SVGs.
 *
 * Cards that composite onto an illustrated template need icons that match a
 * command, not whatever the template happened to bake in — a `/shuffle` row
 * must not inherit a pause icon. What matters here is the mapping: which
 * command, category or tone draws which icon. The drawings themselves come
 * from a set (`assets/icons`, synced by `npm run sync:icons`).
 */
export type GlyphName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'skip'
  | 'previous'
  | 'plus'
  | 'list'
  | 'search'
  | 'note'
  | 'playlist'
  | 'gear'
  | 'info'
  | 'heart'
  | 'shuffle'
  | 'loop'
  | 'sliders'
  | 'clock'
  | 'volume'
  | 'trash'
  | 'broom'
  | 'exit'
  | 'chart'
  | 'history'
  | 'warning'
  | 'bell'
  | 'question';

/** Command and category names mapped onto a glyph. */
const GLYPH_ALIASES: Record<string, GlyphName> = {
  play: 'play',
  resume: 'play',
  player: 'play',
  playnext: 'plus',
  add: 'plus',
  favorite: 'heart',
  fav: 'heart',
  // Grabbing a song is keeping it, the same as favouriting one.
  grab: 'heart',
  save: 'heart',
  yoink: 'heart',
  pause: 'pause',
  stop: 'stop',
  skip: 'skip',
  next: 'skip',
  previous: 'previous',
  back: 'previous',
  queue: 'list',
  search: 'search',
  lyrics: 'list',
  music: 'note',
  playback: 'play',
  playlist: 'playlist',
  filter: 'sliders',
  filters: 'sliders',
  settings: 'gear',
  config: 'gear',
  general: 'info',
  info: 'info',
  help: 'info',
  shuffle: 'shuffle',
  loop: 'loop',
  repeat: 'loop',
  autoplay: 'loop',
  volume: 'volume',
  vol: 'volume',
  seek: 'clock',
  // Stepping through a track is a seek by another name; going back to the top
  // is the loop the `loop` command draws.
  forward: 'clock',
  ff: 'clock',
  fwd: 'clock',
  rewind: 'clock',
  rw: 'clock',
  replay: 'loop',
  restart: 'loop',
  sleep: 'clock',
  sleeptimer: 'clock',
  bedtime: 'clock',
  prefix: 'list',
  djrole: 'note',
  idletimeout: 'clock',
  '247': 'clock',
  nowplaying: 'note',
  np: 'note',
  // Queue editing: taking tracks out is a bin, tidying a queue is a broom,
  // and rearranging is a list. A square said "stop" for all of them.
  remove: 'trash',
  removemine: 'trash',
  clear: 'trash',
  cleanup: 'broom',
  removedupes: 'broom',
  rmdupes: 'broom',
  dedupe: 'broom',
  leavecleanup: 'broom',
  leaveclean: 'broom',
  lc: 'broom',
  move: 'list',
  jump: 'skip',
  skipto: 'skip',
  join: 'play',
  summon: 'play',
  connect: 'play',
  // Leaving is a departure, not a stop.
  leave: 'exit',
  disconnect: 'exit',
  dc: 'exit',
  // Counts, not a list.
  stats: 'chart',
  activity: 'chart',
  top: 'chart',
  // These two drew a question mark, having never been given a glyph.
  history: 'history',
  played: 'history',
  recent: 'history',
  warning: 'warning',
  error: 'warning',
  // A bell for an announcement, and a note for the role that runs the music —
  // `djrole` drew the same gear as `settings` itself, on the same card.
  announce: 'bell',
  announcetracks: 'bell',
  // Short aliases, so a card built from an alias rather than a command name
  // cannot fall through to a question mark. A test walks the catalog and fails
  // when a new one is added without a glyph.
  p: 'play',
  pn: 'plus',
  playtop: 'plus',
  find: 'search',
  sr: 'search',
  unpause: 'play',
  s: 'skip',
  voteskip: 'skip',
  vs: 'skip',
  prev: 'previous',
  q: 'list',
  rm: 'trash',
  delete: 'trash',
  rmmine: 'trash',
  mv: 'list',
  jumpto: 'skip',
  pl: 'playlist',
  h: 'info',
  commands: 'info',
};

/** Resolves a command or category name to a glyph, falling back to a question mark. */
export function glyphFor(name: string): GlyphName {
  const key = name.toLowerCase();
  // A glyph's own name resolves to itself, so a caller that already knows which
  // one it wants does not have to be listed among the aliases as well.
  return GLYPH_ALIASES[key] ?? (GLYPH_NAMES.has(key) ? (key as GlyphName) : 'question');
}

const GLYPH_NAMES = new Set<string>([
  'play',
  'pause',
  'stop',
  'skip',
  'previous',
  'plus',
  'list',
  'search',
  'note',
  'playlist',
  'gear',
  'info',
  'heart',
  'shuffle',
  'loop',
  'sliders',
  'clock',
  'volume',
  'trash',
  'broom',
  'exit',
  'chart',
  'history',
  'warning',
  'bell',
  'question',
]);

/**
 * Which Lucide icon draws each glyph.
 *
 * Kept here rather than in the sync script so one file answers both questions a
 * glyph raises: which command draws it, and what it looks like.
 */
export const LUCIDE_ICON_FILES: Record<GlyphName, string> = {
  play: 'play',
  pause: 'pause',
  stop: 'square',
  skip: 'skip-forward',
  previous: 'skip-back',
  plus: 'circle-plus',
  list: 'list',
  search: 'search',
  note: 'music',
  playlist: 'list-music',
  gear: 'settings',
  info: 'info',
  heart: 'heart',
  shuffle: 'shuffle',
  loop: 'repeat',
  sliders: 'sliders-horizontal',
  clock: 'clock',
  volume: 'volume-2',
  trash: 'trash-2',
  broom: 'brush-cleaning',
  exit: 'log-out',
  chart: 'chart-column',
  history: 'history',
  warning: 'triangle-alert',
  bell: 'bell',
  question: 'circle-question-mark',
};

/** Where {@link LUCIDE_ICON_FILES} lands once `npm run sync:icons` has run. */
const ICON_DIR = assetPath('icons');

/** Lucide draws on a 24-unit grid at stroke width 2. */
const ICON_GRID = 24;
const ICON_STROKE = 2;

const sources = new Map<GlyphName, string>();
const rasterised = new Map<string, Image>();

/**
 * The icon's markup, with its stroke colour and width filled in.
 *
 * Lucide ships `stroke="currentColor"`, which means nothing to a canvas, so the
 * colour is substituted before the SVG is handed over to be rasterised.
 */
function markup(name: GlyphName, color: string, strokeWidth: number): string {
  let source = sources.get(name);

  if (source === undefined) {
    const file = resolve(ICON_DIR, `${name}.svg`);
    if (!existsSync(file)) {
      throw new Error(
        `Icon missing at ${file}. Run \`npm run sync:icons\` to copy it out of lucide-static.`,
      );
    }

    source = readFileSync(file, 'utf8');
    sources.set(name, source);
  }

  return source
    .replace('stroke="currentColor"', `stroke="${color}"`)
    .replace(`stroke-width="${ICON_STROKE}"`, `stroke-width="${strokeWidth}"`);
}

/**
 * Draws `name` centred in `box`.
 *
 * Rasterised from the icon's own SVG at the size asked for, rather than scaled
 * from one bitmap: an icon drawn into a 34px tile and the same icon on a 46px
 * one are separate renders, so neither is soft.
 */
export function drawGlyph(
  ctx: SKRSContext2D,
  name: GlyphName,
  box: Rect,
  color: string,
  lineWidth = Math.max(2, box.width * 0.09),
): void {
  // Square, centred: Lucide's grid is square, and stretching an icon to a
  // rectangle is how a circle ends up an egg.
  const size = Math.min(box.width, box.height);
  const x = box.x + (box.width - size) / 2;
  const y = box.y + (box.height - size) / 2;

  // The caller's line width is in card pixels; Lucide's is in grid units.
  const strokeWidth = Math.round(((lineWidth * ICON_GRID) / size) * 100) / 100;
  const key = `${name}|${color}|${strokeWidth}|${Math.round(size)}`;

  let image = rasterised.get(key);
  if (!image) {
    image = new Image();
    // Rendered at the drawn size, so the rasteriser works at the resolution the
    // card actually uses.
    image.width = Math.round(size);
    image.height = Math.round(size);
    image.src = Buffer.from(markup(name, color, strokeWidth));

    rasterised.set(key, image);
  }

  ctx.drawImage(image, x, y, size, size);
}
