import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  engines: { node: string };
};

/**
 * Scripts that boot the bot, as opposed to the ones that compile, lint or
 * render previews.
 */
const BOOT_SCRIPTS = ['start', 'start:sharded', 'dev'];

describe('loading .env', () => {
  /**
   * Nothing in the source reads a `.env` file: `loadEnv` parses `process.env`
   * and the project has no dotenv dependency. The README nonetheless tells a
   * newcomer to copy `.env.example` to `.env` and run `npm run dev`, which
   * used to fail at boot with DISCORD_TOKEN required -- the file was written
   * but never read. Node loads it instead, so the flag has to stay on every
   * entry point, including any added later.
   */
  it.each(BOOT_SCRIPTS)('is done by the %s script', (name) => {
    expect(pkg.scripts[name]).toContain('--env-file-if-exists=.env');
  });

  // `--env-file-if-exists` arrived in Node 20.12. Claiming >=20 would let the
  // bot install on a runtime where every one of those scripts fails outright.
  it('is declared as a Node version that actually has the flag', () => {
    expect(pkg.engines.node).toBe('>=20.12');
  });
});
