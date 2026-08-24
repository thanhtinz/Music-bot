import { describe, expect, it } from 'vitest';

import {
  healthPortFor,
  refuseUnsafeSharding,
  shardIdentity,
  shouldRegisterCommands,
} from '../../src/config/sharding';

const alone = shardIdentity({});

describe('knowing which shard this process is', () => {
  it('reads what a sharding manager set up', () => {
    expect(shardIdentity({ SHARDS: '[2]', SHARD_COUNT: '4' })).toEqual({
      id: 2,
      total: 4,
      managed: true,
    });
  });

  it('takes the first when a process serves several shards', () => {
    expect(shardIdentity({ SHARDS: '[2,3]', SHARD_COUNT: '8' }).id).toBe(2);
  });

  it('accepts a bare number, which is what somebody writes by hand', () => {
    expect(shardIdentity({ SHARDS: '1', SHARD_COUNT: '2' })).toEqual({
      id: 1,
      total: 2,
      managed: true,
    });
  });

  it('is shard 0 of 1 when nothing spawned it', () => {
    // The same code path as a sharded run, not a special case.
    expect(alone).toEqual({ id: 0, total: 1, managed: false });
  });

  it('is not fooled by half a setup', () => {
    expect(shardIdentity({ SHARDS: '[1]' }).managed).toBe(false);
    expect(shardIdentity({ SHARD_COUNT: '4' }).managed).toBe(false);
    expect(shardIdentity({ SHARDS: 'nonsense', SHARD_COUNT: '4' }).managed).toBe(false);
    expect(shardIdentity({ SHARDS: '[0]', SHARD_COUNT: '0' }).managed).toBe(false);
  });
});

describe('the health port a shard listens on', () => {
  it('offsets by the shard id, so two processes do not collide', () => {
    // A bot that dies because its metrics endpoint collided is a bot that dies
    // for no reason.
    expect(healthPortFor(9100, shardIdentity({ SHARDS: '[0]', SHARD_COUNT: '4' }))).toBe(9100);
    expect(healthPortFor(9100, shardIdentity({ SHARDS: '[3]', SHARD_COUNT: '4' }))).toBe(9103);
  });

  it('leaves the configured port alone when there is one process', () => {
    expect(healthPortFor(9100, alone)).toBe(9100);
  });

  it('keeps 0 as off', () => {
    expect(healthPortFor(0, shardIdentity({ SHARDS: '[2]', SHARD_COUNT: '4' }))).toBe(0);
  });
});

describe('who publishes the slash commands', () => {
  it('is shard 0, and nobody else', () => {
    expect(shouldRegisterCommands(shardIdentity({ SHARDS: '[0]', SHARD_COUNT: '4' }))).toBe(true);
    expect(shouldRegisterCommands(shardIdentity({ SHARDS: '[1]', SHARD_COUNT: '4' }))).toBe(false);
    expect(shouldRegisterCommands(shardIdentity({ SHARDS: '[3]', SHARD_COUNT: '4' }))).toBe(false);
  });

  it('is a lone process, which is shard 0', () => {
    expect(shouldRegisterCommands(alone)).toBe(true);
  });
});

describe('refusing to shard onto files', () => {
  const sharded = shardIdentity({ SHARDS: '[1]', SHARD_COUNT: '4' });

  it('refuses, because the damage is silent', () => {
    // Two processes rewriting the same JSON file do not merge: the last writer
    // wins and the other shard's playlists are gone with nothing logged.
    const reason = refuseUnsafeSharding(sharded, 'files');

    expect(reason).toContain('DATABASE_URL');
  });

  it('allows it on Postgres', () => {
    expect(refuseUnsafeSharding(sharded, 'postgres')).toBeUndefined();
  });

  it('leaves a single process alone, whatever it stores things in', () => {
    // One writer is exactly what the file stores were built for.
    expect(refuseUnsafeSharding(alone, 'files')).toBeUndefined();
    expect(
      refuseUnsafeSharding(shardIdentity({ SHARDS: '[0]', SHARD_COUNT: '1' }), 'files'),
    ).toBeUndefined();
  });
});
