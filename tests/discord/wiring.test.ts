import { describe, expect, it } from 'vitest';

import { CommandRegistry, usage } from '../../src/application/commands';
import { COMMAND_CATALOG } from '../../src/commands/catalog';
import { buildCommands, unimplementedCommands } from '../../src/commands/handlers';
import {
  FILTER_PRESETS,
  isFilterPreset,
  toFilterOptions,
} from '../../src/infrastructure/lavalink/filters';
import {
  classifyLoadError,
  toCandidate,
  ENCODED_TRACK_KEY,
} from '../../src/infrastructure/lavalink/lavalink-backend';
import {
  buildSlashCommands,
  toSlashCommand,
} from '../../src/infrastructure/discord/register-commands';
import type { MusicService } from '../../src/application/services/music.service';

const service = {} as MusicService;
const options = { prefix: '!', botName: 'MusicBot' };

describe('command wiring', () => {
  it('registers every wired command without collisions', () => {
    const registry = new CommandRegistry();
    registry.registerAll(buildCommands(service, options));

    expect(registry.list().length).toBeGreaterThan(0);
    expect(registry.get('p')?.name).toBe('play');
  });

  it('keeps each command’s catalog metadata', () => {
    const play = buildCommands(service, options).find((command) => command.name === 'play');

    expect(play?.requiresVoice).toBe(true);
    expect(play?.deferred).toBe(true);
    expect(usage(play!, '/')).toBe('/play <query>');
  });

  it('reports which catalog commands still have no implementation', () => {
    const pending = unimplementedCommands().map((meta) => meta.name);

    // The list exists so anything unbuilt stays visible; everything in the
    // catalog is now wired.
    expect(pending).toEqual([]);
  });
});

describe('slash registration', () => {
  it('converts a catalog entry into a Discord payload', () => {
    const play = COMMAND_CATALOG.find((meta) => meta.name === 'play');
    const payload = toSlashCommand(play!);

    expect(payload).toMatchObject({ name: 'play' });
    expect(payload.options?.[0]).toMatchObject({ name: 'query', required: true });
  });

  it('keeps names and descriptions inside Discord’s limits', () => {
    for (const command of buildSlashCommands()) {
      expect(command.name).toMatch(/^[\w-]{1,32}$/);
      expect(command.name).toBe(command.name.toLowerCase());
      expect(command.description.length).toBeLessThanOrEqual(100);

      for (const option of command.options ?? []) {
        expect(option.description.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('covers the whole catalog', () => {
    expect(buildSlashCommands()).toHaveLength(COMMAND_CATALOG.length);
  });
});

describe('filter presets', () => {
  it('maps every preset without throwing', () => {
    for (const preset of FILTER_PRESETS) {
      expect(() => toFilterOptions(preset)).not.toThrow();
    }
  });

  it('clears previous settings rather than layering onto them', () => {
    // Lavalink leaves absent keys alone, so switching presets has to null out
    // whatever the last one set.
    const nightcore = toFilterOptions('nightcore');
    expect(nightcore.timescale).toMatchObject({ speed: 1.2 });
    expect(nightcore.rotation).toBeNull();
    expect(nightcore.karaoke).toBeNull();

    const cleared = toFilterOptions('default');
    expect(cleared.timescale).toBeNull();
    expect(cleared.equalizer).toEqual([]);
  });

  it('rejects an unknown preset', () => {
    expect(() => toFilterOptions('turbo')).toThrow(/Unknown filter preset/);
    expect(isFilterPreset('turbo')).toBe(false);
    expect(isFilterPreset('bass')).toBe(true);
  });
});

describe('lavalink track mapping', () => {
  const track = {
    encoded: 'base64payload',
    info: {
      identifier: 'dQw4w9WgXcQ',
      isSeekable: true,
      author: 'Alan Walker',
      length: 212_000,
      isStream: false,
      position: 0,
      title: 'Faded',
      uri: 'https://youtu.be/dQw4w9WgXcQ',
      artworkUrl: 'https://i.ytimg.com/vi/x/hq.jpg',
      sourceName: 'youtube',
    },
    pluginInfo: {},
  };

  it('carries the encoded payload needed to play it back', () => {
    const candidate = toCandidate(track);

    expect(candidate.metadata?.[ENCODED_TRACK_KEY]).toBe('base64payload');
    expect(candidate).toMatchObject({ source: 'youtube', title: 'Faded', durationMs: 212_000 });
  });

  it('reports a stream as having no duration', () => {
    const stream = toCandidate({
      ...track,
      info: { ...track.info, isStream: true, length: 9_999_999 },
    });

    expect(stream.durationMs).toBe(0);
    expect(stream.isStream).toBe(true);
  });

  it('maps unknown sources to http rather than guessing', () => {
    const other = toCandidate({ ...track, info: { ...track.info, sourceName: 'bandcamp' } });
    expect(other.source).toBe('http');
  });
});

describe('lavalink error classification', () => {
  it('recognises the failures worth telling the user about', () => {
    expect(classifyLoadError('This video is age-restricted', 'common').code).toBe('AGE_RESTRICTED');
    expect(classifyLoadError('This video is private', 'common').code).toBe('PRIVATE');
    expect(classifyLoadError('Video unavailable', 'common').code).toBe('UNAVAILABLE');
    expect(classifyLoadError('Rate limit reached', 'suspicious').code).toBe('RATE_LIMITED');
    expect(classifyLoadError('Request timed out', 'fault').code).toBe('TIMEOUT');
  });

  it('separates our fault from the request’s fault', () => {
    // `common` means the request was wrong; anything else points at the node.
    expect(classifyLoadError('no matches', 'common').code).toBe('NOT_FOUND');
    expect(classifyLoadError('something broke', 'fault').code).toBe('PROVIDER_ERROR');
  });

  it('does not mark a definitive answer as a provider fault', () => {
    // Otherwise a run of missing tracks would trip the circuit breaker.
    expect(classifyLoadError('no matches', 'common').indicatesProviderFault).toBe(false);
    expect(classifyLoadError('node exploded', 'fault').indicatesProviderFault).toBe(true);
  });
});
