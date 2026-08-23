import type { StatsRepository } from '../../application/stats/stats-repository';
import type { GuildStats } from '../../domain/stats';

import { JsonStore } from './json-store';

/** Listening stats in a JSON file, on the store the other three use. */
export class JsonStatsRepository implements StatsRepository {
  private readonly store: JsonStore<GuildStats>;

  constructor(filePath: string) {
    this.store = new JsonStore<GuildStats>({
      filePath,
      version: 1,
      collectionKey: 'guilds',
      label: 'stats store',
      idOf: (stats) => stats.guildId,
      isValid: isGuildStats,
    });
  }

  async find(guildId: string): Promise<GuildStats | undefined> {
    return this.store.get(guildId);
  }

  async save(stats: GuildStats): Promise<void> {
    await this.store.put(stats);
  }
}

function isGuildStats(value: unknown): value is GuildStats {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GuildStats>;

  return (
    typeof candidate.guildId === 'string' &&
    Array.isArray(candidate.tracks) &&
    Array.isArray(candidate.users) &&
    typeof candidate.totalPlays === 'number'
  );
}
