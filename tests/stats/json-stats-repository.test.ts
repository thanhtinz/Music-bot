import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../src/domain/music';
import { createGuildStats, recordPlay, type GuildStats } from '../../src/domain/stats';
import { JsonStatsRepository } from '../../src/infrastructure/storage/json-stats-repository';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stats-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function stats(guildId = 'guild'): GuildStats {
  return recordPlay(createGuildStats(guildId, 1_000), {
    track: createTrack({
      source: 'youtube',
      identifier: 'abc',
      title: 'Faded',
      author: 'Alan Walker',
      durationMs: 212_000,
      requesterId: 'thanhtinz',
    }),
    userId: 'thanhtinz',
    listenedMs: 200_000,
    playedAt: 2_000,
  });
}

describe('JsonStatsRepository', () => {
  it('reads back what another instance wrote', async () => {
    const path = join(directory, 'stats.json');
    await new JsonStatsRepository(path).save(stats());

    const found = await new JsonStatsRepository(path).find('guild');

    expect(found?.totalPlays).toBe(1);
    expect(found?.tracks[0]?.title).toBe('Faded');
  });

  it('replaces a guild rather than appending to it', async () => {
    const path = join(directory, 'stats.json');
    const repository = new JsonStatsRepository(path);

    await repository.save(stats());
    await repository.save(recordPlay(stats(), { ...playRecord(), playedAt: 3_000 }));

    expect((await repository.find('guild'))?.totalPlays).toBe(2);
    const file = JSON.parse(await readFile(path, 'utf8')) as { guilds: unknown[] };
    expect(file.guilds).toHaveLength(1);
  });

  it('keeps guilds apart in one file', async () => {
    const path = join(directory, 'stats.json');
    const repository = new JsonStatsRepository(path);

    await repository.save(stats('one'));
    await repository.save(stats('two'));

    expect(await repository.find('one')).toBeDefined();
    expect(await repository.find('two')).toBeDefined();
  });

  it('has nothing to say about a guild it has never seen', async () => {
    const repository = new JsonStatsRepository(join(directory, 'stats.json'));

    expect(await repository.find('never-seen')).toBeUndefined();
  });

  it('starts fresh rather than crashing on a corrupt file', async () => {
    const path = join(directory, 'stats.json');
    await writeFile(path, 'not json at all', 'utf8');

    const repository = new JsonStatsRepository(path);

    // Losing play counts is not worth refusing to start the bot over.
    expect(await repository.find('guild')).toBeUndefined();
    await repository.save(stats());
    expect(await repository.find('guild')).toBeDefined();
  });

  it('skips an entry that is not a stats record', async () => {
    const path = join(directory, 'stats.json');
    await writeFile(
      path,
      JSON.stringify({ version: 1, guilds: [{ guildId: 'broken' }, stats('good')] }),
      'utf8',
    );

    const repository = new JsonStatsRepository(path);

    expect(await repository.find('broken')).toBeUndefined();
    expect(await repository.find('good')).toBeDefined();
  });
});

function playRecord(): Parameters<typeof recordPlay>[1] {
  return {
    track: createTrack({
      source: 'youtube',
      identifier: 'abc',
      title: 'Faded',
      author: 'Alan Walker',
      durationMs: 212_000,
      requesterId: 'thanhtinz',
    }),
    userId: 'thanhtinz',
    listenedMs: 200_000,
  };
}
