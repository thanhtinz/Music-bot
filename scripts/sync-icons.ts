import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LUCIDE_ICON_FILES } from '../src/ui/canvas/glyphs';

/**
 * Copies the icons the cards draw out of `lucide-static` and into `assets`.
 *
 * The bot reads committed files rather than reaching into `node_modules`, the
 * way it already does for fonts and templates: the icons a card draws are part
 * of the artwork, and artwork that only exists after `npm install --include=dev`
 * is artwork a production image would be missing.
 *
 * Run after changing {@link LUCIDE_ICON_FILES}:
 *
 * ```bash
 * npm run sync:icons
 * ```
 */
const SOURCE = resolve(__dirname, '../node_modules/lucide-static');
const OUT_DIR = resolve(__dirname, '../assets/icons');

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [glyph, file] of Object.entries(LUCIDE_ICON_FILES)) {
    const from = resolve(SOURCE, 'icons', `${file}.svg`);
    const to = resolve(OUT_DIR, `${glyph}.svg`);

    // Named for the glyph rather than for the icon it came from, so renaming a
    // Lucide icon upstream is a one-line change in the map and nowhere else.
    copyFileSync(from, to);
    console.log(`${glyph.padEnd(10)} <- ${file}.svg`);
  }

  // ISC, and it asks that the notice travel with the copies.
  copyFileSync(resolve(SOURCE, 'LICENSE'), resolve(OUT_DIR, 'LICENSE'));

  const version = JSON.parse(readFileSync(resolve(SOURCE, 'package.json'), 'utf8')) as {
    version: string;
  };
  writeFileSync(
    resolve(OUT_DIR, 'README.md'),
    [
      '# Icons',
      '',
      `Drawn by [Lucide](https://lucide.dev) ${version.version}, ISC licensed — see LICENSE.`,
      '',
      'Each file is named for the glyph that draws it, not for its Lucide name;',
      '`npm run sync:icons` copies them out of `lucide-static` using the map in',
      '`src/ui/canvas/glyphs.ts`.',
      '',
    ].join('\n'),
  );

  console.log(`\n${Object.keys(LUCIDE_ICON_FILES).length} icons in ${OUT_DIR}`);
}

main();
