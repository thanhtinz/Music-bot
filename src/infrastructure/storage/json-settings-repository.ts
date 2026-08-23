import type { SettingsRepository } from '../../application/settings/settings-repository';
import type { GuildSettings } from '../../domain/settings';

import { JsonStore } from './json-store';

/** Guild settings in a JSON file, on the same store the playlists use. */
export class JsonSettingsRepository implements SettingsRepository {
  private readonly store: JsonStore<GuildSettings>;

  constructor(filePath: string) {
    this.store = new JsonStore<GuildSettings>({
      filePath,
      version: 1,
      collectionKey: 'guilds',
      label: 'settings store',
      idOf: (settings) => settings.guildId,
      isValid: isGuildSettings,
    });
  }

  async find(guildId: string): Promise<GuildSettings | undefined> {
    return this.store.get(guildId);
  }

  async save(settings: GuildSettings): Promise<void> {
    await this.store.put(settings);
  }
}

function isGuildSettings(value: unknown): value is GuildSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GuildSettings>;

  return (
    typeof candidate.guildId === 'string' &&
    typeof candidate.prefix === 'string' &&
    typeof candidate.defaultVolume === 'number'
  );
}
