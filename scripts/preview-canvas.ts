/**
 * Renders every canvas card into `preview/` so the UI can be reviewed without
 * a Discord token, a Lavalink node, or a running bot.
 *
 * Usage: `npm run preview:canvas`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EventEmitter } from 'node:events';

import { Player } from '../src/application/player';
import { catalogByCategory } from '../src/commands/catalog';
import { createTrack, Queue, type Track } from '../src/domain/music';
import type { AudioBackend, AudioBackendEmitter } from '../src/infrastructure/audio/audio-backend';
import {
  configureCardEncoding,
  paginateSakuraQueue,
  QUEUE_PAGE_SIZE,
  renderHelpCard,
  renderNowPlayingCard,
  renderQueueCard,
  renderSakuraHelpCard,
  renderSakuraNoticeCard,
  renderSakuraPlaylistCard,
  type NowPlayingCardData,
} from '../src/ui/canvas';

const OUT_DIR = resolve(__dirname, '../preview');

// The bot ships WebP, but these files are committed and shown in the README,
// where a `.png` holding WebP bytes is an image GitHub will not draw. The
// drawing is the same either way — quality 90 is indistinguishable from the
// PNG at 2x zoom — so the preview renders the container it can display.
configureCardEncoding({ format: 'png' });

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

/**
 * Minimal backend that accepts every call and reports a fixed position.
 *
 * Enough to drive a real {@link Player} through a real session so the preview
 * renders from `player.snapshot()` rather than from hand-written card data.
 */
class PreviewAudioBackend implements AudioBackend {
  readonly events: AudioBackendEmitter = new EventEmitter();
  private positionMs = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async play(_guildId: string, _track: Track): Promise<void> {
    this.positionMs = 0;
  }
  async stop(): Promise<void> {}
  async setPaused(): Promise<void> {}
  async seek(_guildId: string, positionMs: number): Promise<void> {
    this.positionMs = positionMs;
  }
  async setVolume(): Promise<void> {}
  async setFilter(): Promise<void> {}
  position(): number {
    return this.positionMs;
  }
}

/** Renders the Now Playing card straight from a live player snapshot. */
async function renderPlayerPreview(): Promise<Buffer> {
  const player = new Player(new PreviewAudioBackend(), {
    guildId: 'preview',
    voiceChannelId: 'voice',
    volume: 85,
  });

  await player.connect();
  await player.enqueue(
    SAMPLE_QUEUE.slice(0, 6).map(([title, author, durationMs, requesterId]) =>
      createTrack({
        source: 'youtube',
        identifier: title.toLowerCase(),
        title,
        author,
        durationMs,
        requesterId,
      }),
    ),
  );
  player.loop = 'queue';
  player.autoplay = true;
  await player.seek(96_000);

  const snapshot = player.snapshot();

  return renderNowPlayingCard({
    title: snapshot.current?.title ?? 'Nothing playing',
    author: snapshot.current?.author ?? '',
    durationMs: snapshot.current?.durationMs ?? 0,
    positionMs: snapshot.positionMs,
    isStream: snapshot.current?.isStream,
    paused: snapshot.status === 'paused',
    requesterName: snapshot.current?.requesterId ?? 'unknown',
    volume: snapshot.volume,
    loop: snapshot.loop,
    autoplay: snapshot.autoplay,
    queueLength: snapshot.queueLength,
    filterPreset: snapshot.filterPreset,
    source: snapshot.current?.source,
    theme: 'midnight',
  });
}

/**
 * Illustrated queue card, also built from a real {@link Queue} so the row
 * numbering and durations come from the domain rather than from literals.
 */
async function renderSakuraQueuePreview(page = 1): Promise<Buffer> {
  const queue = new Queue({ maxSize: 50 });
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
  const slice = paginateSakuraQueue(queue.tracks, page);

  return renderQueueCard({
    current: current && {
      title: current.title,
      author: current.author,
      durationMs: current.durationMs,
      positionMs: 42_000,
    },
    tracks: slice.items.map((track, index) => ({
      // Positions continue across pages: page 2 starts at 5, not at 1. They
      // count the upcoming list, which is what `remove` and `jump` take.
      position: slice.firstPosition + index,
      title: track.title,
      author: track.author,
      durationMs: track.durationMs,
      isStream: track.isStream,
      requesterName: track.requesterId,
    })),
    page: slice.page,
    totalPages: slice.totalPages,
    totalTracks: queue.size,
    totalDurationMs: queue.totalDurationMs,
    loop: queue.loop,
    variant: 'sakura',
  });
}

/**
 * Illustrated command list, driven by the real catalog so the sidebar counts
 * and the rows stay in step with what the bot actually registers.
 */
