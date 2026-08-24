import { describe, expect, it } from 'vitest';

import { InMemoryPlaylistRepository } from '../../src/application/playlist';
import { InMemorySessionRepository } from '../../src/application/session';
import { InMemorySettingsRepository } from '../../src/application/settings';
import { InMemoryStatsRepository } from '../../src/application/stats';
import { JsonPlaylistRepository } from '../../src/infrastructure/storage/json-playlist-repository';
import { JsonSessionRepository } from '../../src/infrastructure/storage/json-session-repository';
import { JsonSettingsRepository } from '../../src/infrastructure/storage/json-settings-repository';
import { JsonStatsRepository } from '../../src/infrastructure/storage/json-stats-repository';
import { createStores, type StoreSettings } from '../../src/infrastructure/storage/stores';

function env(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    DATABASE_URL: '',
    PLAYLIST_STORE_PATH: 'data/playlists.json',
    SETTINGS_STORE_PATH: 'data/settings.json',
    STATS_STORE_PATH: 'data/stats.json',
    SESSION_STORE_PATH: 'data/sessions.json',
    ...overrides,
  };
}

describe('choosing where things are kept', () => {
  it('writes files when no database is configured', async () => {
    const stores = await createStores(env());

    expect(stores.kind).toBe('files');
    expect(stores.playlists).toBeInstanceOf(JsonPlaylistRepository);
    expect(stores.settings).toBeInstanceOf(JsonSettingsRepository);
    expect(stores.stats).toBeInstanceOf(JsonStatsRepository);
    expect(stores.sessions).toBeInstanceOf(JsonSessionRepository);
  });

  it('keeps a store in memory when its path is blank', async () => {
    // A first run with nothing mounted should play music rather than refuse to
    // start; what it loses is that store on restart, which is said out loud in
    // the README and in .env.example.
    const stores = await createStores(
      env({ PLAYLIST_STORE_PATH: '', SETTINGS_STORE_PATH: '', STATS_STORE_PATH: '' }),
    );

    expect(stores.playlists).toBeInstanceOf(InMemoryPlaylistRepository);
    expect(stores.settings).toBeInstanceOf(InMemorySettingsRepository);
    expect(stores.stats).toBeInstanceOf(InMemoryStatsRepository);
    // Not blanked, so this one is still a file.
    expect(stores.sessions).toBeInstanceOf(JsonSessionRepository);
  });

  it('keeps sessions in memory when that path is blank', async () => {
    const stores = await createStores(env({ SESSION_STORE_PATH: '' }));

    expect(stores.sessions).toBeInstanceOf(InMemorySessionRepository);
  });

  it('has nothing to close when it is only holding files', async () => {
    const stores = await createStores(env());

    await expect(stores.close()).resolves.toBeUndefined();
  });

  it('moves every store together, never some of them', async () => {
    // Four independent choices would be four chances for a deploy to keep its
    // playlists in Postgres and its settings in a file nobody mounted.
    const stores = await createStores(env());
    const kinds = [stores.playlists, stores.settings, stores.stats, stores.sessions].map((store) =>
      store.constructor.name.replace(/(Playlist|Settings|Stats|Session)Repository$/, ''),
    );

    expect(new Set(kinds).size).toBe(1);
  });
});
