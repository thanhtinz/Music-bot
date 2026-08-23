import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerManager, type Player } from '../../src/application/player';
import { InMemoryStatsRepository, StatsRecorder } from '../../src/application/stats';
import { createTrack, type Track } from '../../src/domain/music';
import { topListeners, topTracks, type GuildStats } from '../../src/domain/stats';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string, overrides: Partial<Parameters<typeof createTrack>[0]> = {}): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
    ...overrides,
  });
}

/** A clock the test moves by hand, so nothing waits out a song. */
class Clock {
  constructor(private value = 1_000) {}

  readonly now = (): number => this.value;

  advance(ms: number): void {
    this.value += ms;
  }
}

/** A store whose first write fails, standing in for a storage hiccup. */
class FailOnceRepository extends InMemoryStatsRepository {
  private failed = false;

  override async save(stats: GuildStats): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('disk full');
    }
    await super.save(stats);
  }
}

/** Lets the recorder's promise chain settle before the assertion reads it. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('StatsRecorder', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;
  let repository: InMemoryStatsRepository;
  let clock: Clock;
  let recorder: StatsRecorder;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { maxQueueSize: 20 });
    repository = new InMemoryStatsRepository();
    clock = new Clock();
    recorder = new StatsRecorder(repository, { now: clock.now });
  });

  /** A watched player, ready to be fed tracks. */
  async function watched(guildId = 'guild'): Promise<Player> {
    const player = await manager.getOrCreate({ guildId, voiceChannelId: 'voice' });
    recorder.watch(player);
    return player;
  }

  /** Plays one track through, letting `heldMs` pass before it ends. */
  async function playThrough(player: Player, track: Track, heldMs: number): Promise<void> {
    await player.enqueue(track);
    clock.advance(heldMs);
    backend.finishTrack(player.guildId, 'stopped');
    await settle();
  }

  /** The stats for a guild, failing the test rather than the assertion. */
  async function statsOf(guildId = 'guild'): Promise<GuildStats> {
    const stats = await repository.find(guildId);
    if (!stats) throw new Error(`no stats recorded for ${guildId}`);
    return stats;
  }

  it('counts a track once it has finished', async () => {
    const player = await watched();
    await playThrough(player, song('First'), 180_000);

    const stats = await statsOf();
    expect(stats.totalPlays).toBe(1);
    expect(topTracks(stats, 5)[0]?.title).toBe('First');
  });

  it('does not count a track that is still playing', async () => {
    const player = await watched();
    await player.enqueue(song('First'));

    // Queueing forty songs and skipping thirty-nine is not forty songs
    // listened to; nothing is counted until a track actually ends.
    expect(await repository.find('guild')).toBeUndefined();
  });

  it('counts a skipped track for the little of it that played', async () => {
    const player = await watched();
    await playThrough(player, song('Skipped'), 4_000);

    expect((await statsOf()).totalListenedMs).toBe(4_000);
  });

  it('caps the listen at the length of the track', async () => {
    const player = await watched();
    // Left paused overnight: the cap is what stops that reading as ten hours.
    await playThrough(player, song('Paused', { durationMs: 200_000 }), 10 * 3_600_000);

    expect((await statsOf()).totalListenedMs).toBe(200_000);
  });

  it('lets a stream run past any duration', async () => {
    const player = await watched();
    await playThrough(player, song('Radio', { isStream: true, durationMs: 0 }), 90_000);

    // A stream has no length to cap against, so wall time is the only measure.
    expect((await statsOf()).totalListenedMs).toBe(90_000);
  });

  it('credits the person who queued it', async () => {
    const player = await watched();
    await playThrough(player, song('Theirs', { requesterId: 'linh' }), 60_000);

    expect(topListeners(await statsOf(), 5)[0]).toMatchObject({ userId: 'linh', plays: 1 });
  });

  /** Plays a whole queue through, each track held for `heldMs`. */
  async function playQueue(player: Player, tracks: Track[], heldMs: number): Promise<void> {
    await player.enqueue(tracks);

    for (let index = 0; index < tracks.length; index += 1) {
      clock.advance(heldMs);
      backend.finishTrack(player.guildId, 'finished');
      await settle();
    }
  }

  it('adds up across plays', async () => {
    const player = await watched();
    await playQueue(player, [song('First'), song('First'), song('Second')], 100_000);

    const stats = await statsOf();
    expect(stats.totalPlays).toBe(3);
    expect(stats.totalListenedMs).toBe(300_000);
    expect(topTracks(stats, 5)[0]).toMatchObject({ title: 'First', plays: 2 });
  });

  it('keeps guilds apart', async () => {
    await playThrough(await watched('one'), song('Ours'), 10_000);
    await playThrough(await watched('two'), song('Theirs'), 10_000);

    expect(topTracks(await statsOf('one'), 5)[0]?.title).toBe('Ours');
    expect(topTracks(await statsOf('two'), 5)[0]?.title).toBe('Theirs');
  });

  it('records nothing for an end it never saw start', async () => {
    await watched();

    // A track that was already playing when the bot restarted: there is no
    // start to measure from, so there is nothing to record.
    backend.events.emit('trackEnd', {
      guildId: 'guild',
      track: song('Orphan'),
      reason: 'finished',
    });
    await settle();

    expect(await repository.find('guild')).toBeUndefined();
  });

  it('forgets an in-flight track when its player goes away', async () => {
    const player = await watched();
    await player.enqueue(song('Dropped'));

    recorder.forget('guild');
    clock.advance(60_000);
    backend.finishTrack('guild', 'stopped');
    await settle();

    expect(await repository.find('guild')).toBeUndefined();
  });

  it('keeps counting when a play cannot be saved', async () => {
    const failing = new FailOnceRepository();
    recorder = new StatsRecorder(failing, { now: clock.now });
    repository = failing;

    const player = await watched();
    await playQueue(player, [song('Unlucky'), song('Lucky')], 30_000);

    // A storage hiccup loses that one play, not the recorder.
    const stats = await statsOf();
    expect(topTracks(stats, 5).map((track) => track.title)).toEqual(['Lucky']);
  });
});
