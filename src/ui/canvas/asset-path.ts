import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** How far up the tree to look before giving up. */
const MAX_DEPTH = 10;

/**
 * Finds the `assets` folder by walking up from `startDir`.
 *
 * The number of `..` segments between a module and the assets is not fixed:
 * `src/ui/canvas/fonts.ts` sits three levels below the package root, but the
 * very same file compiled to `dist/src/ui/canvas/fonts.js` sits four, and the
 * assets are never copied into `dist` — the Dockerfile puts them beside it.
 * Counting segments therefore works in development and silently resolves to a
 * folder that does not exist in production, which is how a built bot ends up
 * unable to draw a sakura card or load its bundled font.
 *
 * A folder only counts when it holds both `package.json` and `assets`, so an
 * unrelated `assets` directory somewhere above the checkout cannot capture the
 * search.
 */
export function findAssetRoot(startDir: string): string {
  let dir = startDir;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'assets'))) {
      return join(dir, 'assets');
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Nothing matched: fall back to the development layout so the caller reports
  // a missing file at a path a human recognises rather than at the filesystem
  // root.
  return resolve(startDir, '../../../assets');
}

/** Absolute path of the shipped `assets` folder. */
export const ASSET_ROOT = findAssetRoot(__dirname);

/** Builds a path inside the shipped `assets` folder. */
export function assetPath(...segments: string[]): string {
  return join(ASSET_ROOT, ...segments);
}
