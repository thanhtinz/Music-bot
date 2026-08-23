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

/**
 * System fonts that carry a full Latin + Vietnamese diacritic coverage,
 * ordered by preference. The first hit wins.
 */
const SYSTEM_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
];

const SYSTEM_BOLD_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:\\Windows\\Fonts\\arialbd.ttf',
];

const SYSTEM_EMOJI_CANDIDATES = [
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf',
  '/System/Library/Fonts/Apple Color Emoji.ttc',
  'C:\\Windows\\Fonts\\seguiemj.ttf',
];

let registered = false;

function firstExisting(paths: readonly string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

/**
 * Registers every `.ttf`/`.otf` inside `assets/fonts` under {@link UI_FONT}.
 *
 * Dropping a font family in that folder is the supported way to rebrand the
 * cards without touching code.
 */
function registerBundledFonts(): boolean {
  if (!existsSync(ASSET_FONT_DIR)) return false;

  const files = readdirSync(ASSET_FONT_DIR).filter((file) => /\.(ttf|otf)$/i.test(file));
  for (const file of files) {
    GlobalFonts.registerFromPath(join(ASSET_FONT_DIR, file), UI_FONT);
  }
  return files.length > 0;
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

  const emoji = firstExisting(SYSTEM_EMOJI_CANDIDATES);
  if (emoji) GlobalFonts.registerFromPath(emoji, EMOJI_FONT);
}

/** Builds a CSS font shorthand for {@link UI_FONT} with an emoji fallback. */
export function font(size: number, weight: 'regular' | 'bold' = 'regular'): string {
  const cssWeight = weight === 'bold' ? '700' : '400';
  return `${cssWeight} ${size}px "${UI_FONT}", "${EMOJI_FONT}", sans-serif`;
}
