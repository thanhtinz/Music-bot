import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { MusicService } from '../../src/application/services/music.service';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    voiceChannelId: 'voice',
    commandName: 'join',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'dj',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    async defer() {},
    option: () => undefined,
    ...overrides,
  } as CommandContext;

  return { ctx, replies };
}

describe('a guild’s starting volume', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 70, maxQueueSize: 20 });
  });

  type MusicServiceVolume = (guildId: string) => Promise<number | undefined>;

  /** A service whose guilds start at `volume`, when it knows one. */
  function service(startingVolumeFor?: MusicServiceVolume): MusicService {
    return new MusicService(players, new ResolverRegistry(), {
      defaultVolume: 70,
      ...(startingVolumeFor ? { startingVolumeFor } : {}),
    });
  }

  it('starts a new player at the volume the guild set', async () => {
    await service(async () => 45).join(harness().ctx);

    // Otherwise `settings volume` would write a number nothing reads.
    expect(players.get('guild')?.volume).toBe(45);
  });

  it('falls back to the environment default when the guild set nothing', async () => {
    await service(async () => undefined).join(harness().ctx);

    expect(players.get('guild')?.volume).toBe(70);
  });

  it('falls back when the settings read fails', async () => {
    await service(async () => {
      throw new Error('store is down');
    }).join(harness().ctx);

    // A player at the default beats no player at all.
    expect(players.get('guild')?.volume).toBe(70);
  });

  it('applies on play, not only on join', async () => {
    const quiet = service(async () => 30);
    await quiet.play(harness({ commandName: 'play' }).ctx, 'nothing findable');

    expect(players.get('guild')?.volume).toBe(30);
  });

  it('gives two guilds their own starting volume', async () => {
    const perGuild = service(async (guildId) => (guildId === 'loud' ? 120 : 25));

    await perGuild.join(harness({ guildId: 'loud' }).ctx);
    await perGuild.join(harness({ guildId: 'quiet' }).ctx);

    expect(players.get('loud')?.volume).toBe(120);
    expect(players.get('quiet')?.volume).toBe(25);
  });

  it('leaves a player that already exists alone', async () => {
    const changing = service(async () => 45);
    await changing.join(harness().ctx);
    await players.get('guild')!.setVolume(90);

    await changing.join(harness().ctx);

    // The setting is what a player starts at, not a lever that resets one
    // mid-session.
    expect(players.get('guild')?.volume).toBe(90);
  });
});
