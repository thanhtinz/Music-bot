import { byRecentlyUpdated, type PlaylistRepository } from '../../../application/playlist';
import {
  normalizePlaylistName,
  type Playlist,
  type PlaylistVisibility,
  type SavedTrack,
} from '../../../domain/playlist';

import type { SqlClient } from './client';

/** A playlist as its row, before it is read back into the domain shape. */
interface PlaylistRow {
  id: string;
  guild_id: string;
  owner_id: string;
  name: string;
  visibility: string;
  tracks: SavedTrack[];
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, guild_id, owner_id, name, visibility, tracks, created_at, updated_at';

/**
 * Playlists in Postgres (spec §1.2, F8).
 *
 * The same port the JSON store implements, so nothing above it changes: the
 * difference is that two bot processes can now serve the same guild without
 * the second one overwriting the first one's library.
 *
 * Tracks are stored as one JSONB document per playlist rather than as a second
 * table. They are only ever read and written whole — no query asks "which
 * playlists contain this song" — so a join table would buy nothing and cost an
 * insert per track on every save.
 */
export class PostgresPlaylistRepository implements PlaylistRepository {
  constructor(private readonly client: SqlClient) {}

  async listByOwner(guildId: string, ownerId: string): Promise<Playlist[]> {
    const { rows } = await this.client.query<PlaylistRow>(
      `SELECT ${COLUMNS} FROM playlists
         WHERE guild_id = $1 AND owner_id = $2
         ORDER BY updated_at DESC`,
      [guildId, ownerId],
    );

    // Sorted again in the domain's own terms: the tie-break is by name, and
    // leaving that to the database would make the order depend on its collation
    // rather than on the rule the rest of the bot follows.
    return rows.map(toPlaylist).sort(byRecentlyUpdated);
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | undefined> {
    const { rows } = await this.client.query<PlaylistRow>(
      `SELECT ${COLUMNS} FROM playlists
         WHERE guild_id = $1 AND owner_id = $2 AND name_folded = $3
         LIMIT 1`,
      [guildId, ownerId, normalizePlaylistName(name)],
    );

    return rows[0] && toPlaylist(rows[0]);
  }

  async findById(id: string): Promise<Playlist | undefined> {
    const { rows } = await this.client.query<PlaylistRow>(
      `SELECT ${COLUMNS} FROM playlists WHERE id = $1`,
      [id],
    );

    return rows[0] && toPlaylist(rows[0]);
  }

  async save(playlist: Playlist): Promise<void> {
    await this.client.query(
      `INSERT INTO playlists
         (id, guild_id, owner_id, name, name_folded, visibility, tracks, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         name_folded = EXCLUDED.name_folded,
         visibility = EXCLUDED.visibility,
         tracks = EXCLUDED.tracks,
         updated_at = EXCLUDED.updated_at`,
      [
        playlist.id,
        playlist.guildId,
        playlist.ownerId,
        playlist.name,
        normalizePlaylistName(playlist.name),
        playlist.visibility,
        JSON.stringify(playlist.tracks),
        playlist.createdAt,
        playlist.updatedAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.query(`DELETE FROM playlists WHERE id = $1`, [id]);
  }
}

/**
 * A row as the domain sees it.
 *
 * `created_at` and `updated_at` come back as strings: a Postgres `BIGINT` is
 * wider than a JavaScript number, so the driver refuses to guess and hands over
 * the digits. These are milliseconds since the epoch, which is comfortably
 * inside `Number.MAX_SAFE_INTEGER`, so converting here is safe and keeps the
 * domain free of the driver's caution.
 */
function toPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    name: row.name,
    visibility: row.visibility as PlaylistVisibility,
    tracks: row.tracks ?? [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
