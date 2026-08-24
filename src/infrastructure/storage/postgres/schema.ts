import { createLogger } from '../../../telemetry/logger';

import type { SqlClient } from './client';

const logger = createLogger('postgres-schema');

/**
 * The tables the bot needs, as statements that are safe to re-run.
 *
 * `IF NOT EXISTS` throughout rather than a numbered migration tool: there is
 * one writer and the shape is small enough that "make sure these exist" is the
 * whole migration story. When that stops being true — a column that has to be
 * backfilled, a type that has to change — this is where a real migration table
 * goes, and the boot path already calls it in the right place.
 *
 * Everything is keyed the way the ports read it. Playlists are looked up by
 * owner and by folded name, so that pair is indexed; the rest are one row per
 * guild and the primary key is the lookup.
 */
const STATEMENTS: readonly string[] = [
  // `name_folded` is `normalizePlaylistName` applied before the insert rather
  // than an expression the database computes: a name is matched case- and
  // whitespace-insensitively, and having two implementations of that rule is
  // having two rules. The application owns it; this column is where it lands.
  `CREATE TABLE IF NOT EXISTS playlists (
     id           TEXT PRIMARY KEY,
     guild_id     TEXT NOT NULL,
     owner_id     TEXT NOT NULL,
     name         TEXT NOT NULL,
     name_folded  TEXT NOT NULL,
     visibility   TEXT NOT NULL,
     tracks       JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at   BIGINT NOT NULL,
     updated_at   BIGINT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS playlists_owner_idx
     ON playlists (guild_id, owner_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS playlists_name_idx
     ON playlists (guild_id, owner_id, name_folded)`,

  `CREATE TABLE IF NOT EXISTS guild_settings (
     guild_id  TEXT PRIMARY KEY,
     settings  JSONB NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS guild_stats (
     guild_id  TEXT PRIMARY KEY,
     stats     JSONB NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS player_sessions (
     guild_id  TEXT PRIMARY KEY,
     session   JSONB NOT NULL,
     saved_at  BIGINT NOT NULL
   )`,
];

/**
 * Creates anything missing, and leaves anything present alone.
 *
 * Run at boot before the first read: a bot that starts against an empty
 * database should work, not fail its first `playlist list` with a missing
 * table and leave somebody reading logs to find out why.
 */
export async function ensureSchema(client: SqlClient): Promise<void> {
  for (const statement of STATEMENTS) {
    await client.query(statement);
  }

  logger.info({ tables: 4 }, 'database schema is ready');
}
