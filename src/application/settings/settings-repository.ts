import type { GuildSettings } from '../../domain/settings';

/**
 * Storage seam for guild settings.
 *
 * Same shape as the playlist port, and for the same reason: the service is
 * written against this so the store can move to Postgres in F8 without the
 * command layer knowing (spec §1.2).
 */
export interface SettingsRepository {
  find(guildId: string): Promise<GuildSettings | undefined>;
  save(settings: GuildSettings): Promise<void>;
}

/** Non-persistent store, used by the tests and when no path is configured. */
export class InMemorySettingsRepository implements SettingsRepository {
  private readonly settings = new Map<string, GuildSettings>();

  async find(guildId: string): Promise<GuildSettings | undefined> {
    return this.settings.get(guildId);
  }

  async save(settings: GuildSettings): Promise<void> {
    this.settings.set(settings.guildId, settings);
  }
}
