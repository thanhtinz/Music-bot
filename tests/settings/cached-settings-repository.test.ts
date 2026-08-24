import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CachedSettingsRepository,
  InMemorySettingsRepository,
  type SettingsRepository,
} from '../../src/application/settings';
import { createSettings, type GuildSettings } from '../../src/domain/settings';

const DEFAULTS = { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 };

function settingsFor(guildId: string, prefix = '!'): GuildSettings {
  return { ...createSettings(guildId, DEFAULTS, 1_000), prefix };
}

/** A store that counts what it was asked, so the cache can be proved. */
function counting(): { store: SettingsRepository; finds: string[]; saves: string[] } {
  const inner = new InMemorySettingsRepository();
  const finds: string[] = [];
  const saves: string[] = [];

  return {
    finds,
    saves,
    store: {
      async find(guildId) {
        finds.push(guildId);
        return inner.find(guildId);
      },
      async save(settings) {
        saves.push(settings.guildId);
        return inner.save(settings);
      },
    },
  };
}

describe('caching what the settings store said', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000;
  });

  it('asks the store once and answers the rest itself', async () => {
    const { store, finds } = counting();
    await store.save(settingsFor('guild', '?'));
    const cache = new CachedSettingsRepository(store, { now });

    for (let i = 0; i < 50; i++) await cache.find('guild');

    expect(finds).toEqual(['guild']);
    expect(cache.hits).toBe(49);
  });

  it('caches a guild that has no settings at all', async () => {
    // The important half: most guilds never change a setting, so `find`
    // returning nothing is the common case and the one that would otherwise
    // query on every message forever.
    const { store, finds } = counting();
    const cache = new CachedSettingsRepository(store, { now });

    expect(await cache.find('never-configured')).toBeUndefined();
    expect(await cache.find('never-configured')).toBeUndefined();

    expect(finds).toEqual(['never-configured']);
  });

  it('reads again once the entry is stale', async () => {
    const { store, finds } = counting();
    const cache = new CachedSettingsRepository(store, { now, ttlMs: 60_000 });

    await cache.find('guild');
    clock += 59_000;
    await cache.find('guild');
    clock += 2_000;
    await cache.find('guild');

    expect(finds).toEqual(['guild', 'guild']);
  });

  it('serves what was just written without going back to the store', async () => {
    const { store, finds } = counting();
    const cache = new CachedSettingsRepository(store, { now });

    await cache.save(settingsFor('guild', '?'));
    const found = await cache.find('guild');

    expect(found?.prefix).toBe('?');
    expect(finds).toEqual([]);
  });

  it('never serves a prefix somebody has already changed', async () => {
    // The failure this whole thing risks: a stale prefix means the bot stops
    // answering the guild, which looks exactly like the bot being down.
    const { store } = counting();
    const cache = new CachedSettingsRepository(store, { now });

    await cache.find('guild');
    await cache.save(settingsFor('guild', '?'));

    expect((await cache.find('guild'))?.prefix).toBe('?');
  });

  it('writes through to the store, not only to itself', async () => {
    const { store, saves } = counting();
    const cache = new CachedSettingsRepository(store, { now });

    await cache.save(settingsFor('guild', '?'));

    expect(saves).toEqual(['guild']);
    expect((await store.find('guild'))?.prefix).toBe('?');
  });

  it('forgets a guild when told to', async () => {
    const { store, finds } = counting();
    const cache = new CachedSettingsRepository(store, { now });

    await cache.find('guild');
    cache.forget('guild');
    await cache.find('guild');

    expect(finds).toEqual(['guild', 'guild']);
  });

  it('drops the least recently read once it is full', async () => {
    const { store, finds } = counting();
    const cache = new CachedSettingsRepository(store, { now, max: 2 });

    await cache.find('a');
    await cache.find('b');
    // Reading `a` again makes `b` the oldest.
    await cache.find('a');
    await cache.find('c');

    finds.length = 0;
    await cache.find('a');
    await cache.find('c');
    expect(finds).toEqual([]);

    await cache.find('b');
    expect(finds).toEqual(['b']);
  });

  it('does not grow without bound', async () => {
    const { store } = counting();
    const cache = new CachedSettingsRepository(store, { now, max: 10 });

    for (let i = 0; i < 500; i++) await cache.find(`guild-${i}`);

    // Nothing here reads the map directly; the proof is that the oldest are
    // gone and the newest are not.
    const finds: string[] = [];
    const spy = vi.spyOn(store, 'find').mockImplementation(async (guildId: string) => {
      finds.push(guildId);
      return undefined;
    });

    await cache.find('guild-499');
    expect(finds).toEqual([]);

    await cache.find('guild-0');
    expect(finds).toEqual(['guild-0']);

    spy.mockRestore();
  });
});
