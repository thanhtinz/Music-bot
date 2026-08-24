import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import {
  MusicService,
  type MusicServiceOptions,
} from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { cardFile } from '../../src/ui/canvas';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(): Track {
  return createTrack({
    source: 'youtube',
    identifier: 'cham-hoa',
    title: 'Chăm Hoa',
    author: 'MONO',
    durationMs: 245_000,
    uri: 'https://youtu.be/cham-hoa',
    requesterId: 'user',
  });
}

function harness(): { ctx: CommandContext; replies: ReplyPayload[] } {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'user',
    voiceChannelId: 'voice',
    commandName: 'grab',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'everyone',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    async defer() {},
    option: () => undefined,
  } as CommandContext;

  return { ctx, replies };
}

describe('grab', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let sent: { userId: string; payload: { content: string; attachments?: unknown[] } }[];

  function service(overrides: Partial<MusicServiceOptions> = {}): MusicService {
    return new MusicService(players, new ResolverRegistry(), {
      guildName: () => 'Melody Test Server',
      directMessage: async (userId, payload) => {
        sent.push({ userId, payload });
        return true;
      },
      ...overrides,
    });
  }

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    sent = [];

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song());
  });

  it('sends the card and the link to whoever asked', async () => {
    const { ctx, replies } = harness();

    await service().grab(ctx);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.userId).toBe('user');
    // The card makes the song recognisable at a glance; the link is text
    // because a link drawn into an image is a link nobody can follow.
    expect(sent[0]?.payload.attachments).toEqual([
      { name: cardFile('now-playing'), data: expect.any(Buffer) },
    ]);
    expect(sent[0]?.payload.content).toContain('https://youtu.be/cham-hoa');
    expect(sent[0]?.payload.content).toContain('Chăm Hoa');
    expect(sent[0]?.payload.content).toContain('Melody Test Server');

    expect(replies[0]?.content).toMatch(/sent/i);
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('answers privately, so a room does not watch somebody save a song', async () => {
    const { ctx, replies } = harness();

    await service().grab(ctx);

    expect(replies.every((reply) => reply.ephemeral)).toBe(true);
  });

  it('says so when the message could not be delivered', async () => {
    const { ctx, replies } = harness();

    await service({ directMessage: async () => false }).grab(ctx);

    // Closed DMs are ordinary, so this explains rather than fails.
    expect(replies[0]?.content).toMatch(/could not message you/i);
    expect(replies[0]?.title).toBe('Could not send');
  });

  it('refuses when nothing is playing', async () => {
    await players.destroy('guild');
    const { ctx, replies } = harness();
    const dm = vi.fn(async () => true);

    await service({ directMessage: dm }).grab(ctx);

    expect(dm).not.toHaveBeenCalled();
    expect(replies[0]?.content).toMatch(/nothing is playing/i);
  });

  it('says so when the bot cannot send private messages at all', async () => {
    const { ctx, replies } = harness();

    // No `directMessage` wired: a preview or a test build, where promising to
    // send one would be a lie.
    await new MusicService(players, new ResolverRegistry(), {}).grab(ctx);

    expect(replies[0]?.content).toMatch(/cannot send private messages/i);
  });
});
