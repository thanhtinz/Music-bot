import type { GuildSettings } from '../../domain/settings';

import type { SettingsRepository } from './settings-repository';

/** How long a cached answer is trusted before it is read again. */
export const SETTINGS_CACHE_TTL_MS = 5 * 60_000;
/** How many guilds are remembered before the oldest is dropped. */
export const SETTINGS_CACHE_MAX = 5_000;

export interface CachedSettingsOptions {
  ttlMs?: number;
  max?: number;
  /** Injectable so tests are not at the mercy of the clock. */
  now?: () => number;
}

interface Entry {
  /** `undefined` is a real answer: the guild has never changed a setting. */
  settings: GuildSettings | undefined;
  readAt: number;
}

/**
 * Remembers what the store said, because the store is asked constantly.
 *
 * Every message in every guild goes through a settings read before the bot even
 * knows whether it is a command: the guild's own prefix is what decides that,
 * and a prefix that can be configured and is then ignored would make the
 * setting a switch wired to nothing. That read was free against the JSON store,
 * which keeps its records in memory after the first load. Against Postgres it
 * became a network round trip per message — a busy server spends a hundred
 * queries a minute discovering that none of them started with `!`.
 *
 * A miss is cached too, and that is the important half: most guilds never
 * change a setting, so `find` returning nothing is the common case and the one
 * that would otherwise query forever.
 *
 * In process rather than in Redis, deliberately. A guild lives on exactly one
 * shard, so its settings are read and written by exactly one process — there is
 * no second reader to share a cache with, and putting one on the network would
 * add a hop to solve a problem a `Map` already solves. Writes go through here,
 * so the cache cannot be stale for anything the bot itself did; the TTL is
 * there for the operator who edits a row by hand.
 */
export class CachedSettingsRepository implements SettingsRepository {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  /** Read for the metrics endpoint and for the tests that prove it works. */
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: SettingsRepository,
    options: CachedSettingsOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? SETTINGS_CACHE_TTL_MS;
    this.max = Math.max(1, options.max ?? SETTINGS_CACHE_MAX);
    this.now = options.now ?? (() => Date.now());
  }

  async find(guildId: string): Promise<GuildSettings | undefined> {
    const cached = this.entries.get(guildId);

    if (cached && this.now() - cached.readAt < this.ttlMs) {
      this.hits += 1;
      // Moved to the back on a hit, so a guild that is read constantly is never
      // the one evicted for having been *loaded* long ago. Without this the
      // eviction order is least-recently-loaded, which is a different thing
      // wearing the same name.
      this.entries.delete(guildId);
      this.entries.set(guildId, cached);
      return cached.settings;
    }

    this.misses += 1;
    const settings = await this.inner.find(guildId);
    this.remember(guildId, settings);

    return settings;
  }

  async save(settings: GuildSettings): Promise<void> {
    await this.inner.save(settings);
    // Written through rather than invalidated: the next read is usually the
    // very next message, and it already knows the answer.
    this.remember(settings.guildId, settings);
  }

  /** Drops a guild, so the next read goes to the store. */
  forget(guildId: string): void {
    this.entries.delete(guildId);
  }

  private remember(guildId: string, settings: GuildSettings | undefined): void {
    // Re-inserted rather than updated in place, so the map's insertion order
    // stays least-recently-read first and eviction can take the front.
    this.entries.delete(guildId);
    this.entries.set(guildId, { settings, readAt: this.now() });

    if (this.entries.size <= this.max) return;

    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}
