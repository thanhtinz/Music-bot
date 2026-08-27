import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerManager } from '../../src/application/player/player-manager';
import { MusicService } from '../../src/application/services/music.service';
import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry, type SourceResolver } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

const TRACK: Track = createTrack({
  source: 'youtube',
  identifier: 'cham-hoa',
  title: 'Chăm Hoa',
  author: 'MONO',
  durationMs: 245_000,
  requesterId: 'user',
});

function resolvers(): ResolverRegistry {
  const registry = new ResolverRegistry();
  registry.register({
    name: 'fake',
    source: 'youtube',
    canHandle: () => true,
    search: async () => [TRACK],
    resolveTrack: async () => TRACK,
  } satisfies SourceResolver);
  return registry;
}

function harness(): { ctx: CommandContext; replies: ReplyPayload[] } {
  const replies: ReplyPayload[] = [];
  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    voiceChannelId: 'voice',
    commandName: 'play',
    args: [],
    rest: '',
    sourceType: 'prefix',
    tier: 'dj',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    async defer() {},
    option: () => undefined,
  } as unknown as CommandContext;

  return { ctx, replies };
}

/**
 * One command must produce one panel.
 *
 * `play` answers with the Now Playing panel, and the player's `trackStart`
 * event announces it as well — so a track a command started was posted twice,
 * once as the reply and once as the announcement. Reported from a real run:
 * "bot cứ lặp lại tin nhắn".
 */
describe('a track a command started', () => {
  let players: PlayerManager;
  let service: MusicService;
  let announced: string[];
  /** Announcements in flight; the event fires them without awaiting. */
  let pending: Promise<void>[];

  beforeEach(() => {
    players = new PlayerManager(new FakeAudioBackend(), { defaultVolume: 60, maxQueueSize: 20 });
    announced = [];
    pending = [];

    service = new MusicService(players, resolvers(), {
      announce: async (channelId) => {
        announced.push(channelId);
        return { setContent: async () => true };
      },
    });

    // Wired exactly as main.ts does it.
    players.onPlayerCreated = (player) => {
      player.on('trackStart', () => {
        pending.push(service.announceTrack(player));
      });
    };
  });

  it('is announced once, not once by the command and once by the event', async () => {
    const { ctx, replies } = harness();

    await service.play(ctx, 'chăm hoa');
    // Drawing a card takes real time; wait for the announcement to land.
    await Promise.all(pending);

    expect(replies).toHaveLength(1);
    expect(announced).toEqual([]);
  });

  it('still announces a track that started with no command behind it', async () => {
    const { ctx } = harness();
    await service.play(ctx, 'cham hoa');
    await Promise.all(pending);

    // The next track begins on its own when this one ends: nobody is waiting
    // on a reply, so the room only learns about it from the announcement.
    const player = players.get('guild')!;
    await player.enqueue(
      createTrack({
        source: 'youtube',
        identifier: 'lac-troi',
        title: 'Lac Troi',
        author: 'Son Tung M-TP',
        durationMs: 231_000,
        requesterId: 'user',
      }),
    );
    announced.length = 0;
    pending.length = 0;
    await player.skip();
    await Promise.all(pending);

    expect(announced).toEqual(['text']);
  });
});
