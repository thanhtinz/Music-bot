/**
 * Renders every canvas card into `preview/` so the UI can be reviewed without
 * a Discord token, a Lavalink node, or a running bot.
 *
 * Usage: `npm run preview:canvas`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderNowPlayingCard, type NowPlayingCardData } from '../src/ui/canvas';

const OUT_DIR = resolve(__dirname, '../preview');

const scenarios: Array<{ file: string; data: NowPlayingCardData }> = [
  {
    file: 'now-playing-default.png',
    data: {
      title: 'Chạy Ngay Đi',
      author: 'Sơn Tùng M-TP',
      durationMs: 4 * 60_000 + 12_000,
      positionMs: 1 * 60_000 + 47_000,
      requesterName: 'thanhtinz',
      volume: 70,
      loop: 'off',
      queueLength: 12,
      source: 'youtube',
      theme: 'midnight',
    },
  },
  {
    file: 'now-playing-paused.png',
    data: {
      title: 'Nevada (Extended Mix) — a very long track title that has to be truncated cleanly',
      author: 'Vicetone feat. Cozi Zuehlsdorff',
      durationMs: 5 * 60_000 + 36_000,
      positionMs: 4 * 60_000 + 58_000,
      paused: true,
      requesterName: 'DJ_Nightcore_2007',
      volume: 100,
      loop: 'queue',
      autoplay: true,
      queueLength: 148,
      filterPreset: 'nightcore',
      source: 'spotify',
      theme: 'sunset',
    },
  },
  {
    file: 'now-playing-radio.png',
    data: {
      title: 'Lo-fi Hip Hop Radio — beats to relax/study to',
      author: 'ChilledCow Radio',
      durationMs: 0,
      positionMs: 0,
      isStream: true,
      requesterName: 'admin',
      volume: 45,
      loop: 'off',
      queueLength: 0,
      source: 'radio',
      theme: 'forest',
    },
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const scenario of scenarios) {
    const buffer = await renderNowPlayingCard(scenario.data);
    const path = resolve(OUT_DIR, scenario.file);
    writeFileSync(path, buffer);
    console.log(`rendered ${scenario.file} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
