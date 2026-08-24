import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  withNoticeCards,
  type CommandContext,
  type ReplyPayload,
} from '../src/application/commands';
import { PlayerManager, SleepTimer } from '../src/application/player';
import { InMemoryPlaylistRepository, PlaylistService } from '../src/application/playlist';
import { InMemorySettingsRepository, SettingsService } from '../src/application/settings';
import { SearchService } from '../src/application/search';
import { InMemoryStatsRepository, StatsService } from '../src/application/stats';
import { LyricsService } from '../src/application/services/lyrics.service';
import { MusicService } from '../src/application/services/music.service';
import { buildCommands } from '../src/commands/handlers';
import { AUTOPLAY_REQUESTER_ID, createTrack } from '../src/domain/music';
import { createGuildStats, recordPlay } from '../src/domain/stats';
import {
  LavaSrcResolver,
  ResolverRegistry,
  type SourceResolver,
  type TrackCandidate,
} from '../src/resolvers';
import { configureCardEncoding, renderSakuraNoticeCard } from '../src/ui/canvas';
import {
  buildHelpCategories,
  buildHelpPagination,
  buildNowPlayingControls,
  buildQueuePagination,
} from '../src/infrastructure/discord/components';
import { FakeAudioBackend } from '../tests/helpers/fake-audio-backend';

/**
 * Renders what the bot actually replies.
 *
 * The cards are produced by running the real services through the real reply
 * decorator, so a preview cannot drift from what a user would see: if a command
 * forgets its title or picks the wrong tone, it shows up here.
 */
const OUT_DIR = resolve(__dirname, '../preview');

// The bot ships WebP, but these files are committed and shown in the README,
// where a `.png` holding WebP bytes is an image GitHub will not draw. The
// drawing is the same either way — quality 90 is indistinguishable from the
// PNG at 2x zoom — so the preview renders the container it can display.
configureCardEncoding({ format: 'png' });

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

/**
 * Writes the first card a capture collected.
 *
 * The buttons are logged rather than drawn: they are Discord components sitting
 * under the image, not part of it, and a picture of them would be a picture of
 * something that does not exist.
 */
function save(capture: Capture, file: string): void {
  const reply = capture.saved.at(-1);
  const card = reply?.attachments?.[0];

  if (!card) {
    throw new Error(`${file}: the command replied with no card`);
  }

  writeFileSync(resolve(OUT_DIR, file), card.data);

  const buttons = describeComponents(reply?.components);
  const size = `${(card.data.byteLength / 1024).toFixed(1)} KB`;
  console.log(`rendered ${file} (${size})${buttons ? ` + buttons: ${buttons}` : ''}`);

  // The line above the card is text, not part of the image, so it is printed
  // for review the same way the buttons are.
  if (reply?.content) console.log(`   line: ${reply.content}`);
}

/** The actions behind a reply's components, as the ids encode them. */
function describeComponents(components: unknown[] | undefined): string {
  const rows = (components ?? []) as Array<{
    components?: Array<{ data?: { custom_id?: string; placeholder?: string } }>;
  }>;

  return rows
    .flatMap((row) => row.components ?? [])
    .map((component) => {
      const id = component.data?.custom_id ?? '?';
      // A menu's placeholder is the state it shows, so a stale one is visible
      // in the log rather than only in the picture.
      const placeholder = component.data?.placeholder;
      return placeholder ? `${id}(${placeholder})` : id;
    })
    .join(' ');
}

/** Stands in for the Discord channel cache. */
const CHANNEL_NAMES: Record<string, string> = {
  'voice-a': 'general-voice',
  'voice-b': 'music-room',
};

/** Canned results, so the preview needs no network. */
const SEARCH_RESULTS: TrackCandidate[] = [
  { source: 'youtube', identifier: 's1', title: 'Chăm Hoa', author: 'MONO', durationMs: 245_000 },
  {
    source: 'youtube',
    identifier: 's2',
    title: 'Chăm Hoa (Live at Đại Nhạc Hội)',
    author: 'MONO',
    durationMs: 302_000,
  },
  {
    source: 'spotify',
    identifier: 's3',
    title: 'Chăm Hoa - Lofi Version',
    author: 'Bảo Anh Remix',
    durationMs: 198_000,
  },
  {
    source: 'youtube',
    identifier: 's4',
    title: 'Chăm Hoa | Piano Cover',
    author: 'An Coong Piano',
    durationMs: 176_000,
  },
  {
    source: 'radio',
    identifier: 's5',
    title: 'V-Pop Radio · non-stop',
    author: 'Melody FM',
    durationMs: 0,
    isStream: true,
  },
];