async function renderSakuraHelpPreview(): Promise<Buffer> {
  const grouped = [...catalogByCategory()];
  const active = grouped.findIndex(([category]) => category === 'playback');

  return renderSakuraHelpCard({
    prefix: '/',
    activeCategory: Math.max(0, active),
    categories: grouped.map(([category, commands]) => ({
      // The sidebar column is narrow, so it takes the short category names.
      title: SIDEBAR_TITLES[category] ?? category,
      count: commands.length,
      icon: category,
    })),
    commands: (grouped[Math.max(0, active)]?.[1] ?? []).map((meta) => ({
      name: meta.name,
      args: meta.options?.[0]?.required ? `<${meta.options[0].name}>` : undefined,
      description: meta.description,
    })),
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

  const sakuraQueue = await renderSakuraQueuePreview();
  writeFileSync(resolve(OUT_DIR, 'queue-sakura.png'), sakuraQueue);
  console.log(`rendered queue-sakura.png (${(sakuraQueue.byteLength / 1024).toFixed(1)} KB)`);

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

  const sakura = await renderNowPlayingCard({
    title: 'Chăm Hoa',
    author: 'MONO',
    durationMs: 3 * 60_000 + 31_000,
    positionMs: 1 * 60_000 + 24_000,
    requesterName: 'thanhtinz',
    volume: 70,
    loop: 'off',
    queueLength: 8,
    source: 'youtube',
    variant: 'sakura',
  });
  writeFileSync(resolve(OUT_DIR, 'now-playing-sakura.png'), sakura);
  console.log(`rendered now-playing-sakura.png (${(sakura.byteLength / 1024).toFixed(1)} KB)`);

  const sakuraPaused = await renderNowPlayingCard({
    title: 'Waiting For Love',
    author: 'Avicii',
    durationMs: 3 * 60_000 + 50_000,
    positionMs: 3 * 60_000 + 12_000,
    paused: true,
    requesterName: 'linh',
    volume: 55,
    loop: 'queue',
    queueLength: 3,
    source: 'spotify',
    variant: 'sakura',
  });
  writeFileSync(resolve(OUT_DIR, 'now-playing-sakura-paused.png'), sakuraPaused);
  console.log(
    `rendered now-playing-sakura-paused.png (${(sakuraPaused.byteLength / 1024).toFixed(1)} KB)`,
  );

  const sakuraQueuePage3 = await renderSakuraQueuePreview(3);
  writeFileSync(resolve(OUT_DIR, 'queue-sakura-page3.png'), sakuraQueuePage3);
  console.log(
    `rendered queue-sakura-page3.png (${(sakuraQueuePage3.byteLength / 1024).toFixed(1)} KB)`,
  );

  const sakuraHelp = await renderSakuraHelpPreview();
  writeFileSync(resolve(OUT_DIR, 'help-sakura.png'), sakuraHelp);
  console.log(`rendered help-sakura.png (${(sakuraHelp.byteLength / 1024).toFixed(1)} KB)`);

  const playlistCard = await renderSakuraPlaylistCard({
    ownerName: 'thanhtinz',
    totalCount: 9,
    page: 1,
    totalPages: 2,
    prefix: '/',
    entries: [
      {
        name: 'Chill Tối Muộn',
        trackCount: 42,
        totalDurationMs: 9_240_000,
        ownerName: 'thanhtinz',
      },
      { name: 'V-Pop Hits', trackCount: 18, totalDurationMs: 4_020_000, ownerName: 'thanhtinz' },
      {
        name: 'Lo-fi Study',
        trackCount: 120,
        totalDurationMs: 24_600_000,
        ownerName: 'thanhtinz',
        visibility: 'private',
      },
      { name: 'Workout Energy', trackCount: 27, totalDurationMs: 6_300_000, ownerName: 'minh' },
      { name: 'Sơn Tùng M-TP', trackCount: 33, totalDurationMs: 7_800_000, ownerName: 'linh' },
      {
        name: 'Anime OST Collection',
        trackCount: 8,
        totalDurationMs: 1_980_000,
        ownerName: 'khanh',
        visibility: 'private',
      },
    ],
  });
  writeFileSync(resolve(OUT_DIR, 'playlist-sakura.png'), playlistCard);
  console.log(`rendered playlist-sakura.png (${(playlistCard.byteLength / 1024).toFixed(1)} KB)`);

  for (const notice of NOTICES) {
    const card = await renderSakuraNoticeCard(notice.data);
    writeFileSync(resolve(OUT_DIR, notice.file), card);
    console.log(`rendered ${notice.file} (${(card.byteLength / 1024).toFixed(1)} KB)`);
  }

  const playerCard = await renderPlayerPreview();
  writeFileSync(resolve(OUT_DIR, 'now-playing-live-player.png'), playerCard);
  console.log(
    `rendered now-playing-live-player.png (${(playerCard.byteLength / 1024).toFixed(1)} KB)`,
  );
}

/** One notice per tone, so a change of palette is visible in the preview. */
const NOTICES: Array<{ file: string; data: Parameters<typeof renderSakuraNoticeCard>[0] }> = [
  {
    file: 'notice-volume.png',
    data: { title: 'Volume', message: 'Volume set to **85%**.', icon: 'volume' },
  },
  {
    file: 'notice-queued.png',
    data: {
      title: 'Added to queue',
      message: 'Added **Chăm Hoa** to the queue.',
      icon: 'plus',
    },
  },
  {
    file: 'notice-nothing-playing.png',
    data: {
      title: 'Nothing playing',
      message: 'Nothing is playing right now. Start something with **/play**.',
      icon: 'note',
      tone: 'warning',
    },
  },
  {
    file: 'notice-error.png',
    data: {
      title: 'That did not work',
      message: 'The audio node is unreachable. Give it a moment and try again.',
      tone: 'error',
    },
  },
];

const SIDEBAR_TITLES: Record<string, string> = {
  playback: 'Player',
  queue: 'Queue',
  playlist: 'Playlist',
  filters: 'Filters',
  settings: 'Settings',
  general: 'General',
};

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
