import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerManager } from '../../src/application/player';
import { InMemoryPlaylistRepository, PlaylistService } from '../../src/application/playlist';
import { MusicService } from '../../src/application/services/music.service';
import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { createTrack, type Track } from '../../src/domain/music';
import {
  appendTracks,
  createPlaylist,
  MAX_TRACKS_PER_PLAYLIST,
  toSavedTrack,
  type SavedTrack,
} from '../../src/domain/playlist';
import { buildCommands } from '../../src/commands/handlers';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string, requesterId = 'user'): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId,
  });
}

function saved(title: string): SavedTrack {
  return toSavedTrack(song(title));
}

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    voiceChannelId: 'voice',
    commandName: 'playlist',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'dj',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    async defer() {},
    option: () => undefined,
    ...overrides,
  } as CommandContext;

  return { ctx, replies };
}

describe('appending a batch of tracks', () => {
  const base = createPlaylist({ guildId: 'guild', ownerId: 'user', name: 'Chill' });

  it('writes them in order', () => {
    const result = appendTracks(base, [saved('One'), saved('Two')]);

    expect(result.playlist.tracks.map((track) => track.title)).toEqual(['One', 'Two']);
    expect(result.added).toBe(2);
  });

  it('skips what is already in, rather than saving it twice', () => {
    const once = appendTracks(base, [saved('One'), saved('Two')]).playlist;
    const twice = appendTracks(once, [saved('One'), saved('Two'), saved('Three')]);

    expect(twice.added).toBe(1);
    expect(twice.duplicates).toBe(2);
    expect(twice.playlist.tracks).toHaveLength(3);
  });

  it('skips a repeat inside the batch itself', () => {
    const result = appendTracks(base, [saved('One'), saved('One')]);

    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('keeps what fits and counts what does not', () => {
    // One short of the cap, so exactly one of the three lands.
    const full = createPlaylist({
      guildId: 'guild',
      ownerId: 'user',
      name: 'Full',
      tracks: Array.from({ length: MAX_TRACKS_PER_PLAYLIST - 1 }, (_, index) =>
        saved(`Filler ${index}`),
      ),
    });

    const result = appendTracks(full, [saved('A'), saved('B'), saved('C')]);

    expect(result.added).toBe(1);
    expect(result.dropped).toBe(2);
    expect(result.playlist.tracks).toHaveLength(MAX_TRACKS_PER_PLAYLIST);
  });

  it('leaves the playlist untouched when it writes nothing', () => {
    const result = appendTracks(base, []);

    expect(result.playlist).toBe(base);
    expect(result.added).toBe(0);
  });
});

describe('saving the queue', () => {
  let players: PlayerManager;
  let music: MusicService;
  let playlists: PlaylistService;
  let repository: InMemoryPlaylistRepository;

  beforeEach(async () => {
    players = new PlayerManager(new FakeAudioBackend(), { defaultVolume: 60, maxQueueSize: 50 });
    music = new MusicService(players, new ResolverRegistry(), {});
    repository = new InMemoryPlaylistRepository();
    playlists = new PlaylistService(repository, music, { prefix: '!' });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('Playing'), song('Second'), song('Third')]);
  });

  it('keeps what is playing and everything waiting, in that order', async () => {
    const { ctx, replies } = harness();

    await playlists.saveQueue(ctx, 'Tonight');

    const stored = await repository.findByName('guild', 'user', 'Tonight');
    expect(stored?.tracks.map((track) => track.title)).toEqual(['Playing', 'Second', 'Third']);
    expect(replies.at(-1)?.content).toContain('Saved 3 tracks');
  });

  it('says it made a new playlist', async () => {
    const { ctx, replies } = harness();

    await playlists.saveQueue(ctx, 'Tonight');

    expect(replies.at(-1)?.content).toContain('a new playlist');
    expect(replies.at(-1)?.title).toBe('Queue saved');
  });

  it('adds to a playlist that already exists, and counts what is in it', async () => {
    await repository.save(
      createPlaylist({
        guildId: 'guild',
        ownerId: 'user',
        name: 'Tonight',
        tracks: [saved('Older')],
      }),
    );

    const { ctx, replies } = harness();
    await playlists.saveQueue(ctx, 'Tonight');

    expect(replies.at(-1)?.content).toContain('4 tracks in it now');
  });

  it('saving the same queue twice leaves one copy', async () => {
    const { ctx, replies } = harness();

    await playlists.saveQueue(ctx, 'Tonight');
    await playlists.saveQueue(ctx, 'Tonight');

    const stored = await repository.findByName('guild', 'user', 'Tonight');
    expect(stored?.tracks).toHaveLength(3);
    expect(replies.at(-1)?.content).toContain('already had all 3 tracks');
    expect(replies.at(-1)?.title).toBe('Nothing to save');
  });

  it('leaves history out — that is what history is for', async () => {
    const player = players.get('guild')!;
    await player.skip();

    const { ctx } = harness();
    await playlists.saveQueue(ctx, 'Tonight');

    const stored = await repository.findByName('guild', 'user', 'Tonight');
    expect(stored?.tracks.map((track) => track.title)).toEqual(['Second', 'Third']);
  });

  it('refuses when there is no queue to save', async () => {
    await players.destroy('guild');
    const { ctx, replies } = harness();

    await playlists.saveQueue(ctx, 'Tonight');

    expect(replies.at(-1)?.content).toContain('queue is empty');
    expect(replies.at(-1)?.ephemeral).toBe(true);
    expect(await repository.findByName('guild', 'user', 'Tonight')).toBeUndefined();
  });

  it('refuses a playlist with no name', async () => {
    const { ctx, replies } = harness();

    await playlists.saveQueue(ctx, '   ');

    expect(replies.at(-1)?.content).toContain('needs a name');
  });

  it('says so rather than saving nothing into a full playlist', async () => {
    await repository.save(
      createPlaylist({
        guildId: 'guild',
        ownerId: 'user',
        name: 'Full',
        tracks: Array.from({ length: MAX_TRACKS_PER_PLAYLIST }, (_, index) =>
          saved(`Filler ${index}`),
        ),
      }),
    );

    const { ctx, replies } = harness();
    await playlists.saveQueue(ctx, 'Full');

    expect(replies.at(-1)?.content).toContain('is full at');
    expect(replies.at(-1)?.title).toBe('Nothing to save');
  });

  it('is reachable however the action was typed', async () => {
    const commands = buildCommands(music, { prefix: '!', botName: 'MusicBot', playlists });
    const playlist = commands.find((command) => command.name === 'playlist')!;

    for (const action of ['savequeue', 'saveall', 'snapshot']) {
      const { ctx } = harness({ args: [action, action] });
      await playlist.execute(ctx);

      expect(await repository.findByName('guild', 'user', action)).toBeDefined();
    }
  });

  it('still adds only the current track under `add`', async () => {
    const commands = buildCommands(music, { prefix: '!', botName: 'MusicBot', playlists });
    const playlist = commands.find((command) => command.name === 'playlist')!;

    const { ctx } = harness({ args: ['add', 'One', 'Song'] });
    await playlist.execute(ctx);

    const stored = await repository.findByName('guild', 'user', 'One Song');
    expect(stored?.tracks.map((track) => track.title)).toEqual(['Playing']);
  });

  it('keeps one person’s save out of another’s library', async () => {
    await playlists.saveQueue(harness().ctx, 'Tonight');

    const { ctx, replies } = harness({ userId: 'someone-else' });
    await playlists.saveQueue(ctx, 'Tonight');

    expect(replies.at(-1)?.content).toContain('a new playlist');
    expect(await repository.findByName('guild', 'someone-else', 'Tonight')).toBeDefined();
  });
});
