import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ASSET_ROOT, assetPath, findAssetRoot } from '../../src/ui/canvas/asset-path';

const made: string[] = [];

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), 'asset-root-'));
  made.push(root);
  return root;
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('findAssetRoot', () => {
  it('finds the assets folder from a source layout', () => {
    const app = scaffold();
    writeFileSync(join(app, 'package.json'), '{}');
    mkdirSync(join(app, 'assets'));
    mkdirSync(join(app, 'src', 'ui', 'canvas'), { recursive: true });

    expect(findAssetRoot(join(app, 'src', 'ui', 'canvas'))).toBe(join(app, 'assets'));
  });

  /**
   * The regression this exists for: `tsc` keeps `rootDir` in the output, so a
   * module lands one level deeper than it sat in the source tree while the
   * assets stay next to `dist`. A fixed `../../../` reaches `dist/assets`,
   * which is never created.
   */
  it('finds the same folder from the compiled layout, one level deeper', () => {
    const app = scaffold();
    writeFileSync(join(app, 'package.json'), '{}');
    mkdirSync(join(app, 'assets'));
    mkdirSync(join(app, 'dist', 'src', 'ui', 'canvas'), { recursive: true });

    expect(findAssetRoot(join(app, 'dist', 'src', 'ui', 'canvas'))).toBe(join(app, 'assets'));
  });

  it('ignores an unrelated assets folder with no package.json beside it', () => {
    const outer = scaffold();
    mkdirSync(join(outer, 'assets'));
    const app = join(outer, 'app');
    mkdirSync(join(app, 'dist', 'src'), { recursive: true });
    writeFileSync(join(app, 'package.json'), '{}');
    mkdirSync(join(app, 'assets'));

    expect(findAssetRoot(join(app, 'dist', 'src'))).toBe(join(app, 'assets'));
  });
});

describe('ASSET_ROOT', () => {
  it('points at a folder that actually holds the shipped assets', () => {
    expect(existsSync(assetPath('fonts'))).toBe(true);
    expect(existsSync(assetPath('templates'))).toBe(true);
    expect(existsSync(assetPath('icons'))).toBe(true);
  });

  it('never resolves inside the build output', () => {
    expect(ASSET_ROOT.split(/[\\/]/)).not.toContain('dist');
  });
});
