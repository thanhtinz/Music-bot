import { describe, expect, it } from 'vitest';

import { CommandRegistry, usage } from '../../src/application/commands';
import { catalogByCategory, COMMAND_CATALOG } from '../../src/commands/catalog';
import { categoryIndex, positionOf } from '../../src/commands/handlers';
import { FILTER_PRESETS } from '../../src/infrastructure/lavalink/filters';

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

describe('positionOf', () => {
  it('reads a number', () => {
    expect(positionOf('3')).toBe(3);
    expect(positionOf(' 12 ')).toBe(12);
  });

  it('is not a number when nothing was given', () => {
    // NaN rather than a default: a mistyped position must be refused by the
    // range check, not quietly applied to track 1.
    expect(positionOf(undefined)).toBeNaN();
    expect(positionOf('')).toBeNaN();
    expect(positionOf('   ')).toBeNaN();
    expect(positionOf('first')).toBeNaN();
  });
});

describe('categoryIndex', () => {
  const grouped = [
    ['playback', []],
    ['queue', []],
    ['filters', []],
  ] as ReadonlyArray<readonly [string, unknown]>;

  it('takes a category by its catalog name', () => {
    expect(categoryIndex(grouped, 'queue')).toBe(1);
  });

  it('takes the title shown on the card', () => {
    // The sidebar says "Player", not "playback".
    expect(categoryIndex(grouped, 'Player')).toBe(0);
    expect(categoryIndex(grouped, 'filters')).toBe(2);
  });

  it('takes a number, counting from 1 as the card does', () => {
    expect(categoryIndex(grouped, '2')).toBe(1);
  });

  it('falls back to the first for anything it cannot place', () => {
    expect(categoryIndex(grouped, undefined)).toBe(0);
    expect(categoryIndex(grouped, '')).toBe(0);
    expect(categoryIndex(grouped, 'nonsense')).toBe(0);
    expect(categoryIndex(grouped, '99')).toBe(0);
    expect(categoryIndex(grouped, '0')).toBe(0);
  });
});

describe('option descriptions', () => {
  it('lists every filter preset, so none stays hidden', () => {
    const filter = COMMAND_CATALOG.find((meta) => meta.name === 'filter');

    for (const preset of FILTER_PRESETS) {
      expect(filter?.options?.[0]?.description).toContain(preset);
    }
  });

  it('does not promise queue actions that live in other commands', () => {
    const queue = COMMAND_CATALOG.find((meta) => meta.name === 'queue');

    // `queue add | remove` was advertised and never implemented; adding and
    // removing are what `play` and `remove` do.
    expect(queue?.options?.[0]?.name).toBe('page');
    expect(JSON.stringify(queue)).not.toContain('add |');
  });
});
