import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPlaylist, toSavedTrack, type Playlist } from '../../src/domain/playlist';
import { createTrack } from '../../src/domain/music';
import { createGuildStats, recordPlay } from '../../src/domain/stats';
import { createSettings } from '../../src/domain/settings';
import {
  ensureSchema,
  PostgresClient,
  PostgresPlaylistRepository,
  PostgresSessionRepository,
  PostgresSettingsRepository,
  PostgresStatsRepository,
} from '../../src/infrastructure/storage/postgres';
import type { PlayerSession } from '../../src/application/session';
import { createStores } from '../../src/infrastructure/storage/stores';

/**
 * These run against a real database, and are skipped without one.
 *
 * A store is the one thing a fake cannot vouch for: a typo in a statement, a
 * parameter in the wrong position and a column that does not exist all look
 * fine to a recording double and fail on the first real write. CI starts a
 * Postgres service for this; locally, `DATABASE_URL=... npm test` does it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

/** Guild settings with the environment defaults the bot boots with. */
function settingsFor(guildId: string) {
  return createSettings(guildId, { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 }, 1_000);
}

function song(title: string) {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
  });
}

describeIfDatabase('Postgres storage', () => {
  let client: PostgresClient;

  beforeAll(async () => {
    client = new PostgresClient({ connectionString: DATABASE_URL });
    await ensureSchema(client);
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query('TRUNCATE playlists, guild_settings, guild_stats, player_sessions');
  });

  it('is what the boot path picks, schema and all', async () => {
    // The whole point of DATABASE_URL: everything moves, and the tables exist
    // before the first read rather than after somebody's first failed command.
    const stores = await createStores({
      DATABASE_URL: DATABASE_URL!,
      PLAYLIST_STORE_PATH: 'data/playlists.json',
      SETTINGS_STORE_PATH: 'data/settings.json',
      STATS_STORE_PATH: 'data/stats.json',
      SESSION_STORE_PATH: 'data/sessions.json',
    });

    try {
      expect(stores.kind).toBe('postgres');
      // A round trip through the store the boot path handed out, not one this
      // test built: a mis-wired store would pass every test above and still
      // leave the running bot writing to a file.
      await stores.settings.save(settingsFor('boot'));
      expect((await stores.settings.find('boot'))?.guildId).toBe('boot');
    } finally {
      await stores.close();
    }
  });

  it('creates its schema twice without complaint', async () => {
    // Boot runs this every time, including against a database that already has
    // the tables — which is the ordinary case, not the exception.
    await expect(ensureSchema(client)).resolves.toBeUndefined();
  });

  describe('playlists', () => {
    let playlists: PostgresPlaylistRepository;

    beforeEach(() => {
      playlists = new PostgresPlaylistRepository(client);
    });

    const make = (name: string, tracks: string[] = []): Playlist =>
      createPlaylist({
        guildId: 'guild',
        ownerId: 'user',
        name,
        tracks: tracks.map((title) => toSavedTrack(song(title))),
      });

    it('saves one and reads it back whole', async () => {
      const playlist = make('Chill Vibes', ['Chăm Hoa', 'Lạc Trôi']);
      await playlists.save(playlist);

      const found = await playlists.findById(playlist.id);

      expect(found).toEqual(playlist);
    });

    it('keeps the timestamps as numbers, not as the digits Postgres returns', async () => {
      // A BIGINT is wider than a JavaScript number, so the driver hands back a
      // string; a playlist whose createdAt is "1750000000000" sorts and
      // compares as text everywhere downstream.
      const playlist = make('Chill');
      await playlists.save(playlist);

      const found = await playlists.findById(playlist.id);

      expect(typeof found?.createdAt).toBe('number');
      expect(found?.createdAt).toBe(playlist.createdAt);
    });

    it('finds one by name the way somebody types it from memory', async () => {
      await playlists.save(make('Chill  Vibes'));

      const found = await playlists.findByName('guild', 'user', 'chill vibes');

      expect(found?.name).toBe('Chill Vibes');
    });

    it('keeps one owner’s library out of another’s', async () => {
      await playlists.save(make('Shared'));

      expect(await playlists.findByName('guild', 'someone-else', 'Shared')).toBeUndefined();
      expect(await playlists.findByName('other-guild', 'user', 'Shared')).toBeUndefined();
      expect(await playlists.listByOwner('guild', 'someone-else')).toEqual([]);
    });

    it('lists the most recently touched first', async () => {
      const older = { ...make('Older'), updatedAt: 1_000 };
      const newer = { ...make('Newer'), updatedAt: 2_000 };
      await playlists.save(older);
      await playlists.save(newer);

      const listed = await playlists.listByOwner('guild', 'user');

      expect(listed.map((entry) => entry.name)).toEqual(['Newer', 'Older']);
    });

    it('replaces rather than duplicating when one is saved again', async () => {
      const playlist = make('Chill', ['Chăm Hoa']);
      await playlists.save(playlist);
      await playlists.save({
        ...playlist,
        name: 'Chill Renamed',
        tracks: [...playlist.tracks, toSavedTrack(song('Lạc Trôi'))],
        updatedAt: playlist.updatedAt + 1,
      });

      const listed = await playlists.listByOwner('guild', 'user');

      expect(listed).toHaveLength(1);
      expect(listed[0]?.tracks).toHaveLength(2);
      // The folded name moves with the name, or the old one would still find it.
      expect(await playlists.findByName('guild', 'user', 'chill renamed')).toBeDefined();
      expect(await playlists.findByName('guild', 'user', 'chill')).toBeUndefined();
    });

    it('deletes one', async () => {
      const playlist = make('Chill');
      await playlists.save(playlist);
      await playlists.delete(playlist.id);

      expect(await playlists.findById(playlist.id)).toBeUndefined();
    });

    it('reads an empty playlist back as empty, not as null', async () => {
      const playlist = make('Empty');
      await playlists.save(playlist);

      expect((await playlists.findById(playlist.id))?.tracks).toEqual([]);
    });
  });

  describe('settings', () => {
    it('saves and reads a guild’s settings whole', async () => {
      const settings = new PostgresSettingsRepository(client);
      const guild = { ...settingsFor('guild'), prefix: '?', defaultVolume: 55 };

      await settings.save(guild);

      expect(await settings.find('guild')).toEqual(guild);
    });

    it('overwrites rather than piling up rows', async () => {
      const settings = new PostgresSettingsRepository(client);
      await settings.save({ ...settingsFor('guild'), prefix: '?' });
      await settings.save({ ...settingsFor('guild'), prefix: '!' });

      expect((await settings.find('guild'))?.prefix).toBe('!');
    });

    it('has nothing to say about a guild it has never seen', async () => {
      const settings = new PostgresSettingsRepository(client);

      expect(await settings.find('unknown')).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('saves and reads a guild’s counts', async () => {
      const stats = new PostgresStatsRepository(client);
      const recorded = recordPlay(createGuildStats('guild', 0), {
        track: song('Chăm Hoa'),
        userId: 'user',
        listenedMs: 200_000,
        playedAt: 1_000,
      });

      await stats.save(recorded);

      expect(await stats.find('guild')).toEqual(recorded);
    });
  });

  describe('sessions', () => {
    const session = (guildId: string, savedAt: number): PlayerSession =>
      ({
        guildId,
        voiceChannelId: 'voice',
        textChannelId: 'text',
        volume: 70,
        paused: false,
        loop: 'off',
        positionMs: 1_000,
        savedAt,
        tracks: [],
      }) as unknown as PlayerSession;

    it('saves one per guild and lists them all', async () => {
      const sessions = new PostgresSessionRepository(client);
      await sessions.save(session('a', 2_000));
      await sessions.save(session('b', 1_000));

      const all = await sessions.all();

      expect(all.map((entry) => entry.guildId)).toEqual(['a', 'b']);
    });

    it('replaces a guild’s session rather than keeping both', async () => {
      const sessions = new PostgresSessionRepository(client);
      await sessions.save(session('a', 1_000));
      await sessions.save(session('a', 2_000));

      const all = await sessions.all();

      expect(all).toHaveLength(1);
      expect(all[0]?.savedAt).toBe(2_000);
    });

    it('forgets one', async () => {
      const sessions = new PostgresSessionRepository(client);
      await sessions.save(session('a', 1_000));
      await sessions.delete('a');

      expect(await sessions.all()).toEqual([]);
    });
  });
});
