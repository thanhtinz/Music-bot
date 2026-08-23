import type { GuildStats } from '../../domain/stats';

/** Storage seam for listening stats — the same port shape as the others. */
export interface StatsRepository {
  find(guildId: string): Promise<GuildStats | undefined>;
  save(stats: GuildStats): Promise<void>;
}

/** Non-persistent store, for tests and for running without a stats file. */
export class InMemoryStatsRepository implements StatsRepository {
  private readonly stats = new Map<string, GuildStats>();

  async find(guildId: string): Promise<GuildStats | undefined> {
    return this.stats.get(guildId);
  }

  async save(stats: GuildStats): Promise<void> {
    this.stats.set(stats.guildId, stats);
  }
}