/** A search provider with no network behind it. */
const fakeSearchResolver: SourceResolver = {
  name: 'preview',
  source: 'youtube',
  canHandle: () => true,
  search: async () => SEARCH_RESULTS,
  resolveTrack: async () => SEARCH_RESULTS[0]!,
};

/**
 * What the live bot passes its music service.
 *
 * Shared by every service the preview builds, so one of them cannot quietly
 * render a card without the buttons the real reply carries.
 */
const MUSIC_OPTIONS = {
  // The same variant the bot defaults to, so a preview shows the cards a user
  // would actually be sent rather than the classic fallback.
  variant: 'sakura' as const,
  defaultVolume: 70,
  channelName: (channelId: string) => CHANNEL_NAMES[channelId],
  nowPlayingComponents: (player: {
    status: string;
    queue: { history: readonly unknown[]; size: number };
    loop: 'off' | 'song' | 'queue';
    volume: number;
    muted: boolean;
  }) =>
    buildNowPlayingControls({
      paused: player.status === 'paused',
      hasPrevious: player.queue.history.length > 0,
      hasQueue: player.queue.size > 0,
      loop: player.loop,
      volume: player.volume,
      muted: player.muted,
    }),
  queueComponents: (page: number, totalPages: number) => buildQueuePagination(page, totalPages),
  // A real timer would keep the preview process alive long after it has drawn
  // its last card, so this one remembers what was asked for and never fires.
  sleep: new SleepTimer({
    onSleep: async () => {},
    setTimer: () => 0 as unknown as NodeJS.Timeout,
    clearTimer: () => {},
  }),
};

