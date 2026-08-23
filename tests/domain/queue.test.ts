import { beforeEach, describe, expect, it } from 'vitest';

import { createTrack, Queue, QueueError, type Track } from '../../src/domain/music';

function track(title: string, requesterId = 'u1'): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Test Artist',
    durationMs: 180_000,
    requesterId,
  });
}

/** Deterministic RNG so shuffle assertions are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('Queue basics', () => {
  let queue: Queue;

  beforeEach(() => {
    queue = new Queue({ maxSize: 5 });
  });

  it('starts empty', () => {
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.current).toBeUndefined();
    expect(queue.freeSlots).toBe(5);
  });

  it('adds single tracks and batches', () => {
    expect(queue.add(track('A'))).toBe(1);
    expect(queue.add([track('B'), track('C')])).toBe(2);
    expect(queue.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });

  it('ignores an empty batch', () => {
    expect(queue.add([])).toBe(0);
  });

  it('rejects a batch that would overflow, without partially enqueuing it', () => {
    queue.add([track('A'), track('B'), track('C')]);

    expect(() => queue.add([track('D'), track('E'), track('F')])).toThrow(QueueError);
    expect(queue.size).toBe(3);

    try {
      queue.add([track('D'), track('E'), track('F')]);
    } catch (error) {
      expect((error as QueueError).code).toBe('QUEUE_FULL');
    }
  });

  it('puts addNext at the front', () => {
    queue.add([track('A'), track('B')]);
    queue.addNext(track('Priority'));
    expect(queue.tracks.map((t) => t.title)).toEqual(['Priority', 'A', 'B']);
  });

  it('reports total duration of upcoming tracks only', () => {
    queue.add([track('A'), track('B')]);
    queue.next();
    expect(queue.totalDurationMs).toBe(180_000);
  });
});

describe('Queue positions are 1-based', () => {
  let queue: Queue;

  beforeEach(() => {
    queue = new Queue();
    queue.add([track('A'), track('B'), track('C')]);
  });

  it('removes by 1-based position', () => {
    expect(queue.remove(2).title).toBe('B');
    expect(queue.tracks.map((t) => t.title)).toEqual(['A', 'C']);
  });

  it('reads by 1-based position', () => {
    expect(queue.at(1).title).toBe('A');
    expect(queue.at(3).title).toBe('C');
  });

  it('moves a track and shifts the rest', () => {
    queue.move(1, 3);
    expect(queue.tracks.map((t) => t.title)).toEqual(['B', 'C', 'A']);
  });

  it('treats a move onto itself as a no-op', () => {
    queue.move(2, 2);
    expect(queue.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });

  it('rejects position 0 and beyond the end', () => {
    expect(() => queue.remove(0)).toThrow(QueueError);
    expect(() => queue.remove(4)).toThrow(QueueError);
    expect(() => queue.at(-1)).toThrow(QueueError);
  });

  it('rejects non-integer positions', () => {
    try {
      queue.remove(1.5);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as QueueError).code).toBe('INVALID_POSITION');
    }
  });

  it('reports an empty queue distinctly from an out-of-range position', () => {
    const empty = new Queue();
    try {
      empty.remove(1);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as QueueError).code).toBe('QUEUE_EMPTY');
    }
  });
});

describe('Queue playback advance', () => {
  it('walks the queue and records history', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B')]);

    expect(queue.next()?.title).toBe('A');
    expect(queue.next()?.title).toBe('B');
    expect(queue.history.map((t) => t.title)).toEqual(['A']);
    expect(queue.next()).toBeUndefined();
  });

  it('replays the current track on loop: song without consuming the queue', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B')]);
    queue.next();
    queue.loop = 'song';

    expect(queue.next()?.title).toBe('A');
    expect(queue.next()?.title).toBe('A');
    expect(queue.size).toBe(1);
    expect(queue.history).toHaveLength(0);
  });

  it('refills from history on loop: queue', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B')]);
    queue.loop = 'queue';

    expect(queue.next()?.title).toBe('A');
    expect(queue.next()?.title).toBe('B');
    // Queue is dry — it should wrap back to the start instead of going idle.
    expect(queue.next()?.title).toBe('A');
    expect(queue.next()?.title).toBe('B');
  });

  it('goes idle on loop: queue when nothing was ever played', () => {
    const queue = new Queue();
    queue.loop = 'queue';
    expect(queue.next()).toBeUndefined();
  });

  it('steps back with previous and pushes the current track forward again', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B'), track('C')]);
    queue.next();
    queue.next();

    expect(queue.previous()?.title).toBe('A');
    expect(queue.current?.title).toBe('A');
    expect(queue.tracks.map((t) => t.title)).toEqual(['B', 'C']);
  });

  it('returns undefined from previous with no history', () => {
    const queue = new Queue();
    queue.add(track('A'));
    queue.next();
    expect(queue.previous()).toBeUndefined();
  });

  it('caps the history at the configured limit', () => {
    const queue = new Queue({ historyLimit: 2 });
    queue.add([track('A'), track('B'), track('C'), track('D')]);
    for (let i = 0; i < 4; i += 1) queue.next();

    expect(queue.history.map((t) => t.title)).toEqual(['B', 'C']);
  });

  it('jumps to a position and keeps the skipped tracks in history', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B'), track('C'), track('D')]);
    queue.next();

    expect(queue.jump(2).title).toBe('C');
    expect(queue.tracks.map((t) => t.title)).toEqual(['D']);
    expect(queue.history.map((t) => t.title)).toEqual(['A', 'B']);
  });
});

describe('Queue shuffle', () => {
  it('never moves the current track', () => {
    const queue = new Queue({ random: seededRandom(42) });
    queue.add([track('A'), track('B'), track('C'), track('D'), track('E')]);
    queue.next();
    const current = queue.current;

    queue.shuffle();

    expect(queue.current).toBe(current);
    expect(queue.tracks).toHaveLength(4);
  });

  it('preserves the multiset of upcoming tracks', () => {
    const queue = new Queue({ random: seededRandom(7) });
    const titles = ['A', 'B', 'C', 'D', 'E', 'F'];
    queue.add(titles.map((title) => track(title)));

    queue.shuffle();

    expect([...queue.tracks.map((t) => t.title)].sort()).toEqual([...titles].sort());
  });

  it('actually reorders a long queue', () => {
    const queue = new Queue({ maxSize: 200, random: seededRandom(2026) });
    const titles = Array.from({ length: 40 }, (_, i) => `T${i}`);
    queue.add(titles.map((title) => track(title)));

    queue.shuffle();

    expect(queue.tracks.map((t) => t.title)).not.toEqual(titles);
  });

  it('is a no-op on an empty or single-track queue', () => {
    const queue = new Queue();
    expect(() => queue.shuffle()).not.toThrow();

    queue.add(track('A'));
    queue.shuffle();
    expect(queue.tracks.map((t) => t.title)).toEqual(['A']);
  });
});

describe('Queue bulk operations', () => {
  it('clears upcoming tracks but keeps the current one playing', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B'), track('C')]);
    queue.next();

    expect(queue.clear()).toBe(2);
    expect(queue.current?.title).toBe('A');
    expect(queue.size).toBe(0);
  });

  it('reset wipes everything', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B')]);
    queue.next();
    queue.reset();

    expect(queue.isEmpty).toBe(true);
    expect(queue.history).toHaveLength(0);
  });

  it('removes every track queued by one user', () => {
    const queue = new Queue();
    queue.add([track('A', 'u1'), track('B', 'u2'), track('C', 'u1')]);

    expect(queue.removeByRequester('u1')).toBe(2);
    expect(queue.tracks.map((t) => t.title)).toEqual(['B']);
  });
});

describe('Queue cleanup', () => {
  it('keeps the first copy of a track and drops the rest', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B'), track('A'), track('C'), track('B')]);

    const removed = queue.removeDuplicates();

    expect(removed.map((t) => t.title)).toEqual(['A', 'B']);
    expect(queue.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });

  it('counts the playing track as already queued', () => {
    // A long playlist looping back onto what is playing is the usual way a
    // queue fills with repeats.
    const queue = new Queue();
    queue.add([track('A'), track('B'), track('A')]);
    queue.next();

    queue.removeDuplicates();

    expect(queue.current?.title).toBe('A');
    expect(queue.tracks.map((t) => t.title)).toEqual(['B']);
  });

  it('matches a track by what it is, not by who queued it', () => {
    // The same song added by two people is one song twice.
    const queue = new Queue();
    queue.add([track('A', 'u1'), track('A', 'u2')]);

    expect(queue.removeDuplicates()).toHaveLength(1);
    expect(queue.tracks[0]?.requesterId).toBe('u1');
  });

  it('removes nothing from a queue with no repeats', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B')]);

    expect(queue.removeDuplicates()).toEqual([]);
    expect(queue.size).toBe(2);
  });

  it('drops tracks queued by anybody who has left', () => {
    const queue = new Queue();
    queue.add([track('A', 'stayed'), track('B', 'left'), track('C', 'stayed')]);

    const removed = queue.removeAbsent(new Set(['stayed']));

    expect(removed.map((t) => t.title)).toEqual(['B']);
    expect(queue.tracks.map((t) => t.title)).toEqual(['A', 'C']);
  });

  it('leaves the playing track alone even when its requester left', () => {
    // Withdrawing a track already sounding in the channel is not a cleanup.
    const queue = new Queue();
    queue.add([track('Playing', 'left'), track('B', 'left')]);
    queue.next();

    queue.removeAbsent(new Set(['stayed']));

    expect(queue.current?.title).toBe('Playing');
    expect(queue.tracks).toEqual([]);
  });

  it('empties the queue when nobody who queued anything is left', () => {
    const queue = new Queue();
    queue.add([track('A', 'left'), track('B', 'gone')]);

    expect(queue.removeAbsent(new Set())).toHaveLength(2);
    expect(queue.size).toBe(0);
  });
});

describe('Queue snapshots', () => {
  it('round-trips through JSON', () => {
    const queue = new Queue({ maxSize: 10 });
    queue.add([track('A'), track('B'), track('C')]);
    queue.next();
    queue.loop = 'queue';

    const restored = Queue.fromJSON(JSON.parse(JSON.stringify(queue.toJSON())), { maxSize: 10 });

    expect(restored.current?.title).toBe('A');
    expect(restored.tracks.map((t) => t.title)).toEqual(['B', 'C']);
    expect(restored.loop).toBe('queue');
  });

  it('restores from a partial snapshot', () => {
    const restored = Queue.fromJSON({});
    expect(restored.isEmpty).toBe(true);
    expect(restored.loop).toBe('off');
  });
});
