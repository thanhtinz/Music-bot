import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import { MusicService } from '../../src/application/services/music.service';
import { buildCommands } from '../../src/commands/handlers';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';
import { cardFile } from '../../src/ui/canvas';

function song(title: string, overrides: Partial<Parameters<typeof createTrack>[0]> = {}): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
    ...overrides,
  });
}

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
    commandName: 'forward',
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

describe('stepping through a track', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {});

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Playing'));
    await player.seek(60_000);
  });

  it('jumps ahead from where the track is now', async () => {
    await service.nudge(harness().ctx, 30_000);

    expect(backend.position('guild')).toBe(90_000);
  });

  it('jumps back from where the track is now', async () => {
    await service.nudge(harness().ctx, -30_000);

    expect(backend.position('guild')).toBe(30_000);
  });

  it('lands on the ends rather than off them', async () => {
    await service.nudge(harness().ctx, -5_000_000);
    expect(backend.position('guild')).toBe(0);

    await service.nudge(harness().ctx, 5_000_000);
    // The track's own length: 200s.
    expect(backend.position('guild')).toBe(200_000);
  });

  it('replays from the top', async () => {
    await service.replay(harness().ctx);

    expect(backend.position('guild')).toBe(0);
  });

  it('redraws the panel, so the progress bar moves with it', async () => {
    const { ctx, replies } = harness();

    await service.nudge(ctx, 10_000);

    expect(replies.at(-1)?.attachments?.[0]?.name).toBe(cardFile('now-playing'));
  });

  it('says why a live stream cannot be stepped through', async () => {
    const player = players.get('guild')!;
    await player.stop();
    await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await players.get('guild')!.enqueue(song('Radio', { isStream: true, durationMs: 0 }));

    const { ctx, replies } = harness();
    await service.nudge(ctx, 10_000);

    // Otherwise the panel would be redrawn unchanged and nobody would know why.
    expect(replies.at(-1)?.content).toMatch(/live stream/i);
    expect(replies.at(-1)?.ephemeral).toBe(true);
  });
});

describe('the forward and rewind commands', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  /** Runs a catalog command by name, the way the router does. */
  async function run(name: string, ctx: CommandContext): Promise<void> {
    const command = buildCommands(service, { prefix: '!', botName: 'Melody' }).find(
      (candidate) => candidate.name === name,
    );
    await command?.execute(ctx);
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {});

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Playing'));
    await player.seek(60_000);
  });

  it('steps ten seconds when nobody says how far', async () => {
    await run('forward', harness().ctx);
    expect(backend.position('guild')).toBe(70_000);

    await run('rewind', harness({ commandName: 'rewind' }).ctx);
    expect(backend.position('guild')).toBe(60_000);
  });

  it('takes a distance as an option or as typed text', async () => {
    await run('forward', harness({ option: () => '30' }).ctx);
    expect(backend.position('guild')).toBe(90_000);

    await run('rewind', harness({ commandName: 'rewind', rest: '1:00' }).ctx);
    expect(backend.position('guild')).toBe(30_000);
  });

  it('asks again rather than guessing at nonsense', async () => {
    const { ctx, replies } = harness({ rest: 'soon' });

    await run('forward', ctx);

    expect(backend.position('guild')).toBe(60_000);
    expect(replies.at(-1)?.content).toMatch(/distance/i);
  });
});
