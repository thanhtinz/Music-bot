import type { SKRSContext2D } from '@napi-rs/canvas';

import type { Rect } from './primitives';

/**
 * Line-art icons drawn from paths.
 *
 * Cards that composite onto an illustrated template need icons that match a
 * command, not whatever the template happened to bake in — a `/shuffle` row
 * must not inherit a pause icon. Drawing them keeps every row honest.
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
  prefix: 'list',
  djrole: 'gear',
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
  'question',
]);

/**
 * Draws `name` centred in `box`.
 *
 * Coordinates inside each case are normalised to the box, so a glyph scales to
 * any tile without separate artwork per size.
 */
export function drawGlyph(
  ctx: SKRSContext2D,
  name: GlyphName,
  box: Rect,
  color: string,
  lineWidth = Math.max(2, box.width * 0.09),
): void {
  const { x, y, width: w, height: h } = box;
  // Normalised helpers: (0,0) is the box's top-left, (1,1) its bottom-right.
  const px = (u: number) => x + u * w;
  const py = (v: number) => y + v * h;

  // `restore()` does not put back stroke and fill styles in this canvas
  // implementation, so they are captured and reinstated by hand — otherwise a
  // glyph would silently recolour whatever the caller draws next.
  const previous = {
    strokeStyle: ctx.strokeStyle,
    fillStyle: ctx.fillStyle,
    lineWidth: ctx.lineWidth,
    lineCap: ctx.lineCap,
    lineJoin: ctx.lineJoin,
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (name) {
    case 'play': {
      ctx.beginPath();
      ctx.moveTo(px(0.28), py(0.16));
      ctx.lineTo(px(0.82), py(0.5));
      ctx.lineTo(px(0.28), py(0.84));
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'pause': {
      for (const u of [0.34, 0.66]) {
        ctx.beginPath();
        ctx.moveTo(px(u), py(0.18));
        ctx.lineTo(px(u), py(0.82));
        ctx.stroke();
      }
      break;
    }
    case 'stop': {
      ctx.beginPath();
      roundedPath(ctx, px(0.22), py(0.22), w * 0.56, h * 0.56, w * 0.12);
      ctx.stroke();
      break;
    }
    case 'skip':
    case 'previous': {
      const flip = name === 'previous';
      const tri = (a: number, b: number, c: number) => {
        ctx.beginPath();
        ctx.moveTo(px(flip ? 1 - a : a), py(0.18));
        ctx.lineTo(px(flip ? 1 - b : b), py(0.5));
        ctx.lineTo(px(flip ? 1 - a : a), py(0.82));
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(flip ? 1 - c : c), py(0.18));
        ctx.lineTo(px(flip ? 1 - c : c), py(0.82));
        ctx.stroke();
      };
      tri(0.2, 0.68, 0.8);
      break;
    }
    case 'plus': {
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), Math.min(w, h) * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.28));
      ctx.lineTo(px(0.5), py(0.72));
      ctx.moveTo(px(0.28), py(0.5));
      ctx.lineTo(px(0.72), py(0.5));
      ctx.stroke();
      break;
    }
    case 'list': {
      const rows = [0.24, 0.5, 0.76];
      rows.forEach((v, index) => {
        ctx.beginPath();
        ctx.moveTo(px(0.2), py(v));
        ctx.lineTo(px(index === 2 ? 0.62 : 0.84), py(v));
        ctx.stroke();
      });
      break;
    }
    case 'playlist': {
      [0.22, 0.46].forEach((v) => {
        ctx.beginPath();
        ctx.moveTo(px(0.16), py(v));
        ctx.lineTo(px(0.72), py(v));
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(px(0.16), py(0.7));
      ctx.lineTo(px(0.46), py(0.7));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.72), py(0.86));
      ctx.lineTo(px(0.72), py(0.5));
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px(0.63), py(0.86), w * 0.1, h * 0.08, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'search': {
      ctx.beginPath();
      ctx.arc(px(0.44), py(0.44), Math.min(w, h) * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.66), py(0.66));
      ctx.lineTo(px(0.84), py(0.84));
      ctx.stroke();
      break;
    }
    case 'note': {
      ctx.beginPath();
      ctx.moveTo(px(0.44), py(0.78));
      ctx.lineTo(px(0.44), py(0.2));
      ctx.lineTo(px(0.82), py(0.3));
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px(0.32), py(0.78), w * 0.13, h * 0.1, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'gear': {
      // Short, stubby teeth close to a large hub — long thin spokes read as a
      // sun rather than a gear.
      const hub = Math.min(w, h) * 0.34;
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), hub, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), hub * 0.42, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = lineWidth * 1.5;
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(px(0.5) + Math.cos(angle) * hub * 0.95, py(0.5) + Math.sin(angle) * hub * 0.95);
        ctx.lineTo(px(0.5) + Math.cos(angle) * hub * 1.32, py(0.5) + Math.sin(angle) * hub * 1.32);
        ctx.stroke();
      }
      break;
    }
    case 'info': {
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), Math.min(w, h) * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.46));
      ctx.lineTo(px(0.5), py(0.72));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.3), lineWidth * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.82));
      ctx.bezierCurveTo(px(0.02), py(0.5), px(0.18), py(0.1), px(0.5), py(0.34));
      ctx.bezierCurveTo(px(0.82), py(0.1), px(0.98), py(0.5), px(0.5), py(0.82));
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'shuffle': {
      ctx.beginPath();
      ctx.moveTo(px(0.16), py(0.28));
      ctx.lineTo(px(0.4), py(0.28));
      ctx.lineTo(px(0.78), py(0.74));
      ctx.moveTo(px(0.16), py(0.74));
      ctx.lineTo(px(0.4), py(0.74));
      ctx.lineTo(px(0.78), py(0.28));
      ctx.stroke();
      arrowHead(ctx, px(0.86), py(0.28), px(0.66), py(0.28), w * 0.14);
      arrowHead(ctx, px(0.86), py(0.74), px(0.66), py(0.74), w * 0.14);
      break;
    }
    case 'loop': {
      ctx.beginPath();
      roundedPath(ctx, px(0.16), py(0.26), w * 0.68, h * 0.48, w * 0.16);
      ctx.stroke();
      arrowHead(ctx, px(0.62), py(0.26), px(0.44), py(0.26), w * 0.13);
      arrowHead(ctx, px(0.38), py(0.74), px(0.56), py(0.74), w * 0.13);
      break;
    }
    case 'sliders': {
      const rows = [0.28, 0.5, 0.72];
      const knobs = [0.66, 0.38, 0.56];
      rows.forEach((v, index) => {
        ctx.beginPath();
        ctx.moveTo(px(0.14), py(v));
        ctx.lineTo(px(0.86), py(v));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px(knobs[index] as number), py(v), lineWidth * 1.1, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'clock': {
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), Math.min(w, h) * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.28));
      ctx.lineTo(px(0.5), py(0.52));
      ctx.lineTo(px(0.68), py(0.62));
      ctx.stroke();
      break;
    }
    case 'volume': {
      ctx.beginPath();
      ctx.moveTo(px(0.18), py(0.38));
      ctx.lineTo(px(0.32), py(0.38));
      ctx.lineTo(px(0.5), py(0.2));
      ctx.lineTo(px(0.5), py(0.8));
      ctx.lineTo(px(0.32), py(0.62));
      ctx.lineTo(px(0.18), py(0.62));
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0.56), py(0.5), w * 0.18, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
      break;
    }
    case 'trash': {
      // Lid, then a tapered bin with two ribs: a plain square says nothing
      // about taking something away.
      ctx.beginPath();
      ctx.moveTo(px(0.16), py(0.28));
      ctx.lineTo(px(0.84), py(0.28));
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0.38), py(0.28));
      ctx.lineTo(px(0.42), py(0.16));
      ctx.lineTo(px(0.58), py(0.16));
      ctx.lineTo(px(0.62), py(0.28));
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0.24), py(0.28));
      ctx.lineTo(px(0.31), py(0.84));
      ctx.lineTo(px(0.69), py(0.84));
      ctx.lineTo(px(0.76), py(0.28));
      ctx.stroke();

      for (const u of [0.42, 0.58]) {
        ctx.beginPath();
        ctx.moveTo(px(u), py(0.4));
        ctx.lineTo(px(u + (u < 0.5 ? 0.02 : -0.02)), py(0.72));
        ctx.stroke();
      }
      break;
    }
    case 'broom': {
      // A handle down the diagonal, a band across it, and a head of bristles
      // fanning out past the band — the whole thing lives on one axis, so the
      // parts line up the way a real broom's do.
      ctx.beginPath();
      ctx.moveTo(px(0.84), py(0.12));
      ctx.lineTo(px(0.44), py(0.52));
      ctx.stroke();

      // Across the handle, where the bristles are bound.
      ctx.beginPath();
      ctx.moveTo(px(0.33), py(0.47));
      ctx.lineTo(px(0.5), py(0.64));
      ctx.stroke();

      // The head, splayed a little wider at the tips than at the band.
      ctx.beginPath();
      ctx.moveTo(px(0.33), py(0.47));
      ctx.lineTo(px(0.12), py(0.66));
      ctx.lineTo(px(0.32), py(0.86));
      ctx.lineTo(px(0.5), py(0.64));
      ctx.closePath();
      ctx.stroke();

      for (const offset of [0.06, 0.12]) {
        ctx.beginPath();
        ctx.moveTo(px(0.33 + offset), py(0.47 + offset));
        ctx.lineTo(px(0.16 + offset), py(0.68 + offset));
        ctx.stroke();
      }
      break;
    }
    case 'exit': {
      // A doorway with an arrow leaving it: `leave` is a departure, not a stop.
      ctx.beginPath();
      ctx.moveTo(px(0.56), py(0.14));
      ctx.lineTo(px(0.22), py(0.14));
      ctx.lineTo(px(0.22), py(0.86));
      ctx.lineTo(px(0.56), py(0.86));
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0.44), py(0.5));
      ctx.lineTo(px(0.8), py(0.5));
      ctx.stroke();
      arrowHead(ctx, px(0.86), py(0.5), px(0.66), py(0.5), w * 0.15);
      break;
    }
    case 'chart': {
      // Three bars on a baseline — listening stats are counts, not a list.
      ctx.beginPath();
      ctx.moveTo(px(0.16), py(0.84));
      ctx.lineTo(px(0.86), py(0.84));
      ctx.stroke();

      const bars = [
        [0.28, 0.56],
        [0.5, 0.32],
        [0.72, 0.46],
      ] as const;
      for (const [u, top] of bars) {
        ctx.beginPath();
        ctx.moveTo(px(u), py(0.84));
        ctx.lineTo(px(u), py(top));
        ctx.stroke();
      }
      break;
    }
    case 'history': {
      // A clock with its hand wound backwards: what has already played.
      ctx.beginPath();
      ctx.arc(px(0.54), py(0.54), Math.min(w, h) * 0.34, Math.PI * 0.75, Math.PI * 2.6);
      ctx.stroke();
      arrowHead(ctx, px(0.2), py(0.42), px(0.3), py(0.24), w * 0.15);

      ctx.beginPath();
      ctx.moveTo(px(0.54), py(0.36));
      ctx.lineTo(px(0.54), py(0.56));
      ctx.lineTo(px(0.7), py(0.64));
      ctx.stroke();
      break;
    }
    case 'warning': {
      // A triangle with a bang: a refusal should not draw a question mark.
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.16));
      ctx.lineTo(px(0.88), py(0.82));
      ctx.lineTo(px(0.12), py(0.82));
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.42));
      ctx.lineTo(px(0.5), py(0.62));
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px(0.5), py(0.72), lineWidth * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'question':
    default: {
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.5), Math.min(w, h) * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.38), w * 0.14, Math.PI * 0.9, Math.PI * 2.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0.52));
      ctx.lineTo(px(0.5), py(0.6));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0.5), py(0.72), lineWidth * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
  ctx.strokeStyle = previous.strokeStyle;
  ctx.fillStyle = previous.fillStyle;
  ctx.lineWidth = previous.lineWidth;
  ctx.lineCap = previous.lineCap;
  ctx.lineJoin = previous.lineJoin;
}

/** Traces a rounded rectangle into the current path. */
function roundedPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draws a small arrow head at `(tipX, tipY)` pointing away from `(fromX, fromY)`. */
function arrowHead(
  ctx: SKRSContext2D,
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size: number,
): void {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = 0.5;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(angle - spread) * size, tipY - Math.sin(angle - spread) * size);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(angle + spread) * size, tipY - Math.sin(angle + spread) * size);
  ctx.stroke();
}
