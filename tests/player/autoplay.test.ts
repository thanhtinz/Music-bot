import { beforeEach, describe, expect, it } from 'vitest';

import { AutoplaySelector, PlayerManager, queriesFor } from '../../src/application/player';
import { AUTOPLAY_REQUESTER_ID, createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry, type SourceResolver, type TrackCandidate } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string, author = 'MONO', identifier = title.toLowerCase()): Track {
  return createTrack({
    source: 'youtube',
    identifier,
    title,
    author,
    durationMs: 200_000,
    requesterId: 'user',
  });
}

function candidate(overrides: Partial<TrackCandidate> = {}): TrackCandidate {
  return {
    source: 'youtube',
    identifier: 'suggested',
    title: 'Suggested',
    author: 'MONO',
    durationMs: 200_000,
    ...overrides,
  };
}

/** A search provider with no network behind it. */
function provider(search: (query: string) => Promise<TrackCandidate[]>): ResolverRegistry {
  const registry = new ResolverRegistry();

  registry.register({
    name: 'fake',
    source: 'youtube',
    canHandle: () => true,
    search: (query) => search(query),
    resolveTrack: async () => candidate(),
  } satisfies SourceResolver);

  return registry;
}

describe('queriesFor', () => {
  it('asks for the artist first', () => {
    expect(queriesFor(song('Chăm Hoa', 'MONO'))[0]).toBe('MONO');
  });

  it('strips the decorations an upload carries', () => {
    const queries = queriesFor(song('Chăm Hoa (Official MV) [4K]', 'MONO'));

    expect(queries).toContain('Chăm Hoa');
    expect(queries.join(' ')).not.toContain('Official');
  });

  it('falls back to the title when there is no artist', () => {
    // `createTrack` fills a blank author with "Unknown artist"; searching for
    // those literal words would return somebody's joke upload.
    expect(queriesFor(song('Chăm Hoa', ''))).toEqual(['Chăm Hoa']);
  });

  it('gives nothing to search for when there is nothing to go on', () => {
    expect(queriesFor(song('', ''))).toEqual([]);
  });

  it('does not repeat the same query twice', () => {
    const queries = queriesFor(song('MONO', 'MONO'));

    expect(new Set(queries).size).toBe(queries.length);
  });
});

