import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerManager } from '../../src/application/player/player-manager';
import { ProgressTicker } from '../../src/application/player/progress-ticker';
import {
  MusicService,
  type MusicServiceOptions,
} from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { applySetting, createSettings } from '../../src/domain/settings';
import { ResolverRegistry } from '../../src/resolvers';
import { cardFile } from '../../src/ui/canvas';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'MONO',
    durationMs: 245_000,
    requesterId: 'user',
  });
}

interface Posted {
  channelId: string;
  payload: { content: string; attachments: { name: string }[]; components?: unknown[] };
}

describe('announcing a track that started on its own', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let posted: Posted[];

  function service(overrides: Partial<MusicServiceOptions> = {}): MusicService {
    return new MusicService(players, new ResolverRegistry(), {
      announce: async (channelId, payload) => {
        posted.push({ channelId, payload });
        return { setContent: async () => true };
      },
      ...overrides,
    });
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    posted = [];

    const player = await players.getOrCreate({
      guildId: 'guild',
      voiceChannelId: 'voice',
      textChannelId: 'text',
    });
    await player.enqueue(song('Chăm Hoa'));
  });

  it('posts the panel into the channel the player belongs to', async () => {
    await service().announceTrack(players.get('guild')!);

    expect(posted).toHaveLength(1);
    expect(posted[0]?.channelId).toBe('text');
    expect(posted[0]?.payload.attachments[0]?.name).toBe(cardFile('now-playing'));
  });

  it('carries the progress line and the controls, like any other panel', async () => {
    await service({
      nowPlayingComponents: () => ['a row'],
    }).announceTrack(players.get('guild')!);

    expect(posted[0]?.payload.content).toContain('0:00 / 4:05');
    expect(posted[0]?.payload.components).toEqual(['a row']);
  });

  it('hands the panel to the ticker, so its bar moves too', async () => {
    const watch = vi.fn();

    await service({ progress: { watch, stop: vi.fn() } }).announceTrack(players.get('guild')!);

    expect(watch).toHaveBeenCalledOnce();
  });

  it('says nothing when the player has no text channel', async () => {
    const stray = await players.getOrCreate({ guildId: 'quiet', voiceChannelId: 'voice' });
    await stray.enqueue(song('Lạc Trôi'));

    await service().announceTrack(stray);

    // Nowhere to post is not an error; it is a player created by a command that
    // never named a channel.
    expect(posted).toEqual([]);
  });

  it('says nothing when nothing is playing', async () => {
    await players.get('guild')!.stop();

    await service().announceTrack(players.get('guild')!);

    expect(posted).toEqual([]);
  });

  it('does nothing at all when no channel port is wired', async () => {
    const quiet = new MusicService(players, new ResolverRegistry(), {});

    // A preview or a test build: promising an announcement would be a lie.
    await expect(quiet.announceTrack(players.get('guild')!)).resolves.toBeUndefined();
  });

  it('lets the ticker follow the newest panel', async () => {
    const ticker = new ProgressTicker({ setTimer: () => 1 as unknown as NodeJS.Timeout });
    const announcing = service({ progress: ticker });

    await announcing.announceTrack(players.get('guild')!);

    expect(ticker.watching('guild')).toBe(true);
  });
});

describe('the announce setting', () => {
  const defaults = { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 };

  it('is on for a guild that has never changed anything', () => {
    // A room that cannot see what is playing has to ask.
    expect(createSettings('guild', defaults).announceTracks).toBe(true);
  });

  it('turns off and back on', () => {
    const off = applySetting(createSettings('guild', defaults), 'announce', 'off');
    expect(off.settings.announceTracks).toBe(false);

    const on = applySetting(off.settings, 'announce', 'on');
    expect(on.settings.announceTracks).toBe(true);
  });

  it('refuses anything that is not on or off', () => {
    expect(() => applySetting(createSettings('guild', defaults), 'announce', 'sometimes')).toThrow(
      /on.*off/i,
    );
  });

  it('shows its state on the settings sheet', () => {
    const off = applySetting(createSettings('guild', defaults), 'announce', 'off');

    expect(off.descriptor.format(off.settings)).toBe('off');
    expect(off.descriptor.label).toBe('Announce tracks');
  });
});

describe('a settings file written before the flag existed', () => {
  it('reads as announcements on rather than off', async () => {
    const { JsonSettingsRepository } =
      await import('../../src/infrastructure/storage/json-settings-repository');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const file = join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        guilds: [
          {
            guildId: 'old',
            prefix: '?',
            defaultVolume: 50,
            stayConnected: false,
            idleTimeoutMs: 300_000,
            updatedAt: 1,
          },
        ],
      }),
    );

    const stored = await new JsonSettingsRepository(file).find('old');

    // `undefined` would read as off, silently muting every guild that had ever
    // changed a setting.
    expect(stored?.announceTracks).toBe(true);
    expect(stored?.prefix).toBe('?');
  });
});
