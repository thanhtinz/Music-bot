import { normalizePlaylistName, type Playlist } from '../../domain/playlist';

/**
 * Storage seam for playlists.
 *
 * The service is written against this rather than a database so the store can
 * change — memory for tests, a file today, Postgres later — without the
 * command layer knowing (spec §1.2).
 */
export interface PlaylistRepository {
  /** Every playlist owned by one user in one guild, newest activity first. */
  listByOwner(guildId: string, ownerId: string): Promise<Playlist[]>;
  /** Case-insensitive lookup, matching how people type a name from memory. */
  findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | undefined>;
  findById(id: string): Promise<Playlist | undefined>;
  /** Inserts or replaces, keyed on id. */
  save(playlist: Playlist): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Sort used everywhere a library is listed: most recently touched first. */
export function byRecentlyUpdated(a: Playlist, b: Playlist): number {
  return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
}

/**
 * Non-persistent store.
 *
 * Used by the tests, and as the fallback when no storage directory is
 * configured — a bot with playlists that vanish on restart is still better
 * than one whose playlist command reports an outage.
 */
export class InMemoryPlaylistRepository implements PlaylistRepository {
  private readonly playlists = new Map<string, Playlist>();

  async listByOwner(guildId: string, ownerId: string): Promise<Playlist[]> {
    return [...this.playlists.values()]
      .filter((playlist) => playlist.guildId === guildId && playlist.ownerId === ownerId)
      .sort(byRecentlyUpdated);
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | undefined> {
    const wanted = normalizePlaylistName(name);

    return [...this.playlists.values()].find(
      (playlist) =>
        playlist.guildId === guildId &&
        playlist.ownerId === ownerId &&
        normalizePlaylistName(playlist.name) === wanted,
    );
  }

  async findById(id: string): Promise<Playlist | undefined> {
    return this.playlists.get(id);
  }

  async save(playlist: Playlist): Promise<void> {
    this.playlists.set(playlist.id, playlist);
  }

  async delete(id: string): Promise<void> {
    this.playlists.delete(id);
  }
}
