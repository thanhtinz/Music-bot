import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GlobalFonts } from '@napi-rs/canvas';

/**
 * Font family name used by every canvas card.
 *
 * Cards never reference a concrete system font: they always ask for
 * {@link UI_FONT}. `registerFonts()` maps that name to whatever is actually
 * available on the host (bundled assets first, then system fonts), so the
 * rendering result stays identical between a developer machine and a slim
 * production container.
 */
export const UI_FONT = 'MusicBotUI';

/** Font used for emoji glyphs when the primary family has no coverage. */
export const EMOJI_FONT = 'MusicBotEmoji';

const ASSET_FONT_DIR = resolve(__dirname, '../../../assets/fonts');
const ASSET_CJK_DIR = join(ASSET_FONT_DIR, 'cjk');

/**
 * Path to a font shipped with Windows.
 *
 * Read from `WINDIR` rather than hardcoding a fixed path, which is only the
 * default install location and not where every machine actually keeps it.
 */
function winFont(file: string): string {
  return join(process.env.WINDIR ?? 'C:/Windows', 'Fonts', file);
}
/**
 * System fonts that carry a full Latin + Vietnamese diacritic coverage,
 * ordered by preference. The first hit wins.
 */
const SYSTEM_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  winFont('arial.ttf'),
];

const SYSTEM_BOLD_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  winFont('arialbd.ttf'),
];

const SYSTEM_EMOJI_CANDIDATES = [
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf',
  '/System/Library/Fonts/Apple Color Emoji.ttc',
  winFont('seguiemj.ttf'),
];

/**
 * Fonts that cover Han, kana and Hangul.
 *
 * Unlike the Latin candidates these are *not* first-hit-wins: a music bot is
 * asked for anime openings and K-pop in the same breath, and on Windows no
 * single file covers both — MS YaHei has the kana, Malgun has the Hangul. So
 * every candidate that exists gets registered under its own family and they
 * are chained in order, letting the renderer pick per character.
 *
 * A title with no glyph anywhere renders as `□`, which is what the user sees
 * when this list comes up empty. Linux images therefore need `fonts-noto-cjk`
 * installed (the Dockerfile does that) or a font dropped in `assets/fonts/cjk`.
 */
const SYSTEM_CJK_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  winFont('msyh.ttc'),
  winFont('meiryo.ttc'),
  winFont('malgun.ttf'),
];

let registered = false;

/**
 * The CJK families actually registered on this host, in fallback order.
 *
 * Empty until `registerFonts()` runs, and empty afterwards on a host with no
 * CJK font at all — in which case `font()` simply omits the segment.
 */
let cjkFamilies: string[] = [];

/**
 * The CJK families this host actually has, in fallback order.
 *
 * Empty on a host with no CJK font at all, which is a real state rather than a
 * failure: the cards still draw, Han and Hangul just come out as `□`. Exposed
 * so a test can tell "this host cannot render it" apart from "the renderer
 * stopped rendering it" — the two look identical in the pixels.
 */
export function cjkFallbackFamilies(): readonly string[] {
  registerFonts();
  return cjkFamilies;
}

function firstExisting(paths: readonly string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

function fontFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.(ttf|otf|ttc)$/i.test(file))
    .sort()
    .map((file) => join(dir, file));
}

/**
 * Registers every `.ttf`/`.otf` directly inside `assets/fonts` under
 * {@link UI_FONT}.
 *
 * Dropping a font family in that folder is the supported way to rebrand the
 * cards without touching code. The `cjk` subfolder is handled separately, so
 * it is skipped here.
 */
function registerBundledFonts(): boolean {
  const files = fontFilesIn(ASSET_FONT_DIR);
  for (const file of files) {
    GlobalFonts.registerFromPath(file, UI_FONT);
  }
  return files.length > 0;
}

/**
 * Registers the CJK fallback chain: bundled fonts first, then whatever the
 * host provides.
 *
 * Each file gets its own family because a fallback only happens *between*
 * families — several faces registered under one name would leave the renderer
 * with a single winner and the same missing glyphs.
 */
function registerCjkFonts(): void {
  const families: string[] = [];
  const files = [...fontFilesIn(ASSET_CJK_DIR), ...SYSTEM_CJK_CANDIDATES.filter(existsSync)];

  for (const file of files) {
    const family = `MusicBotCJK${families.length}`;
    if (GlobalFonts.registerFromPath(file, family)) families.push(family);
  }

  cjkFamilies = families;
}

/**
 * Makes {@link UI_FONT} resolvable by the canvas renderer.
 *
 * Safe to call repeatedly — registration happens once per process.
 */
export function registerFonts(): void {
  if (registered) return;
  registered = true;

  const bundled = registerBundledFonts();

  if (!bundled) {
    const regular = firstExisting(SYSTEM_FONT_CANDIDATES);
    const bold = firstExisting(SYSTEM_BOLD_CANDIDATES);

    // When nothing matches, `UI_FONT` stays unregistered and the CSS fallback
    // chain in `font()` lands on the renderer's built-in sans family.
    if (regular) GlobalFonts.registerFromPath(regular, UI_FONT);
    if (bold) GlobalFonts.registerFromPath(bold, UI_FONT);
  }

  registerCjkFonts();

  const emoji = firstExisting(SYSTEM_EMOJI_CANDIDATES);
  if (emoji) GlobalFonts.registerFromPath(emoji, EMOJI_FONT);
}

/** Families in the order the renderer should try them, most specific first. */
function fallbackChain(): string {
  return [UI_FONT, ...cjkFamilies, EMOJI_FONT].map((family) => `"${family}"`).join(', ');
}

/**
 * Builds a CSS font shorthand for {@link UI_FONT} with CJK and emoji
 * fallbacks.
 *
 * Registration is idempotent, so asking for a font before the cards start
 * drawing is safe and keeps the chain honest about what this host has.
 */
export function font(size: number, weight: 'regular' | 'bold' = 'regular'): string {
  registerFonts();
  const cssWeight = weight === 'bold' ? '700' : '400';
  return `${cssWeight} ${size}px ${fallbackChain()}, sans-serif`;
}