describe('AutoplaySelector', () => {
  let queries: string[];

  beforeEach(() => {
    queries = [];
  });

  /** A selector whose provider returns `results` and records its queries. */
  function selector(results: TrackCandidate[]): AutoplaySelector {
    return new AutoplaySelector(
      provider(async (query) => {
        queries.push(query);
        return results;
      }),
    );
  }

  it('suggests a track from the seed’s artist', async () => {
    const picked = await selector([candidate()]).suggest('guild', song('Chăm Hoa'));

    expect(picked?.title).toBe('Suggested');
    expect(queries[0]).toBe('MONO');
  });

  it('credits nobody for a track the bot chose', async () => {
    const picked = await selector([candidate()]).suggest('guild', song('Chăm Hoa'));

    // Crediting the person who queued the seed would put tracks they never
    // asked for into their name, and into their listening stats.
    expect(picked?.requesterId).toBe(AUTOPLAY_REQUESTER_ID);
  });

  it('records what seeded it', async () => {
    const picked = await selector([candidate()]).suggest('guild', song('Chăm Hoa'));

    expect(picked?.metadata.autoplaySeed).toBe('youtube:chăm hoa');
  });

  it('never suggests the seed back', async () => {
    const seed = song('Chăm Hoa');
    const picked = await selector([candidate({ identifier: 'chăm hoa' })]).suggest('guild', seed);

    expect(picked).toBeUndefined();
  });

  it('avoids what the room has just heard', async () => {
    const picked = await selector([candidate({ identifier: 'heard' })]).suggest(
      'guild',
      song('Chăm Hoa'),
      [song('Heard', 'MONO', 'heard')],
    );

    expect(picked).toBeUndefined();
  });

  it('does not circle back to what it suggested before', async () => {
    const one = selector([candidate(), candidate({ identifier: 'second', title: 'Second' })]);

    const first = await one.suggest('guild', song('Chăm Hoa'));
    const second = await one.suggest('guild', song('Chăm Hoa'));

    expect(first?.title).toBe('Suggested');
    expect(second?.title).toBe('Second');
  });

  it('keeps guilds’ memories apart', async () => {
    const shared = selector([candidate()]);

    await shared.suggest('one', song('Chăm Hoa'));
    const other = await shared.suggest('two', song('Chăm Hoa'));

    expect(other?.title).toBe('Suggested');
  });

  it('forgets a guild on request', async () => {
    const one = selector([candidate()]);
    await one.suggest('guild', song('Chăm Hoa'));

    one.forget('guild');

    expect((await one.suggest('guild', song('Chăm Hoa')))?.title).toBe('Suggested');
  });

  it('skips an hour-long mix', async () => {
    const picked = await selector([candidate({ durationMs: 3_600_000 })]).suggest(
      'guild',
      song('Chăm Hoa'),
    );

    // A two-hour "lofi to study to" is a fine thing to ask for and a poor
    // thing to be handed.
    expect(picked).toBeUndefined();
  });

  it('skips a live stream and a track with no length', async () => {
    const streams = selector([candidate({ isStream: true }), candidate({ durationMs: 0 })]);

    expect(await streams.suggest('guild', song('Chăm Hoa'))).toBeUndefined();
  });

  it('tries the next query when the first turns up nothing usable', async () => {
    const picky = new AutoplaySelector(
      provider(async (query) => {
        queries.push(query);
        return query === 'MONO' ? [] : [candidate()];
      }),
    );

    const picked = await picky.suggest('guild', song('Chăm Hoa'));

    expect(picked?.title).toBe('Suggested');
    expect(queries.length).toBeGreaterThan(1);
  });

  it('suggests nothing rather than throwing when search fails', async () => {
    const broken = new AutoplaySelector({
      search: async () => {
        throw new Error('provider is down');
      },
    } as unknown as ResolverRegistry);

    expect(await broken.suggest('guild', song('Chăm Hoa'))).toBeUndefined();
  });

  it('has nothing to search for on a seed with no title or artist', async () => {
    const picked = await selector([candidate()]).suggest('guild', song('', ''));

    expect(picked).toBeUndefined();
    expect(queries).toEqual([]);
  });
});

describe('autoplay through the player', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
  });

  /** A manager whose autoplay always suggests `title`. */
  function managerSuggesting(title: string | undefined): PlayerManager {
    return new PlayerManager(backend, {
      maxQueueSize: 20,
      autoplayResolver: async () =>
        title === undefined
          ? undefined
          : createTrack({
              source: 'youtube',
              identifier: title.toLowerCase(),
              title,
              author: 'MONO',
              durationMs: 200_000,
              requesterId: AUTOPLAY_REQUESTER_ID,
            }),
    });
  }

  it('plays a suggestion when the queue runs out', async () => {
    players = managerSuggesting('Next Up');
    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    player.autoplay = true;

    await player.enqueue(song('Last One'));
    backend.finishTrack('guild', 'finished');
    await new Promise((resolve) => setImmediate(resolve));

    expect(player.queue.current?.title).toBe('Next Up');
    expect(backend.playing('guild')?.title).toBe('Next Up');
  });

  it('stays quiet with autoplay off', async () => {
    players = managerSuggesting('Next Up');
    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });

    await player.enqueue(song('Last One'));
    backend.finishTrack('guild', 'finished');
    await new Promise((resolve) => setImmediate(resolve));

    // Nothing new was started: the queue simply ended.
    expect(player.queue.current).toBeUndefined();
    expect(player.status).not.toBe('playing');
  });

  it('ends the queue when nothing can be suggested', async () => {
    players = managerSuggesting(undefined);
    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    player.autoplay = true;

    const ended = new Promise((resolve) => player.once('queueEnd', resolve));

    await player.enqueue(song('Last One'));
    backend.finishTrack('guild', 'finished');

    await expect(ended).resolves.toBeDefined();
  });
});
