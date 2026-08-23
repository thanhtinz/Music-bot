/**
 * Renders every canvas card into `preview/` so the UI can be reviewed without
 * a Discord token, a Lavalink node, or a running bot.
 *
 * Usage: `npm run preview:canvas`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { catalogByCategory } from '../src/commands/catalog';
import { createTrack, Queue } from '../src/domain/music';
import {
  QUEUE_PAGE_SIZE,
  renderHelpCard,
  renderNowPlayingCard,
  renderQueueCard,
  type NowPlayingCardData,
} from '../src/ui/canvas';

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

const SAMPLE_QUEUE: Array<[string, string, number, string]> = [
  ['Faded', 'Alan Walker', 212_000, 'thanhtinz'],
  ['Shape of You', 'Ed Sheeran', 233_000, 'minh'],
  ['Lạc Trôi', 'Sơn Tùng M-TP', 231_000, 'thanhtinz'],
  ['Blinding Lights', 'The Weeknd', 200_000, 'linh'],
  ['Levitating', 'Dua Lipa feat. DaBaby', 203_000, 'khanh'],
  ['Anh Đếch Cần Gì Nhiều Ngoài Em', 'Đen Vâu', 285_000, 'minh'],
  ['Stay', 'The Kid LAROI & Justin Bieber', 141_000, 'thanhtinz'],
  ['Hãy Trao Cho Anh', 'Sơn Tùng M-TP feat. Snoop Dogg', 259_000, 'linh'],
  ['Alone, Pt. II', 'Alan Walker & Ava Max', 179_000, 'khanh'],
  ['Waiting For Love', 'Avicii', 230_000, 'minh'],
  ['Bones', 'Imagine Dragons', 165_000, 'linh'],
  ['Nevada', 'Vicetone feat. Cozi Zuehlsdorff', 216_000, 'thanhtinz'],
];

/**
 * Builds the queue card from a real domain {@link Queue} rather than a literal,
 * so the preview also exercises the queue logic end to end.
 */
async function renderQueuePreview(): Promise<Buffer> {
  const queue = new Queue({ maxSize: 200 });
  queue.add(
    SAMPLE_QUEUE.map(([title, author, durationMs, requesterId]) =>
      createTrack({
        source: 'youtube',
        identifier: title.toLowerCase().replace(/\s+/g, '-'),
        title,
        author,
        durationMs,
        requesterId,
      }),
    ),
  );

  const current = queue.next();
  const page = queue.tracks.slice(0, QUEUE_PAGE_SIZE);

  return renderQueueCard({
    current: current && {
      title: current.title,
      author: current.author,
      durationMs: current.durationMs,
      positionMs: 78_000,
    },
    tracks: page.map((track, index) => ({
      position: index + 1,
      title: track.title,
      author: track.author,
      durationMs: track.durationMs,
      isStream: track.isStream,
      requesterName: track.requesterId,
    })),
    page: 1,
    totalPages: Math.ceil(queue.size / QUEUE_PAGE_SIZE),
    totalTracks: queue.size,
    totalDurationMs: queue.totalDurationMs,
    loop: queue.loop,
    theme: 'midnight',
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const scenario of scenarios) {
    const buffer = await renderNowPlayingCard(scenario.data);
    const path = resolve(OUT_DIR, scenario.file);
    writeFileSync(path, buffer);
    console.log(`rendered ${scenario.file} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  }

  const queueCard = await renderQueuePreview();
  writeFileSync(resolve(OUT_DIR, 'queue.png'), queueCard);
  console.log(`rendered queue.png (${(queueCard.byteLength / 1024).toFixed(1)} KB)`);

  const helpCard = await renderHelpCard({
    groups: [...catalogByCategory()].map(([category, commands]) => ({
      title: CATEGORY_TITLES[category] ?? category,
      commands: commands.map((meta) => ({
        name: meta.name,
        description: meta.description,
        aliases: meta.aliases,
      })),
    })),
    prefix: '!',
    botName: 'MusicBot',
    theme: 'midnight',
  });
  writeFileSync(resolve(OUT_DIR, 'help.png'), helpCard);
  console.log(`rendered help.png (${(helpCard.byteLength / 1024).toFixed(1)} KB)`);
}

const CATEGORY_TITLES: Record<string, string> = {
  playback: 'Playback',
  queue: 'Queue',
  playlist: 'Playlist & lyrics',
  filters: 'Filters',
  settings: 'Server settings',
  general: 'General',
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
