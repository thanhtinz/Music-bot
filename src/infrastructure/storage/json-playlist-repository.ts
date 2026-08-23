import {
  byRecentlyUpdated,
  type PlaylistRepository,
} from '../../application/playlist/playlist-repository';
import { normalizePlaylistName, type Playlist } from '../../domain/playlist';

import { JsonStore } from './json-store';

/**
 * Playlists in a JSON file.
 *
 * The spec puts playlists in Postgres eventually. Until there is a database to
 * talk to, a file gives the one property that actually matters to someone who
 * saved a playlist — that it is still there after a restart — with no infra to
 * run. Swapping in Postgres is an implementation of the same port.
 */
export class JsonPlaylistRepository implements PlaylistRepository {
  private readonly store: JsonStore<Playlist>;

  constructor(filePath: string) {
    this.store = new JsonStore<Playlist>({
      filePath,
      version: 1,
      collectionKey: 'playlists',
      label: 'playlist store',
      idOf: (playlist) => playlist.id,
      isValid: isPlaylist,
    });
  }

  async listByOwner(guildId: string, ownerId: string): Promise<Playlist[]> {
    const all = await this.store.all();

    return all
      .filter((playlist) => playlist.guildId === guildId && playlist.ownerId === ownerId)
      .sort(byRecentlyUpdated);
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | undefined> {
    const wanted = normalizePlaylistName(name);

    return this.store.find(
      (playlist) =>
        playlist.guildId === guildId &&
        playlist.ownerId === ownerId &&
        normalizePlaylistName(playlist.name) === wanted,
    );
  }

  async findById(id: string): Promise<Playlist | undefined> {
    return this.store.get(id);
  }

  async save(playlist: Playlist): Promise<void> {
    await this.store.put(playlist);
  }

  async delete(id: string): Promise<void> {
    await this.store.remove(id);
  }
}

function isPlaylist(value: unknown): value is Playlist {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Playlist>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.guildId === 'string' &&
    typeof candidate.ownerId === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.tracks)
  );
}
