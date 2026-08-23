import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player/player-manager';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import {
  buildNowPlayingControls,
  decodeComponentId,
  toJSON,
} from '../../src/infrastructure/discord/components';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
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
    commandName: 'button',
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
  } as CommandContext;

  return { ctx, replies };
}

/** The actions a reply's component rows carry, row by row. */
function actionsOf(payload: ReplyPayload | undefined): (string | undefined)[][] {
  const rows = (payload?.components ?? []) as { toJSON(): unknown }[];

  return toJSON(rows as never).map((row) =>
    row.components.map(
      (component) => decodeComponentId((component as { custom_id: string }).custom_id)?.action,
    ),
  );
}

describe('the Now Playing volume controls', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(async () => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { defaultVolume: 60, maxQueueSize: 20 });
    service = new MusicService(players, new ResolverRegistry(), {
      nowPlayingComponents: (player) =>
        buildNowPlayingControls({
          paused: player.status === 'paused',
          hasPrevious: player.queue.history.length > 0,
          hasQueue: player.queue.size > 0,
          loop: player.loop,
          volume: player.volume,
          muted: player.muted,
        }),
    });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Playing'));
  });

  it('silences the player and brings it back to the same level', async () => {
    const { ctx } = harness();
    await players.get('guild')!.setVolume(35);

    await service.toggleMute(ctx);
    expect(backend.volumeOf('guild')).toBe(0);

    await service.toggleMute(ctx);
    expect(backend.volumeOf('guild')).toBe(35);
  });

  it('redraws the panel on a mute, so the button and picker agree', async () => {
    const { ctx, replies } = harness();

    await service.toggleMute(ctx);

    const last = replies.at(-1);
    // The panel, not a notice that would cover it.
    expect(last?.attachments?.[0]?.name).toBe('now-playing.png');
    expect(actionsOf(last)).toEqual([['previous', 'playpause', 'skip', 'mute'], ['volume']]);
  });

  it('applies a level picked from the dropdown', async () => {
    const { ctx, replies } = harness();

    await service.pickVolume(ctx, 25);

    expect(players.get('guild')?.volume).toBe(25);
    expect(backend.volumeOf('guild')).toBe(25);
    // Redrawn rather than answered, so the placeholder catches up.
    expect(replies.at(-1)?.attachments?.[0]?.name).toBe('now-playing.png');
  });

  it('lets a picked level end a mute', async () => {
    const { ctx } = harness();

    await service.toggleMute(ctx);
    await service.pickVolume(ctx, 50);

    expect(players.get('guild')?.muted).toBe(false);
    expect(backend.volumeOf('guild')).toBe(50);
  });
});
