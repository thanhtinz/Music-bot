import { describe, expect, it } from 'vitest';

import { CommandRegistry, usage } from '../../src/application/commands';
import { catalogByCategory, COMMAND_CATALOG } from '../../src/commands/catalog';

describe('command catalog', () => {
  it('declares no duplicate names or aliases', () => {
    const seen = new Set<string>();

    for (const meta of COMMAND_CATALOG) {
      for (const key of [meta.name, ...(meta.aliases ?? [])]) {
        expect(seen.has(key), `duplicate command key: ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('registers cleanly into a CommandRegistry', () => {
    const registry = new CommandRegistry();

    for (const meta of COMMAND_CATALOG) {
      registry.register({ ...meta, execute: async () => undefined });
    }

    expect(registry.list()).toHaveLength(COMMAND_CATALOG.length);
    expect(registry.get('p')?.name).toBe('play');
    expect(registry.get('np')?.name).toBe('nowplaying');
  });

  it('covers the command matrix from the specification', () => {
    const names = new Set(COMMAND_CATALOG.map((meta) => meta.name));

    for (const required of [
      'play',
      'pause',
      'resume',
      'skip',
      'previous',
      'stop',
      'queue',
      'shuffle',
      'loop',
      'autoplay',
      'volume',
      'seek',
      'filter',
      'lyrics',
      'nowplaying',
      'playlist',
      'favorite',
      '247',
      'settings',
      'help',
    ]) {
      expect(names.has(required), `missing command: ${required}`).toBe(true);
    }
  });

  it('uses lowercase names so parsing stays case-insensitive', () => {
    for (const meta of COMMAND_CATALOG) {
      expect(meta.name).toBe(meta.name.toLowerCase());
      for (const alias of meta.aliases ?? []) expect(alias).toBe(alias.toLowerCase());
    }
  });

  it('gives every command a description', () => {
    for (const meta of COMMAND_CATALOG) {
      expect(meta.description.length).toBeGreaterThan(4);
    }
  });

  it('renders usage identically for slash and prefix', () => {
    const play = COMMAND_CATALOG.find((meta) => meta.name === 'play');
    const command = { ...play!, execute: async () => undefined };

    expect(usage(command, '/')).toBe('/play <query>');
    expect(usage(command, '!')).toBe('!play <query>');
  });

  it('groups every command into a category', () => {
    const grouped = catalogByCategory();
    const total = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);

    expect(total).toBe(COMMAND_CATALOG.length);
    expect(grouped.get('playback')?.length).toBeGreaterThan(0);
  });
});
