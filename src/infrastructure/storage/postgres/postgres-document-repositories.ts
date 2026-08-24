import type { SessionRepository } from '../../../application/session';
import type { PlayerSession } from '../../../application/session';
import type { SettingsRepository } from '../../../application/settings';
import type { StatsRepository } from '../../../application/stats';
import type { GuildSettings } from '../../../domain/settings';
import type { GuildStats } from '../../../domain/stats';

import type { SqlClient } from './client';

/**
 * Settings, stats and sessions in Postgres.
 *
 * All three are one document per guild, read and written whole, and none of
 * them is ever queried by a field inside — nothing asks "which guilds have
 * 24/7 on". So each is a `guild_id` and a JSONB blob rather than a column per
 * setting: a new setting is then a change to the domain type and nothing else,
 * where a wide table would make it a migration every time.
 *
 * The shapes they store are the same ones the JSON stores write, so a bot can
 * be pointed at a database and back without its data meaning something
 * different on either side.
 */

interface DocumentRow<Document> {
  document: Document;
}

/** Guild settings, keyed by guild. */
export class PostgresSettingsRepository implements SettingsRepository {
  constructor(private readonly client: SqlClient) {}

  async find(guildId: string): Promise<GuildSettings | undefined> {
    const { rows } = await this.client.query<DocumentRow<GuildSettings>>(
      `SELECT settings AS document FROM guild_settings WHERE guild_id = $1`,
      [guildId],
    );

    return rows[0]?.document;
  }

  async save(settings: GuildSettings): Promise<void> {
    await this.client.query(
      `INSERT INTO guild_settings (guild_id, settings) VALUES ($1, $2::jsonb)
       ON CONFLICT (guild_id) DO UPDATE SET settings = EXCLUDED.settings`,
      [settings.guildId, JSON.stringify(settings)],
    );
  }
}

/** Listening stats, keyed by guild. */
export class PostgresStatsRepository implements StatsRepository {
  constructor(private readonly client: SqlClient) {}

  async find(guildId: string): Promise<GuildStats | undefined> {
    const { rows } = await this.client.query<DocumentRow<GuildStats>>(
      `SELECT stats AS document FROM guild_stats WHERE guild_id = $1`,
      [guildId],
    );

    return rows[0]?.document;
  }

  async save(stats: GuildStats): Promise<void> {
    await this.client.query(
      `INSERT INTO guild_stats (guild_id, stats) VALUES ($1, $2::jsonb)
       ON CONFLICT (guild_id) DO UPDATE SET stats = EXCLUDED.stats`,
      [stats.guildId, JSON.stringify(stats)],
    );
  }
}

/**
 * Live sessions, so a restart picks the queue back up.
 *
 * `saved_at` is a column of its own rather than a field inside the document
 * because it is the one thing that *is* queried: a session older than the
 * restore window is not resumed, and that is a `WHERE` clause rather than a
 * read of every row the bot has ever written.
 */
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly client: SqlClient) {}

  async all(): Promise<PlayerSession[]> {
    const { rows } = await this.client.query<DocumentRow<PlayerSession>>(
      `SELECT session AS document FROM player_sessions ORDER BY saved_at DESC`,
    );

    return rows.map((row) => row.document);
  }

  async save(session: PlayerSession): Promise<void> {
    await this.client.query(
      `INSERT INTO player_sessions (guild_id, session, saved_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (guild_id) DO UPDATE SET
         session = EXCLUDED.session,
         saved_at = EXCLUDED.saved_at`,
      [session.guildId, JSON.stringify(session), session.savedAt],
    );
  }

  async delete(guildId: string): Promise<void> {
    await this.client.query(`DELETE FROM player_sessions WHERE guild_id = $1`, [guildId]);
  }
}
