import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPlaylist, type Playlist, type SavedTrack } from '../../src/domain/playlist';
import { JsonPlaylistRepository } from '../../src/infrastructure/storage/json-playlist-repository';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'playlist-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function saved(): SavedTrack {
  return {
    source: 'youtube',
    identifier: 'abc',
    title: 'Faded',
    author: 'Alan Walker',
    durationMs: 212_000,
    isStream: false,
  };
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    ...createPlaylist({ guildId: 'guild', ownerId: 'owner', name: 'Chill', tracks: [saved()] }),
    ...overrides,
  };
}

describe('JsonPlaylistRepository', () => {
  it('reads back what another instance wrote', async () => {
    const path = join(directory, 'playlists.json');
    const first = new JsonPlaylistRepository(path);
    const stored = playlist();
    await first.save(stored);

    const second = new JsonPlaylistRepository(path);
    const found = await second.findByName('guild', 'owner', 'chill');

    expect(found?.id).toBe(stored.id);
    expect(found?.tracks).toHaveLength(1);
  });

  it('creates the directory it was pointed at', async () => {
    const path = join(directory, 'nested', 'deeper', 'playlists.json');
    const repository = new JsonPlaylistRepository(path);

    await repository.save(playlist());

    expect(JSON.parse(await readFile(path, 'utf8')).playlists).toHaveLength(1);
  });

  it('starts empty when there is no file yet', async () => {
    const repository = new JsonPlaylistRepository(join(directory, 'absent.json'));

    expect(await repository.listByOwner('guild', 'owner')).toEqual([]);
  });

  it('starts empty and leaves a corrupt file alone rather than failing to boot', async () => {
    const path = join(directory, 'broken.json');
    await writeFile(path, '{ this is not json', 'utf8');

    const repository = new JsonPlaylistRepository(path);

    expect(await repository.listByOwner('guild', 'owner')).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('{ this is not json');
  });

  it('skips entries that are not playlists', async () => {
    const path = join(directory, 'partial.json');
    await writeFile(
      path,
      JSON.stringify({ version: 1, playlists: [{ nonsense: true }, playlist()] }),
      'utf8',
    );

    const repository = new JsonPlaylistRepository(path);

    expect(await repository.listByOwner('guild', 'owner')).toHaveLength(1);
  });

  it('deletes, and the deletion survives a reload', async () => {
    const path = join(directory, 'playlists.json');
    const repository = new JsonPlaylistRepository(path);
    const stored = playlist();

    await repository.save(stored);
    await repository.delete(stored.id);

    expect(await new JsonPlaylistRepository(path).findById(stored.id)).toBeUndefined();
  });

  it('leaves no temporary files behind after concurrent writes', async () => {
    const path = join(directory, 'playlists.json');
    const repository = new JsonPlaylistRepository(path);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) => repository.save(playlist({ name: `List ${index}` }))),
    );

    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.playlists).toHaveLength(8);
    expect(written.version).toBe(1);
  });

  it('lists the most recently updated first', async () => {
    const repository = new JsonPlaylistRepository(join(directory, 'playlists.json'));

    await repository.save(playlist({ name: 'Older', updatedAt: 1 }));
    await repository.save(playlist({ name: 'Newer', updatedAt: 2 }));

    const listed = await repository.listByOwner('guild', 'owner');
    expect(listed.map((entry) => entry.name)).toEqual(['Newer', 'Older']);
  });
});
