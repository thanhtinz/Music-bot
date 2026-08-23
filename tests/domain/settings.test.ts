import { describe, expect, it } from 'vitest';

import {
  applySetting,
  createSettings,
  findSetting,
  formatDuration,
  MAX_IDLE_TIMEOUT_MS,
  MIN_IDLE_TIMEOUT_MS,
  parseDuration,
  SETTING_DESCRIPTORS,
  SettingsError,
  type GuildSettings,
} from '../../src/domain/settings';

const DEFAULTS = { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 };

function settings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return { ...createSettings('guild', DEFAULTS, 1), ...overrides };
}

describe('createSettings', () => {
  it('starts from the environment defaults', () => {
    const created = createSettings('guild', DEFAULTS, 5);

    expect(created).toMatchObject({
      guildId: 'guild',
      prefix: '!',
      defaultVolume: 70,
      stayConnected: false,
      idleTimeoutMs: 300_000,
      updatedAt: 5,
    });
  });

  it('leaves the DJ role unset rather than storing undefined', () => {
    expect(createSettings('guild', DEFAULTS)).not.toHaveProperty('djRoleId');
  });
});

describe('findSetting', () => {
  it('ignores case, spaces and separators', () => {
    for (const key of [
      'idletimeout',
      'IdleTimeout',
      'idle-timeout',
      'idle timeout',
      'idle_timeout',
    ]) {
      expect(findSetting(key).key).toBe('idletimeout');
    }
  });

  it('lists what it knows when the key is wrong', () => {
    expect(() => findSetting('colour')).toThrow(/No setting called/);
    expect(() => findSetting('colour')).toThrow(/prefix/);
  });
});

describe('applySetting', () => {
  it('stamps the change time', () => {
    const { settings: updated } = applySetting(settings(), 'volume', '90', 42);
    expect(updated.updatedAt).toBe(42);
  });

  describe('prefix', () => {
    it('accepts a short prefix', () => {
      expect(applySetting(settings(), 'prefix', ' ? ').settings.prefix).toBe('?');
    });

    it('rejects an empty, long, or spaced prefix', () => {
      expect(() => applySetting(settings(), 'prefix', '   ')).toThrow(SettingsError);
      expect(() => applySetting(settings(), 'prefix', 'toolong')).toThrow(/1-5/);
      expect(() => applySetting(settings(), 'prefix', 'a b')).toThrow(/no spaces/);
    });
  });

  describe('volume', () => {
    it('accepts the whole range', () => {
      expect(applySetting(settings(), 'volume', '0').settings.defaultVolume).toBe(0);
      expect(applySetting(settings(), 'volume', '200').settings.defaultVolume).toBe(200);
    });

    it('rejects anything that is not a whole number in range', () => {
      for (const bad of ['-1', '201', 'loud', '70.5', '']) {
        expect(() => applySetting(settings(), 'volume', bad)).toThrow(SettingsError);
      }
    });
  });

  describe('djrole', () => {
    it('accepts a bare id and a mention alike', () => {
      expect(applySetting(settings(), 'djrole', '123456789').settings.djRoleId).toBe('123456789');
      expect(applySetting(settings(), 'djrole', '<@&123456789>').settings.djRoleId).toBe(
        '123456789',
      );
    });

    it('clears the role rather than storing a word', () => {
      const set = applySetting(settings(), 'djrole', '123456789').settings;

      expect(applySetting(set, 'djrole', 'none').settings).not.toHaveProperty('djRoleId');
      expect(applySetting(set, 'djrole', 'clear').settings).not.toHaveProperty('djRoleId');
    });

    it('rejects something that is not an id', () => {
      expect(() => applySetting(settings(), 'djrole', '@DJ')).toThrow(SettingsError);
    });
  });

  describe('idletimeout', () => {
    it('accepts the units people type', () => {
      expect(applySetting(settings(), 'idletimeout', '90s').settings.idleTimeoutMs).toBe(90_000);
      expect(applySetting(settings(), 'idletimeout', '5m').settings.idleTimeoutMs).toBe(300_000);
      expect(applySetting(settings(), 'idletimeout', '1h').settings.idleTimeoutMs).toBe(3_600_000);
    });

    it('holds the bounds', () => {
      expect(() => applySetting(settings(), 'idletimeout', '1s')).toThrow(SettingsError);
      expect(() => applySetting(settings(), 'idletimeout', '2h')).toThrow(SettingsError);
      expect(
        applySetting(settings(), 'idletimeout', `${MIN_IDLE_TIMEOUT_MS}ms`).settings.idleTimeoutMs,
      ).toBe(MIN_IDLE_TIMEOUT_MS);
      expect(
        applySetting(settings(), 'idletimeout', `${MAX_IDLE_TIMEOUT_MS}ms`).settings.idleTimeoutMs,
      ).toBe(MAX_IDLE_TIMEOUT_MS);
    });
  });

  describe('247', () => {
    it('takes the words people use for a switch', () => {
      for (const on of ['on', 'true', 'yes', 'enable', 'ON']) {
        expect(applySetting(settings(), '247', on).settings.stayConnected).toBe(true);
      }
      for (const off of ['off', 'false', 'no', 'disable']) {
        expect(
          applySetting(settings({ stayConnected: true }), '247', off).settings.stayConnected,
        ).toBe(false);
      }
    });

    it('rejects anything else', () => {
      expect(() => applySetting(settings(), '247', 'maybe')).toThrow(SettingsError);
    });
  });
});

describe('formatting', () => {
  it('shows every setting without throwing', () => {
    for (const descriptor of SETTING_DESCRIPTORS) {
      expect(typeof descriptor.format(settings())).toBe('string');
    }
  });

  it('says the idle timeout is off while 24/7 is on', () => {
    const descriptor = findSetting('idletimeout');

    expect(descriptor.format(settings({ stayConnected: true }))).toContain('24/7');
  });
});

describe('parseDuration / formatDuration', () => {
  it('defaults a bare number to seconds', () => {
    expect(parseDuration('30')).toBe(30_000);
  });

  it('rejects what it cannot read', () => {
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseDuration('5 days')).toBeUndefined();
  });

  it('round-trips the units it prints', () => {
    for (const text of ['45s', '5m', '2h']) {
      expect(formatDuration(parseDuration(text)!)).toBe(text);
    }
  });
});
