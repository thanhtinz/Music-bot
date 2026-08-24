import type { PlaylistRepository } from '../../application/playlist';
import { InMemoryPlaylistRepository } from '../../application/playlist';
import type { SessionRepository } from '../../application/session';
import { InMemorySessionRepository } from '../../application/session';
import type { SettingsRepository } from '../../application/settings';
import { InMemorySettingsRepository } from '../../application/settings';
import type { StatsRepository } from '../../application/stats';
import { InMemoryStatsRepository } from '../../application/stats';
import { createLogger } from '../../telemetry/logger';

import { JsonPlaylistRepository } from './json-playlist-repository';
import { JsonSessionRepository } from './json-session-repository';
import { JsonSettingsRepository } from './json-settings-repository';
import { JsonStatsRepository } from './json-stats-repository';
import {
  ensureSchema,
  PostgresClient,
  PostgresPlaylistRepository,
  PostgresSessionRepository,
  PostgresSettingsRepository,
  PostgresStatsRepository,
} from './postgres';

const logger = createLogger('stores');

/** Everything the bot persists, and how to let go of it. */
export interface Stores {
  playlists: PlaylistRepository;
  settings: SettingsRepository;
  stats: StatsRepository;
  sessions: SessionRepository;
  /** What the stores are, for the boot log and `/healthz`. */
  kind: 'postgres' | 'files';
  /** Releases connections on the way out; a no-op for the file stores. */
  close(): Promise<void>;
}

/** The subset of the environment the stores read. */
export interface StoreSettings {
  DATABASE_URL: string;
  PLAYLIST_STORE_PATH: string;
  SETTINGS_STORE_PATH: string;
  STATS_STORE_PATH: string;
  SESSION_STORE_PATH: string;
}

/**
 * Picks where everything is kept (spec §1.2, F8).
 *
 * One decision in one place rather than four `? :` scattered through the boot
 * path — the four stores have to agree about where they live, and four
 * independent choices is four chances for a deploy to keep its playlists in
 * Postgres and its settings in a file nobody mounted.
 *
 * Postgres when `DATABASE_URL` is set, files otherwise. A path left blank falls
 * back to memory, which loses that store on restart but never refuses to start:
 * a first run with nothing mounted should play music.
 */
export async function createStores(env: StoreSettings): Promise<Stores> {
  if (env.DATABASE_URL) {
    const client = new PostgresClient({ connectionString: env.DATABASE_URL });

    // Before the first read, so a bot pointed at an empty database works
    // rather than failing somebody's first `playlist list` with a missing
    // table and leaving them to find out why from the logs.
    await ensureSchema(client);
    logger.info('using Postgres for playlists, settings, stats and sessions');

    return {
      playlists: new PostgresPlaylistRepository(client),
      settings: new PostgresSettingsRepository(client),
      stats: new PostgresStatsRepository(client),
      sessions: new PostgresSessionRepository(client),
      kind: 'postgres',
      close: () => client.end(),
    };
  }

  logger.info('using JSON files for playlists, settings, stats and sessions');

  return {
    playlists: env.PLAYLIST_STORE_PATH
      ? new JsonPlaylistRepository(env.PLAYLIST_STORE_PATH)
      : new InMemoryPlaylistRepository(),
    settings: env.SETTINGS_STORE_PATH
      ? new JsonSettingsRepository(env.SETTINGS_STORE_PATH)
      : new InMemorySettingsRepository(),
    stats: env.STATS_STORE_PATH
      ? new JsonStatsRepository(env.STATS_STORE_PATH)
      : new InMemoryStatsRepository(),
    sessions: env.SESSION_STORE_PATH
      ? new JsonSessionRepository(env.SESSION_STORE_PATH)
      : new InMemorySessionRepository(),
    kind: 'files',
    close: async () => undefined,
  };
}
