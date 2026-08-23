import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  byRecentlyUpdated,
  type PlaylistRepository,
} from '../../application/playlist/playlist-repository';
import { normalizePlaylistName, type Playlist } from '../../domain/playlist';
import { createLogger } from '../../telemetry/logger';

const logger = createLogger('playlist-store');

/** Bumped when the on-disk shape changes, so an old file can be recognised. */
const FORMAT_VERSION = 1;

interface StoreFile {
  version: number;
  playlists: Playlist[];
}

/**
 * Playlists in a JSON file.
 *
 * The spec puts playlists in Postgres eventually. Until there is a database to
 * talk to, a file gives the one property that actually matters to someone who
 * saved a playlist — that it is still there after a restart — with no infra to
 * run. Swapping in Postgres is an implementation of the same port.
 *
 * Writes are whole-file and serialised through one chain, then moved into place
 * with a rename, so a crash mid-write cannot leave a half-written library.
 */
export class JsonPlaylistRepository implements PlaylistRepository {
  private readonly path: string;
  private cache = new Map<string, Playlist>();
  private loaded = false;
  /** Serialises writes; a rename is atomic but two of them still race. */
  private writes: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.path = resolve(filePath);
  }

  async listByOwner(guildId: string, ownerId: string): Promise<Playlist[]> {
    await this.load();

    return [...this.cache.values()]
      .filter((playlist) => playlist.guildId === guildId && playlist.ownerId === ownerId)
      .sort(byRecentlyUpdated);
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | undefined> {
    await this.load();
    const wanted = normalizePlaylistName(name);

    return [...this.cache.values()].find(
      (playlist) =>
        playlist.guildId === guildId &&
        playlist.ownerId === ownerId &&
        normalizePlaylistName(playlist.name) === wanted,
    );
  }

  async findById(id: string): Promise<Playlist | undefined> {
    await this.load();
    return this.cache.get(id);
  }

  async save(playlist: Playlist): Promise<void> {
    await this.load();
    this.cache.set(playlist.id, playlist);
    await this.flush();
  }

  async delete(id: string): Promise<void> {
    await this.load();
    if (!this.cache.delete(id)) return;
    await this.flush();
  }

  /**
   * Reads the file once.
   *
   * A missing file is the normal first run. A corrupt one is reported and
   * treated as empty rather than thrown: losing saved playlists is bad, but a
   * bot that will not start is worse, and the bad file is left on disk to be
   * recovered by hand.
   */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err: error, path: this.path }, 'could not read the playlist store');
      }
      return;
    }

    try {
      const parsed = JSON.parse(raw) as StoreFile;
      const playlists = Array.isArray(parsed.playlists) ? parsed.playlists : [];

      for (const playlist of playlists) {
        if (isPlaylist(playlist)) this.cache.set(playlist.id, playlist);
      }

      logger.info({ count: this.cache.size, path: this.path }, 'loaded playlists');
    } catch (error) {
      logger.error(
        { err: error, path: this.path },
        'the playlist store is unreadable; starting empty and leaving the file alone',
      );
    }
  }

  private async flush(): Promise<void> {
    const snapshot: StoreFile = {
      version: FORMAT_VERSION,
      playlists: [...this.cache.values()],
    };

    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });

      // Written beside the target so the rename stays on one filesystem, which
      // is what makes it atomic.
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporary, this.path);
    });

    await this.writes;
  }
}

/** Guards against a hand-edited or half-migrated file poisoning the cache. */
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
