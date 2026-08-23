import { beforeEach, describe, expect, it } from 'vitest';

import {
  NodeManager,
  reconnectDelayMs,
  scoreNode,
  type NodeRuntime,
} from '../../src/infrastructure/lavalink/node-manager';

function runtime(overrides: Partial<NodeRuntime> = {}): NodeRuntime {
  return {
    id: 'n1',
    host: 'localhost',
    port: 2333,
    state: 'connected',
    failures: 0,
    stats: { cpu: 0, memory: 0, players: 0, latencyMs: 0 },
    ...overrides,
  };
}

describe('scoreNode', () => {
  it('scores an idle node at zero', () => {
    expect(scoreNode(runtime())).toBe(0);
  });

  it('ranks a busier node worse', () => {
    const idle = runtime({ stats: { cpu: 0.1, memory: 0.1, players: 2, latencyMs: 20 } });
    const busy = runtime({ stats: { cpu: 0.8, memory: 0.7, players: 80, latencyMs: 200 } });

    expect(scoreNode(busy)).toBeGreaterThan(scoreNode(idle));
  });

  it('lets a heavier weight absorb more players', () => {
    const stats = { cpu: 0, memory: 0, players: 50, latencyMs: 0 };
    const small = runtime({ weight: 1, stats });
    const large = runtime({ weight: 4, stats });

    expect(scoreNode(large)).toBeLessThan(scoreNode(small));
  });

  it('penalises repeated failures', () => {
    const healthy = runtime();
    const flaky = runtime({ failures: 2 });

    expect(scoreNode(flaky)).toBeGreaterThan(scoreNode(healthy) + 50);
  });

  it('clamps nonsense stats instead of producing NaN', () => {
    const broken = runtime({
      stats: { cpu: Number.NaN, memory: -1, players: 1e9, latencyMs: 1e9 },
    });

    expect(Number.isFinite(scoreNode(broken))).toBe(true);
  });
});

describe('reconnectDelayMs', () => {
  it('backs off exponentially', () => {
    const noJitter = () => 1;

    expect(reconnectDelayMs(1, noJitter)).toBe(1_000);
    expect(reconnectDelayMs(2, noJitter)).toBe(2_000);
    expect(reconnectDelayMs(3, noJitter)).toBe(4_000);
  });

  it('caps the delay', () => {
    expect(reconnectDelayMs(50, () => 1)).toBe(60_000);
  });

  it('applies jitter within half the computed delay', () => {
    expect(reconnectDelayMs(3, () => 0)).toBe(2_000);
    expect(reconnectDelayMs(3, () => 1)).toBe(4_000);
  });
});

describe('NodeManager', () => {
  let manager: NodeManager;

  beforeEach(() => {
    manager = new NodeManager();
    manager.register({ id: 'a', host: 'a.local', port: 2333 });
    manager.register({ id: 'b', host: 'b.local', port: 2333 });
    manager.setState('a', 'connected');
    manager.setState('b', 'connected');
  });

  it('rejects a duplicate node id', () => {
    expect(() => manager.register({ id: 'a', host: 'x', port: 1 })).toThrow(/Duplicate/);
  });

  it('picks the least loaded node', () => {
    manager.updateStats('a', { players: 80, cpu: 0.9 });
    manager.updateStats('b', { players: 3, cpu: 0.1 });

    expect(manager.select()?.id).toBe('b');
  });

  it('skips nodes that are not connected', () => {
    manager.updateStats('a', { players: 1 });
    manager.updateStats('b', { players: 50 });
    manager.setState('a', 'disconnected');

    expect(manager.select()?.id).toBe('b');
  });

  it('stops routing to a draining node but keeps it registered', () => {
    manager.drain('a');

    expect(manager.select()?.id).toBe('b');
    expect(manager.get('a')?.state).toBe('draining');
    expect(manager.list()).toHaveLength(2);
  });

  it('returns undefined when the whole cluster is down', () => {
    manager.setState('a', 'disconnected');
    manager.setState('b', 'disconnected');

    expect(manager.select()).toBeUndefined();
  });

  it('prefers the requested region but falls back rather than refusing', () => {
    manager.register({ id: 'eu', host: 'eu.local', port: 2333, region: 'eu' });
    manager.setState('eu', 'connected');

    expect(manager.select('eu')?.id).toBe('eu');

    manager.setState('eu', 'disconnected');
    expect(manager.select('eu')).toBeDefined();
  });

  it('excludes the failed node when choosing a failover target', () => {
    manager.updateStats('a', { players: 1 });
    manager.updateStats('b', { players: 90 });

    expect(manager.selectFailover('a')?.id).toBe('b');
  });

  it('has no failover target in a single-node cluster', () => {
    const single = new NodeManager();
    single.register({ id: 'only', host: 'x', port: 1 });
    single.setState('only', 'connected');

    expect(single.selectFailover('only')).toBeUndefined();
  });

  it('accumulates failures and clears them on reconnect', () => {
    manager.recordFailure('a', () => 1);
    manager.recordFailure('a', () => 1);
    expect(manager.get('a')?.failures).toBe(2);
    expect(manager.get('a')?.state).toBe('disconnected');

    manager.setState('a', 'connected');
    expect(manager.get('a')?.failures).toBe(0);
  });

  it('ignores stats and state for an unknown node', () => {
    expect(() => manager.updateStats('ghost', { players: 1 })).not.toThrow();
    expect(() => manager.setState('ghost', 'connected')).not.toThrow();
    expect(manager.recordFailure('ghost')).toBeGreaterThan(0);
  });
});
