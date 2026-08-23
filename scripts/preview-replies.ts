import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  withNoticeCards,
  type CommandContext,
  type ReplyPayload,
} from '../src/application/commands';
import { PlayerManager } from '../src/application/player';
import { InMemoryPlaylistRepository, PlaylistService } from '../src/application/playlist';
import { InMemorySettingsRepository, SettingsService } from '../src/application/settings';
import { MusicService } from '../src/application/services/music.service';
import { createTrack } from '../src/domain/music';
import { ResolverRegistry } from '../src/resolvers';
import { renderSakuraNoticeCard } from '../src/ui/canvas';
import { FakeAudioBackend } from '../tests/helpers/fake-audio-backend';

/**
 * Renders what the bot actually replies.
 *
 * The cards are produced by running the real services through the real reply
 * decorator, so a preview cannot drift from what a user would see: if a command
 * forgets its title or picks the wrong tone, it shows up here.
 */
const OUT_DIR = resolve(__dirname, '../preview');

interface Capture {
  ctx: CommandContext;
  saved: ReplyPayload[];
}

function context(overrides: Partial<CommandContext> = {}): Capture {
  const saved: ReplyPayload[] = [];

  const base = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'owner',
    voiceChannelId: 'voice-a',
    commandName: 'join',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'dj',
    correlationId: 'preview',
    async reply(payload: ReplyPayload) {
      saved.push(payload);
    },
    async defer() {},
    option: () => undefined,
    ...overrides,
  } as CommandContext;

  return { ctx: withNoticeCards(base, { render: renderSakuraNoticeCard }), saved };
}

function song(title: string, author: string) {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author,
    durationMs: 212_000,
    requesterId: 'owner',
  });
}

/** Writes the first card a capture collected. */
function save(capture: Capture, file: string): void {
  const card = capture.saved.at(-1)?.attachments?.[0];

  if (!card) {
    throw new Error(`${file}: the command replied with no card`);
  }

  writeFileSync(resolve(OUT_DIR, file), card.data);
  console.log(`rendered ${file} (${(card.data.byteLength / 1024).toFixed(1)} KB)`);
}

/** Stands in for the Discord channel cache. */
const CHANNEL_NAMES: Record<string, string> = {
  'voice-a': 'general-voice',
  'voice-b': 'music-room',
};

async function main(): Promise<void> {
  const backend = new FakeAudioBackend();
  const players = new PlayerManager(backend, { defaultVolume: 70, maxQueueSize: 100 });
  const music = new MusicService(players, new ResolverRegistry(), {
    defaultVolume: 70,
    channelName: (channelId) => CHANNEL_NAMES[channelId],
  });
  const playlists = new PlaylistService(new InMemoryPlaylistRepository(), music, { prefix: '/' });
  const settings = new SettingsService(new InMemorySettingsRepository(), {
    defaults: { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 },
    guildName: () => 'Melody Test Server',
  });

  const joined = context();
  await music.join(joined.ctx);
  save(joined, 'reply-join.png');

  const alreadyHere = context();
  await music.join(alreadyHere.ctx);
  save(alreadyHere, 'reply-join-already.png');

  const moved = context({ voiceChannelId: 'voice-b' });
  await music.join(moved.ctx);
  save(moved, 'reply-join-moved.png');

  const player = players.get('guild');
  await player?.enqueue([song('Chăm Hoa', 'MONO'), song('Lạc Trôi', 'Sơn Tùng M-TP')]);

  const volume = context({ commandName: 'volume' });
  await music.setVolume(volume.ctx, 85);
  save(volume, 'reply-volume.png');

  const shuffled = context({ commandName: 'shuffle' });
  await music.shuffle(shuffled.ctx);
  save(shuffled, 'reply-shuffle.png');

  const looped = context({ commandName: 'loop' });
  await music.setLoop(looped.ctx, 'queue');
  save(looped, 'reply-loop.png');

  const created = context({ commandName: 'playlist' });
  await playlists.create(created.ctx, 'Chill Tối Muộn');
  save(created, 'reply-playlist-created.png');

  const addedToPlaylist = context({ commandName: 'playlist' });
  await playlists.addCurrent(addedToPlaylist.ctx, 'Chill Tối Muộn');
  save(addedToPlaylist, 'reply-playlist-added.png');

  const missing = context({ commandName: 'playlist' });
  await playlists.play(missing.ctx, 'Nope');
  save(missing, 'reply-playlist-missing.png');

  const favorited = context({ commandName: 'favorite' });
  await playlists.toggleFavorite(favorited.ctx);
  save(favorited, 'reply-favorite.png');

  const unfavorited = context({ commandName: 'favorite' });
  await playlists.toggleFavorite(unfavorited.ctx);
  save(unfavorited, 'reply-favorite-removed.png');

  const settingsSheet = context({ commandName: 'settings' });
  await settings.show(settingsSheet.ctx);
  save(settingsSheet, 'reply-settings.png');

  const settingChanged = context({ commandName: 'settings' });
  await settings.set(settingChanged.ctx, 'volume', '85');
  save(settingChanged, 'reply-settings-changed.png');

  const settingRejected = context({ commandName: 'settings' });
  await settings.set(settingRejected.ctx, 'volume', 'loud');
  save(settingRejected, 'reply-settings-invalid.png');

  const stayOn = context({ commandName: '247' });
  await settings.toggleStayConnected(stayOn.ctx);
  save(stayOn, 'reply-247-on.png');

  const stayOff = context({ commandName: '247' });
  await settings.toggleStayConnected(stayOff.ctx);
  save(stayOff, 'reply-247-off.png');

  // Not a command reply: the bot posts this by itself when it gives up waiting.
  for (const [file, message] of [
    [
      'reply-idle-left-alone.png',
      'Everyone left, so I stepped out too. Call me back with **join**.',
    ],
    [
      'reply-idle-left-empty.png',
      'The queue ran out, so I stepped out. Call me back with **join**.',
    ],
  ] as const) {
    const card = await renderSakuraNoticeCard({
      title: 'Left the channel',
      message,
      icon: 'stop',
      tone: 'info',
    });
    writeFileSync(resolve(OUT_DIR, file), card);
    console.log(`rendered ${file} (${(card.byteLength / 1024).toFixed(1)} KB)`);
  }

  const left = context({ commandName: 'leave' });
  await music.leave(left.ctx);
  save(left, 'reply-leave.png');

  const notConnected = context({ commandName: 'leave' });
  await music.leave(notConnected.ctx);
  save(notConnected, 'reply-leave-not-connected.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