async function main(): Promise<void> {
  const backend = new FakeAudioBackend();
  const players = new PlayerManager(backend, { defaultVolume: 70, maxQueueSize: 100 });
  const music = new MusicService(players, new ResolverRegistry(), MUSIC_OPTIONS);
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

  // Stepping through a track: the panel is the answer, with the progress bar
  // where the jump left it.
  await player?.seek(120_000);

  const forwarded = context({ commandName: 'forward' });
  await music.nudge(forwarded.ctx, 30_000);
  save(forwarded, 'reply-forward.png');

  const replayed = context({ commandName: 'replay' });
  await music.replay(replayed.ctx);
  save(replayed, 'reply-replay.png');

  // The sleep timer, in the four states somebody can put it in.
  const sleepSet = context({ commandName: 'sleep' });
  await music.sleep(sleepSet.ctx, '45');
  save(sleepSet, 'reply-sleep-set.png');

  const sleepStatus = context({ commandName: 'sleep' });
  await music.sleep(sleepStatus.ctx, undefined);
  save(sleepStatus, 'reply-sleep-status.png');

  const sleepTrack = context({ commandName: 'sleep' });
  await music.sleep(sleepTrack.ctx, 'track');
  save(sleepTrack, 'reply-sleep-track.png');

  const sleepOff = context({ commandName: 'sleep' });
  await music.sleep(sleepOff.ctx, 'off');
  save(sleepOff, 'reply-sleep-off.png');

  const sleepUnread = context({ commandName: 'sleep' });
  await music.sleep(sleepUnread.ctx, 'soonish');
  save(sleepUnread, 'reply-sleep-invalid.png');

  // A radio stream has no position, so the refusal is what gets rendered.
  const radioPlayer = await players.getOrCreate({
    guildId: 'radio-guild',
    voiceChannelId: 'voice-a',
  });
  await radioPlayer.enqueue(
    createTrack({
      source: 'youtube',
      identifier: 'lofi-radio',
      title: 'lofi hip hop radio',
      author: 'Lofi Girl',
      durationMs: 0,
      isStream: true,
      requesterId: 'owner',
    }),
  );

  const streamStep = context({ commandName: 'forward', guildId: 'radio-guild' });
  await music.nudge(streamStep.ctx, 30_000);
  save(streamStep, 'reply-forward-stream.png');

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

  const LYRIC_LINES = [
    'Nhặt một bông hoa rơi bên hiên nhà',
    'Nhẹ nhàng đặt lên trang giấy đã ngả màu',
    '',
    'Chăm một bông hoa như chăm một người',
    'Tưới đều mỗi sáng, chờ đến lúc hoa cười',
    'Rồi một ngày kia hoa nở thật tươi',
    'Mà người thì đã đi xa mất rồi',
    '',
    'Ở lại đây với những mùa hoa cũ',
    'Ở lại đây đếm từng cánh rụng rơi',
    'Người có nghe chăng lời của gió',
    'Kể chuyện một người vẫn đứng đợi ngoài hiên',
  ];

  // A canned provider: the preview must not depend on a live lyrics service.
  const lyrics = new LyricsService(
    {
      name: 'LRCLIB',
      find: async () => ({
        title: 'Chăm Hoa',
        artist: 'MONO',
        provider: 'LRCLIB',
        text: LYRIC_LINES.join('\n'),
      }),
    },
    music,
    { pageComponents: () => [] },
  );

  // The same words with their timings, so the card can open on the line being
  // sung rather than at the top.
  const syncedLyrics = new LyricsService(
    {
      name: 'LRCLIB',
      find: async () => ({
        title: 'Chăm Hoa',
        artist: 'MONO',
        provider: 'LRCLIB',
        text: LYRIC_LINES.join('\n'),
        synced: true,
        timings: LYRIC_LINES.map((line, index) => ({ atMs: index * 4_000, line })),
      }),
    },
    music,
    { pageComponents: () => [] },
  );

  // A room of four, so an ordinary listener has to ask rather than just skip.
  const voting = new MusicService(players, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    listenerCount: () => 4,
  });

  const voteSkip = context({ commandName: 'skip', tier: 'everyone', userId: 'listener' });
  await voting.skip(voteSkip.ctx);
  save(voteSkip, 'reply-vote-skip.png');

  const lyricsCard = context({ commandName: 'lyrics' });
  await lyrics.show(lyricsCard.ctx, 'Chăm Hoa');
  save(lyricsCard, 'reply-lyrics.png');

  // Half a minute in: the seventh line is the one being sung.
  await player?.seek(30_000);
  const syncedCard = context({ commandName: 'lyrics' });
  await syncedLyrics.show(syncedCard.ctx, '');
  save(syncedCard, 'reply-lyrics-synced.png');

  const statsStore = new InMemoryStatsRepository();
  let guildStats = createGuildStats('guild', Date.UTC(2026, 6, 1));
  // Snowflake-shaped ids, because that is what a real mention resolves to.
  const PEOPLE = {
    me: '100000000000000001',
    linh: '200000000000000002',
    minh: '300000000000000003',
    khanh: '400000000000000004',
  } as const;
  const NAMES: Record<string, string> = {
    [PEOPLE.me]: 'thanhtinz',
    [PEOPLE.linh]: 'linh',
    [PEOPLE.minh]: 'minh',
    [PEOPLE.khanh]: 'khanh',
  };

  const PLAYS: Array<[string, string, string, number]> = [
    ['Chăm Hoa', 'MONO', PEOPLE.me, 24],
    ['Lạc Trôi', 'Sơn Tùng M-TP', PEOPLE.linh, 18],
    ['Faded', 'Alan Walker', PEOPLE.minh, 15],
    ['Waiting For Love', 'Avicii', PEOPLE.me, 11],
    ['Nevada', 'Vicetone', PEOPLE.khanh, 7],
    ['Bones', 'Imagine Dragons', PEOPLE.linh, 4],
    ['Hào Quang', 'MONO', PEOPLE.linh, 9],
    ['Alone', 'Alan Walker', PEOPLE.linh, 6],
  ];
  for (const [title, author, userId, plays] of PLAYS) {
    for (let index = 0; index < plays; index += 1) {
      guildStats = recordPlay(guildStats, {
        track: song(title, author),
        userId,
        listenedMs: 205_000,
        playedAt: Date.UTC(2026, 7, 20) + index * 1000,
      });
    }
  }
  await statsStore.save(guildStats);

  const stats = new StatsService(statsStore, {
    guildName: () => 'Melody Test Server',
    displayName: (userId) => NAMES[userId],
  });

  // `stats server` — the whole guild.
  const statsCard = context({ commandName: 'stats', userId: PEOPLE.me, args: ['server'] });
  await stats.show(statsCard.ctx);
  save(statsCard, 'reply-stats.png');

  // `stats` on its own — your own listening.
  const myStats = context({ commandName: 'stats', userId: PEOPLE.me });
  await stats.show(myStats.ctx);
  save(myStats, 'reply-stats-me.png');

  // `stats @linh` — somebody else's.
  const memberStats = context({
    commandName: 'stats',
    userId: PEOPLE.me,
    args: [`<@${PEOPLE.linh}>`],
  });
  await stats.show(memberStats.ctx);
  save(memberStats, 'reply-stats-member.png');

  // A queue card carrying a track the bot picked itself.
  const autoplayed = players.get('guild');
  await autoplayed?.enqueue(
    createTrack({
      source: 'youtube',
      identifier: 'picked-for-you',
      title: 'Waiting For Love',
      author: 'Avicii',
      durationMs: 230_000,
      requesterId: AUTOPLAY_REQUESTER_ID,
    }),
  );

  const autoplayQueue = context({ commandName: 'queue' });
  await music.queue(autoplayQueue.ctx, 1);
  save(autoplayQueue, 'reply-queue-autoplay.png');

  // Queue editing, on a queue with a couple of other people's tracks in it.
  const editing = players.get('guild');
  await editing?.enqueue([
    song('Faded', 'Alan Walker'),
    song('Nevada', 'Vicetone'),
    song('Bones', 'Imagine Dragons'),
  ]);

  const removed = context({ commandName: 'remove' });
  await music.remove(removed.ctx, 1);
  save(removed, 'reply-remove.png');

  const notYours = context({ commandName: 'remove', userId: 'listener', tier: 'everyone' });
  await music.remove(notYours.ctx, 1);
  save(notYours, 'reply-remove-not-yours.png');

  const badPosition = context({ commandName: 'remove' });
  await music.remove(badPosition.ctx, 99);
  save(badPosition, 'reply-remove-out-of-range.png');

  // Grabbing what is playing: the confirmation, and the refusal a closed DM
  // gets. The private message itself carries the Now Playing card.
  const grabMusic = new MusicService(players, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    guildName: () => 'Melody Test Server',
    directMessage: async () => true,
  });

  // The panel a track starting on its own posts, with nobody's command
  // waiting on it.
  const announced: ReplyPayload[] = [];
  const announcing = new MusicService(players, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    announce: async (_channelId, payload) => {
      announced.push(payload);
      return { setContent: async () => true };
    },
  });

  await announcing.announceTrack(players.get('guild')!);
  save({ ctx: joined.ctx, saved: announced }, 'reply-announce.png');

  const grabbed = context({ commandName: 'grab' });
  await grabMusic.grab(grabbed.ctx);
  save(grabbed, 'reply-grab.png');

  const dmsClosed = new MusicService(players, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    directMessage: async () => false,
  });

  const grabRefused = context({ commandName: 'grab' });
  await dmsClosed.grab(grabRefused.ctx);
  save(grabRefused, 'reply-grab-closed.png');

  // Cleanup, on a queue seeded with a repeat and a track from somebody who
  // has since left the channel.
  const cleanupPlayers = new PlayerManager(backend, { defaultVolume: 70, maxQueueSize: 100 });
  const cleanupMusic = new MusicService(cleanupPlayers, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    listenerIds: () => new Set(['owner']),
  });
  const cleanupPlayer = await cleanupPlayers.getOrCreate({
    guildId: 'cleanup-guild',
    voiceChannelId: 'voice-a',
  });
  await cleanupPlayer.enqueue([
    song('Chăm Hoa', 'MONO'),
    song('Lạc Trôi', 'Sơn Tùng M-TP'),
    song('Chăm Hoa', 'MONO'),
    { ...song('Waiting For You', 'MONO'), requesterId: 'someone-who-left' },
  ]);

  const dupes = context({ commandName: 'removedupes', guildId: 'cleanup-guild' });
  await cleanupMusic.removeDuplicates(dupes.ctx);
  save(dupes, 'reply-remove-dupes.png');

  const leftBehind = context({ commandName: 'leavecleanup', guildId: 'cleanup-guild' });
  await cleanupMusic.removeAbsent(leftBehind.ctx);
  save(leftBehind, 'reply-leave-cleanup.png');

  const mineGone = context({ commandName: 'removemine' });
  await music.removeMine(mineGone.ctx);
  save(mineGone, 'reply-remove-mine.png');

  const nothingMine = context({ commandName: 'removemine', userId: 'nobody' });
  await music.removeMine(nothingMine.ctx);
  save(nothingMine, 'reply-remove-mine-none.png');

  const movedTrack = context({ commandName: 'move' });
  await music.move(movedTrack.ctx, 1, 2);
  save(movedTrack, 'reply-move.png');

  // A Spotify link, resolved the way the live bot does it: the node hands back
  // a playable track carrying Spotify's own metadata.
  const spotifyRegistry = new ResolverRegistry();
  spotifyRegistry.register(
    new LavaSrcResolver({
      search: async () => [],
      loadUrl: async () => [
        {
          source: 'spotify',
          identifier: '4cOdK2wGLETKBW3PvgPWqT',
          title: 'Chăm Hoa',
          author: 'MONO',
          durationMs: 245_000,
        },
      ],
    }),
  );

  const spotifyMusic = new MusicService(players, spotifyRegistry, MUSIC_OPTIONS);

  const spotifyLink = context({ commandName: 'play', guildId: 'spotify-guild' });
  await spotifyMusic.play(spotifyLink.ctx, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  save(spotifyLink, 'reply-play-spotify.png');

  // The same panel with the speaker turned off: the mute button and the
  // picker's placeholder both have to say so.
  const muted = context({ commandName: 'button', guildId: 'spotify-guild' });
  await spotifyMusic.toggleMute(muted.ctx);
  save(muted, 'reply-now-playing-muted.png');

  const picked = context({ commandName: 'button', guildId: 'spotify-guild' });
  await spotifyMusic.pickVolume(picked.ctx, 25);
  save(picked, 'reply-now-playing-volume.png');

  // Apple Music and Deezer, resolved the same way: the node hands back a
  // playable track carrying that service's own metadata.
  for (const [source, guildId, title, file] of [
    ['applemusic', 'apple-guild', 'Để Mị Nói Cho Mà Nghe', 'reply-play-apple-music.png'],
    ['deezer', 'deezer-guild', 'Lạc Trôi', 'reply-play-deezer.png'],
  ] as const) {
    const registry = new ResolverRegistry();
    registry.register(
      new LavaSrcResolver({
        search: async () => [],
        loadUrl: async () => [
          {
            source,
            identifier: `${source}-1`,
            title,
            author: 'Hoàng Thùy Linh',
            durationMs: 231_000,
          },
        ],
      }),
    );

    const capture = context({ commandName: 'play', guildId });
    await new MusicService(players, registry, MUSIC_OPTIONS).play(
      capture.ctx,
      source === 'deezer'
        ? 'https://www.deezer.com/track/3135556'
        : 'https://music.apple.com/vn/album/de-mi-noi-cho-ma-nghe/1441164589?i=1441164592',
    );
    save(capture, file);
  }

  // The same link on a node with no LavaSrc plugin.
  const noPlugin = new MusicService(
    players,
    (() => {
      const registry = new ResolverRegistry();
      registry.register(new LavaSrcResolver({ search: async () => [], loadUrl: async () => [] }));
      return registry;
    })(),
    MUSIC_OPTIONS,
  );

  const spotifyOff = context({ commandName: 'play', guildId: 'spotify-off' });
  await noPlugin.play(spotifyOff.ctx, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  save(spotifyOff, 'reply-play-spotify-disabled.png');

  // History: play a few tracks through so there is something to look back on.
  const historyGuild = context({ commandName: 'history', guildId: 'history-guild' });
  const historyPlayer = await players.getOrCreate({
    guildId: 'history-guild',
    voiceChannelId: 'voice-a',
  });
  await historyPlayer.enqueue([
    song('Chăm Hoa', 'MONO'),
    song('Lạc Trôi', 'Sơn Tùng M-TP'),
    song('Faded', 'Alan Walker'),
    song('Nevada', 'Vicetone'),
  ]);
  for (let index = 0; index < 3; index += 1) {
    backend.finishTrack('history-guild', 'finished');
    await new Promise((resolve) => setImmediate(resolve));
  }

  const historyMusic = new MusicService(players, new ResolverRegistry(), {
    ...MUSIC_OPTIONS,
    guildName: () => 'Melody Test Server',
    displayName: (userId) => (userId === 'owner' ? 'thanhtinz' : undefined),
  });

  await historyMusic.history(historyGuild.ctx);
  save(historyGuild, 'reply-history.png');

  const historyEmpty = context({ commandName: 'history', guildId: 'quiet-guild' });
  await historyMusic.history(historyEmpty.ctx);
  save(historyEmpty, 'reply-history-empty.png');

  const searchRegistry = new ResolverRegistry();
  searchRegistry.register(fakeSearchResolver);
  const search = new SearchService(searchRegistry, music);

  const searched = context({ commandName: 'search' });
  await search.search(searched.ctx, 'chăm hoa');
  save(searched, 'reply-search.png');

  const searchedNothing = context({ commandName: 'search' });
  await new SearchService(new ResolverRegistry(), music).search(searchedNothing.ctx, 'zzzzz');
  save(searchedNothing, 'reply-search-empty.png');

  const pickedStale = context({ commandName: 'button', userId: 'someone-else' });
  await search.pick(pickedStale.ctx, 2);
  save(pickedStale, 'reply-search-expired.png');

  const statsUnknown = context({ commandName: 'stats', args: ['nobody'] });
  await stats.show(statsUnknown.ctx);
  save(statsUnknown, 'reply-stats-unknown-user.png');

  const settingsSheet = context({ commandName: 'settings' });
  await settings.show(settingsSheet.ctx);
  save(settingsSheet, 'reply-settings.png');

  const settingChanged = context({ commandName: 'settings' });
  await settings.set(settingChanged.ctx, 'volume', '85');
  save(settingChanged, 'reply-settings-changed.png');

  // Changing the prefix, then the help card for that guild: the card has to
  // print the prefix the guild actually answers to.
  const prefixChanged = context({ commandName: 'settings' });
  await settings.set(prefixChanged.ctx, 'prefix', '?');
  save(prefixChanged, 'reply-settings-prefix.png');

  const helpAfterPrefix = context({ commandName: 'help', sourceType: 'prefix' });
  const helpCommand = buildCommands(music, {
    prefix: '!',
    botName: 'Melody',
    settings,
    // The same rows the live bot attaches, so a page button missing from a
    // card that needs one shows up in the log.
    helpComponents: (categories, active, page, totalPages) => [
      ...buildHelpCategories(categories, active),
      ...buildHelpPagination(active + 1, page, totalPages),
    ],
  }).find((command) => command.name === 'help');
  await helpCommand?.execute(helpAfterPrefix.ctx);
  save(helpAfterPrefix, 'reply-help-guild-prefix.png');

  // The same command reached three ways: the card spells it back the way the
  // person actually typed it.
  const helpSlash = context({ commandName: 'help', sourceType: 'slash' });
  await helpCommand?.execute(helpSlash.ctx);
  save(helpSlash, 'reply-help-slash.png');

  const helpMention = context({ commandName: 'help', sourceType: 'mention' });
  await helpCommand?.execute(helpMention.ctx);
  save(helpMention, 'reply-help-mention.png');

  // A category the card could never show before: help was pinned to the first.
  const helpFilters = context({ commandName: 'help', sourceType: 'prefix', args: ['filters'] });
  await helpCommand?.execute(helpFilters.ctx);
  save(helpFilters, 'reply-help-filters.png');

  // Page two of the player category, which no longer ends at eight commands.
  const helpPage2 = context({ commandName: 'help', sourceType: 'prefix', args: ['player', '2'] });
  await helpCommand?.execute(helpPage2.ctx);
  save(helpPage2, 'reply-help-page2.png');

  const helpQueue = context({ commandName: 'help', sourceType: 'prefix', args: ['2'] });
  await helpCommand?.execute(helpQueue.ctx);
  save(helpQueue, 'reply-help-queue.png');

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
