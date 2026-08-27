import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { ResolverRegistry } from '../../src/resolvers';
import { paginateSakuraQueue, renderQueueCard } from '../../src/ui/canvas';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
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
    commandName: 'queue',
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

/**
 * The numbers on the queue card and the numbers the commands take.
 *
 * These were a track apart: the card added one for whatever was playing, so the
 * row beside "2" was the track `remove 1` deletes. No test could see it — the
 * numbers are pixels — so the card is compared against one drawn with the
 * positions the queue itself uses.
 */
describe('queue positions', () => {
  let players: PlayerManager;
  let service: MusicService;

  beforeEach(async () => {
    players = new PlayerManager(new FakeAudioBackend(), { defaultVolume: 60, maxQueueSize: 50 });
    service = new MusicService(players, new ResolverRegistry(), { variant: 'sakura' });

    const player = await players.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('Playing'), song('Second'), song('Third'), song('Fourth')]);
  });

  it('numbers the first upcoming track 1, not 2', async () => {
    const { ctx, replies } = harness();
    await service.queue(ctx, 1);

    const player = players.get('guild')!;
    // Counted from 1 over the upcoming list — the same numbers `remove`,
    // `move` and `jump` are range-checked against.
    const upNext = replies.at(-1)?.fields?.find((field) => field.name.startsWith('Up next'));

    expect(upNext?.value).toContain('**1.** Second');
    expect(upNext?.value).toContain('**2.** Third');
    expect(upNext?.value).toContain('**3.** Fourth');
    expect(player.queue.size).toBe(3);
  });

  it('removes the track the card numbers 1', async () => {
    const player = players.get('guild')!;

    // "Playing" holds the highlighted row; the first numbered row is "Second".
    const removed = player.queue.remove(1);

    expect(removed.title).toBe('Second');
  });

  it('jumps to the track the card numbers 2', async () => {
    const player = players.get('guild')!;

    const jumped = await player.jumpTo(2);

    expect(jumped.title).toBe('Third');
  });

  it('numbers the top row of a card with nothing playing on it', async () => {
    // The template's first band is highlighted whatever sits in it, and the
    // renderer read that as "this row is the current track" — so a search
    // result's best match came back with no position on it, which is the one
    // number the row exists to give.
    const row = {
      title: 'Chăm Hoa',
      author: 'MONO',
      durationMs: 200_000,
      isStream: false,
      requesterName: 'user',
    };

    const card = (position: number) =>
      renderQueueCard({
        tracks: [{ position, ...row }],
        page: 1,
        totalPages: 1,
        totalTracks: 1,
        totalDurationMs: row.durationMs,
        loop: 'off' as const,
        variant: 'sakura' as const,
      });

    expect((await card(7)).equals(await card(8))).toBe(false);
  });

  it('keeps counting across pages', async () => {
    const player = players.get('guild')!;
    await player.enqueue(Array.from({ length: 8 }, (_, index) => song(`Extra ${index}`)));

    // Four upcoming per page, so page two opens at 5 with nothing added for
    // the track playing.
    expect(paginateSakuraQueue(player.queue.tracks, 2).firstPosition).toBe(5);
    expect(player.queue.remove(5).title).toBe('Extra 1');
  });
});
