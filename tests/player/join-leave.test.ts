import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack } from '../../src/domain/music';
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
    voiceChannelId: 'voice-a',
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

describe('join and leave', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 10 });
    service = new MusicService(players, new ResolverRegistry(), {
      channelName: (id) => (id === 'voice-a' ? 'general-voice' : undefined),
    });
  });

  describe('join', () => {
    it('connects to the caller’s channel without queueing anything', async () => {
      const { ctx, replies } = harness();

      await service.join(ctx);

      const player = players.get('guild');
      expect(player?.voiceChannelId).toBe('voice-a');
      expect(player?.queue.isEmpty).toBe(true);
      // A card cannot render `<#id>`; Discord only turns that into a mention
      // in chat, so the channel has to be named.
      expect(replies[0]?.content).toContain('#general-voice');
      expect(replies[0]?.content).not.toContain('<#');
      expect(replies[0]?.title).toBe('Joined');
    });

    it('asks for a channel when the caller is not in one', async () => {
      const { ctx, replies } = harness({ voiceChannelId: undefined });

      await service.join(ctx);

      expect(players.has('guild')).toBe(false);
      expect(replies[0]?.ephemeral).toBe(true);
      expect(replies[0]?.content).toContain('Join a voice channel');
    });

    it('says so when it is already in that channel', async () => {
      const { ctx } = harness();
      await service.join(ctx);

      const { ctx: again, replies } = harness();
      await service.join(again);

      expect(replies[0]?.title).toBe('Already here');
      expect(replies[0]?.ephemeral).toBe(true);
    });

    it('moves when the caller is somewhere else', async () => {
      await service.join(harness().ctx);

      const { ctx, replies } = harness({ voiceChannelId: 'voice-b', channelId: 'text-b' });
      await service.join(ctx);

      const player = players.get('guild');
      expect(player?.voiceChannelId).toBe('voice-b');
      // Moving follows the person, so the panel follows them too.
      expect(player?.textChannelId).toBe('text-b');
      expect(replies[0]?.title).toBe('Moved');
    });

    it('actually reconnects the backend when it moves', async () => {
      await service.join(harness().ctx);
      backend.calls.length = 0;

      await service.join(harness({ voiceChannelId: 'voice-b' }).ctx);

      // Changing the field alone would leave the bot sitting in the old
      // channel, which is what a plain connect() would have done.
      expect(backend.calls).toContain('connect:guild:voice-b');
    });

    it('picks the current track back up where it left off', async () => {
      await service.join(harness().ctx);
      const player = players.get('guild')!;
      await player.enqueue(
        createTrack({
          source: 'youtube',
          identifier: 'a',
          title: 'Faded',
          author: 'Alan Walker',
          durationMs: 200_000,
          requesterId: 'user',
        }),
      );
      await player.seek(45_000);
      backend.calls.length = 0;

      await service.join(harness({ voiceChannelId: 'voice-b' }).ctx);

      // A move destroys the backend's player, so the track has to be started
      // again — from where it had got to, not from the top.
      expect(backend.calls).toContain('play:guild:Faded');
      expect(backend.calls).toContain('seek:guild:45000');
      expect(player.status).toBe('playing');
    });

    it('stays paused across a move', async () => {
      await service.join(harness().ctx);
      const player = players.get('guild')!;
      await player.enqueue(
        createTrack({
          source: 'youtube',
          identifier: 'a',
          title: 'Faded',
          author: 'Alan Walker',
          durationMs: 200_000,
          requesterId: 'user',
        }),
      );
      await player.pause();

      await service.join(harness({ voiceChannelId: 'voice-b' }).ctx);

      expect(player.status).toBe('paused');
      expect(backend.isPaused('guild')).toBe(true);
    });

    it('keeps the queue when it moves', async () => {
      await service.join(harness().ctx);
      const player = players.get('guild');
      player!.queue.add(
        createTrack({
          source: 'youtube',
          identifier: 'a',
          title: 'Faded',
          author: 'Alan Walker',
          durationMs: 1000,
          requesterId: 'user',
        }),
      );

      await service.join(harness({ voiceChannelId: 'voice-b' }).ctx);

      expect(players.get('guild')?.queue.size).toBe(1);
    });
  });

  describe('leave', () => {
    it('disconnects and forgets the player', async () => {
      await service.join(harness().ctx);

      const { ctx, replies } = harness({ commandName: 'leave' });
      await service.leave(ctx);

      expect(players.has('guild')).toBe(false);
      expect(replies[0]?.content).toContain('#general-voice');
      expect(replies[0]?.title).toBe('Left the channel');
    });

    it('says how many tracks went with it', async () => {
      await service.join(harness().ctx);
      const player = players.get('guild');
      for (const title of ['One', 'Two']) {
        player!.queue.add(
          createTrack({
            source: 'youtube',
            identifier: title,
            title,
            author: 'Artist',
            durationMs: 1000,
            requesterId: 'user',
          }),
        );
      }

      const { ctx, replies } = harness();
      await service.leave(ctx);

      expect(replies[0]?.content).toContain('**2** queued track(s)');
    });

    it('does not mention a queue that was empty', async () => {
      await service.join(harness().ctx);

      const { ctx, replies } = harness();
      await service.leave(ctx);

      expect(replies[0]?.content).not.toContain('queued track');
    });

    it('falls back to a neutral phrase for a channel it cannot name', async () => {
      await service.join(harness().ctx);
      await service.join(harness({ voiceChannelId: 'voice-b' }).ctx);

      const { ctx, replies } = harness();
      await service.leave(ctx);

      expect(replies[0]?.content).toContain('the voice channel');
    });

    it('says so when it is not connected', async () => {
      const { ctx, replies } = harness();

      await service.leave(ctx);

      expect(replies[0]?.title).toBe('Not connected');
      expect(replies[0]?.ephemeral).toBe(true);
    });
  });
});
