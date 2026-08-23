/**
 * Per-guild configuration.
 *
 * Everything here overrides an environment default for one guild, so a server
 * can be set up without a redeploy. Values are validated on the way in, which
 * is what keeps a bad `settings` call from poisoning playback later.
 */
export interface GuildSettings {
  readonly guildId: string;
  /** Prefix for message commands. */
  readonly prefix: string;
  /** Volume new players start at. */
  readonly defaultVolume: number;
  /** Role that satisfies the `dj` tier; unset means the env default applies. */
  readonly djRoleId?: string;
  /** Stay in voice when the queue runs out, instead of leaving when idle. */
  readonly stayConnected: boolean;
  /** How long an idle player waits before leaving, when not staying connected. */
  readonly idleTimeoutMs: number;
  readonly updatedAt: number;
}

export const MIN_IDLE_TIMEOUT_MS = 30_000;
export const MAX_IDLE_TIMEOUT_MS = 3_600_000;

export type SettingsErrorCode = 'unknown-key' | 'invalid-value';

export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** Values a guild starts with, before anybody changes anything. */
export interface SettingsDefaults {
  prefix: string;
  defaultVolume: number;
  djRoleId?: string;
  idleTimeoutMs: number;
}

export function createSettings(
  guildId: string,
  defaults: SettingsDefaults,
  now = Date.now(),
): GuildSettings {
  return {
    guildId,
    prefix: defaults.prefix,
    defaultVolume: defaults.defaultVolume,
    ...(defaults.djRoleId === undefined ? {} : { djRoleId: defaults.djRoleId }),
    stayConnected: false,
    idleTimeoutMs: defaults.idleTimeoutMs,
    updatedAt: now,
  };
}

/**
 * One editable setting.
 *
 * Declared as data so the `settings` command, the card and the validation all
 * read from the same list — a new setting cannot be half-added.
 */
export interface SettingDescriptor {
  key: string;
  label: string;
  description: string;
  /** How the value is shown on the card. */
  format: (settings: GuildSettings) => string;
  /** Parses raw input, throwing {@link SettingsError} when it will not do. */
  apply: (settings: GuildSettings, raw: string) => GuildSettings;
  /** Example shown when someone gives no value. */
  example: string;
}

function invalid(message: string): never {
  throw new SettingsError('invalid-value', message);
}

export const SETTING_DESCRIPTORS: readonly SettingDescriptor[] = [
  {
    key: 'prefix',
    label: 'Prefix',
    description: 'What message commands start with',
    example: '!',
    format: (settings) => settings.prefix,
    apply: (settings, raw) => {
      const prefix = raw.trim();
      if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
        invalid('A prefix is 1-5 characters with no spaces.');
      }
      return { ...settings, prefix };
    },
  },
  {
    key: 'volume',
    label: 'Default volume',
    description: 'Volume a new player starts at',
    example: '70',
    format: (settings) => `${settings.defaultVolume}%`,
    apply: (settings, raw) => {
      const volume = Number(raw.trim());
      if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
        invalid('Volume is a whole number from 0 to 200.');
      }
      return { ...settings, defaultVolume: volume };
    },
  },
  {
    key: 'djrole',
    label: 'DJ role',
    description: 'Role allowed to run DJ commands',
    example: '@DJ or none',
    format: (settings) => (settings.djRoleId ? `role ${settings.djRoleId}` : 'not set'),
    apply: (settings, raw) => {
      const value = raw.trim();
      if (value === 'none' || value === 'clear') {
        const { djRoleId: _removed, ...rest } = settings;
        return rest;
      }

      // Accepts a raw id or the `<@&id>` a mention pastes as.
      const id = value.replace(/^<@&/, '').replace(/>$/, '');
      if (!/^\d{5,25}$/.test(id)) invalid('Give a role id, a role mention, or `none`.');

      return { ...settings, djRoleId: id };
    },
  },
  {
    key: 'idletimeout',
    label: 'Idle timeout',
    description: 'How long to wait alone before leaving',
    example: '5m',
    format: (settings) =>
      settings.stayConnected ? 'off (24/7 is on)' : formatDuration(settings.idleTimeoutMs),
    apply: (settings, raw) => {
      const ms = parseDuration(raw.trim());
      if (ms === undefined || ms < MIN_IDLE_TIMEOUT_MS || ms > MAX_IDLE_TIMEOUT_MS) {
        invalid(
          `Give a duration between ${formatDuration(MIN_IDLE_TIMEOUT_MS)} and ${formatDuration(
            MAX_IDLE_TIMEOUT_MS,
          )}, e.g. \`5m\`.`,
        );
      }
      return { ...settings, idleTimeoutMs: ms };
    },
  },
  {
    key: '247',
    label: '24/7',
    description: 'Stay in voice when the queue runs out',
    example: 'on / off',
    format: (settings) => (settings.stayConnected ? 'on' : 'off'),
    apply: (settings, raw) => {
      const value = raw.trim().toLowerCase();
      if (['on', 'true', 'yes', 'enable'].includes(value)) {
        return { ...settings, stayConnected: true };
      }
      if (['off', 'false', 'no', 'disable'].includes(value)) {
        return { ...settings, stayConnected: false };
      }
      invalid('24/7 is `on` or `off`.');
    },
  },
];

export function findSetting(key: string): SettingDescriptor {
  const wanted = key
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  const found = SETTING_DESCRIPTORS.find((descriptor) => descriptor.key === wanted);

  if (!found) {
    const known = SETTING_DESCRIPTORS.map((descriptor) => `\`${descriptor.key}\``).join(', ');
    throw new SettingsError('unknown-key', `No setting called **${key}**. Try ${known}.`);
  }

  return found;
}

/** Applies one change, returning the updated settings. */
export function applySetting(
  settings: GuildSettings,
  key: string,
  raw: string,
  now = Date.now(),
): { settings: GuildSettings; descriptor: SettingDescriptor } {
  const descriptor = findSetting(key);

  // Checked once here rather than in each descriptor: no setting takes an empty
  // value, and `Number('')` is 0, so a blank volume would otherwise be accepted
  // as silence.
  if (!raw.trim()) {
    throw new SettingsError(
      'invalid-value',
      `**${descriptor.label}** needs a value, e.g. \`${descriptor.example}\`.`,
    );
  }

  return { settings: { ...descriptor.apply(settings, raw), updatedAt: now }, descriptor };
}

/** `90s`, `5m`, `1h`, or a bare number of seconds. */
export function parseDuration(raw: string): number | undefined {
  const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(raw);
  if (!match) return undefined;

  const amount = Number(match[1]);
  switch ((match[2] ?? 's').toLowerCase()) {
    case 'ms':
      return amount;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    default:
      return amount * 1000;
  }
}

export function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}
