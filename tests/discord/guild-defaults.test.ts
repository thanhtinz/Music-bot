import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySettingsRepository, SettingsService } from '../../src/application/settings';
import { guildDefaults } from '../../src/infrastructure/discord/bot';

const DEFAULTS = { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 };

describe('guildDefaults', () => {
  let repository: InMemorySettingsRepository;
  let settings: SettingsService;

  /** Applies one setting the way the command does. */
  async function set(guildId: string, key: string, value: string): Promise<void> {
    await settings.set(
      {
        guildId,
        userId: 'mod',
        tier: 'moderator',
        async reply() {},
      } as never,
      key,
      value,
    );
  }

  beforeEach(() => {
    repository = new InMemorySettingsRepository();
    settings = new SettingsService(repository, { defaults: DEFAULTS });
  });

  it('falls back to the environment for a guild that has set nothing', async () => {
    const { prefix, permissions } = await guildDefaults(
      { prefix: '!', permissions: { djRoleId: 'env-dj' }, settings },
      'fresh',
    );

    expect(prefix).toBe('!');
    expect(permissions.djRoleId).toBe('env-dj');
  });

  it('uses the prefix a guild set for itself', async () => {
    await set('guild', 'prefix', '?');

    const { prefix } = await guildDefaults({ prefix: '!', permissions: {}, settings }, 'guild');

    // Otherwise `settings prefix` would be a switch wired to nothing.
    expect(prefix).toBe('?');
  });

  it('keeps two guilds on their own prefixes', async () => {
    await set('one', 'prefix', '?');
    await set('two', 'prefix', '$');

    const options = { prefix: '!', permissions: {}, settings };

    expect((await guildDefaults(options, 'one')).prefix).toBe('?');
    expect((await guildDefaults(options, 'two')).prefix).toBe('$');
    expect((await guildDefaults(options, 'three')).prefix).toBe('!');
  });

  it('uses the DJ role a guild set, over the environment’s', async () => {
    await set('guild', 'djrole', '<@&123456789012345678>');

    const { permissions } = await guildDefaults(
      { prefix: '!', permissions: { djRoleId: 'env-dj' }, settings },
      'guild',
    );

    expect(permissions.djRoleId).toBe('123456789012345678');
  });

  it('keeps the rest of the environment’s permissions', async () => {
    await set('guild', 'djrole', '<@&123456789012345678>');

    const { permissions } = await guildDefaults(
      { prefix: '!', permissions: { everyoneIsDj: true, botOwnerIds: ['owner'] }, settings },
      'guild',
    );

    expect(permissions.everyoneIsDj).toBe(true);
    expect(permissions.botOwnerIds).toEqual(['owner']);
  });

  it('falls back to the defaults when the settings read fails', async () => {
    const broken = {
      forGuild: async () => {
        throw new Error('store is down');
      },
    } as unknown as SettingsService;

    // Dropping every command because a settings file is unreadable would be
    // the worse failure.
    const { prefix } = await guildDefaults(
      { prefix: '!', permissions: {}, settings: broken },
      'guild',
    );

    expect(prefix).toBe('!');
  });

  it('works with no settings service at all', async () => {
    const { prefix, permissions } = await guildDefaults(
      { prefix: '!', permissions: { djRoleId: 'env-dj' } },
      'guild',
    );

    expect(prefix).toBe('!');
    expect(permissions.djRoleId).toBe('env-dj');
  });
});
