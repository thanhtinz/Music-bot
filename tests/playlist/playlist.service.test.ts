import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { InMemoryPlaylistRepository, PlaylistService } from '../../src/application/playlist';
import type { MusicService } from '../../src/application/services/music.service';
import { createTrack, type Track } from '../../src/domain/music';
import { FAVORITES_NAME, MAX_PLAYLISTS_PER_OWNER } from '../../src/domain/playlist';
import { cardFile } from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

interface Harness {
  ctx: CommandContext;
  replies: ReplyPayload[];
}

function harness(overrides: Partial<CommandContext> = {}): Harness {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'channel',
    userId: 'owner',
    voiceChannelId: 'voice',
    commandName: 'playlist',
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
    ...overrides,
  } as CommandContext;

  return { ctx, replies };
}

function track(title = 'Faded'): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Alan Walker',
    durationMs: 212_000,
    requesterId: 'someone-else',
  });
}

/** Stands in for the music service; the playlist service only needs these two. */
function music(current?: Track) {
  return {
    currentTrack: vi.fn(() => current),
    enqueueResolved: vi.fn(async () => {}),
  } as unknown as MusicService & {
    currentTrack: ReturnType<typeof vi.fn>;
    enqueueResolved: ReturnType<typeof vi.fn>;
  };
}

describe('PlaylistService', () => {
  let repository: InMemoryPlaylistRepository;

  beforeEach(() => {
    repository = new InMemoryPlaylistRepository();
  });

  describe('create', () => {
    it('creates a playlist and confirms it', async () => {
      const service = new PlaylistService(repository, music(), { prefix: '!' });
      const { ctx, replies } = harness();

      await service.create(ctx, '  Chill   Vibes ');

      expect(await repository.findByName('guild', 'owner', 'chill vibes')).toBeDefined();
      expect(replies[0]?.content).toContain('Chill Vibes');
    });

    it('refuses a duplicate name, however it is typed', async () => {
      const service = new PlaylistService(repository, music());
      const { ctx } = harness();

      await service.create(ctx, 'Chill');
      const { ctx: second, replies } = harness();
      await service.create(second, 'CHILL');

      expect(replies[0]?.content).toContain('already have');
      expect(replies[0]?.ephemeral).toBe(true);
      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(1);
    });

    it('stops at the per-owner limit', async () => {
      const service = new PlaylistService(repository, music());

      for (let index = 0; index < MAX_PLAYLISTS_PER_OWNER; index += 1) {
        await service.create(harness().ctx, `List ${index}`);
      }

      const { ctx, replies } = harness();
      await service.create(ctx, 'One too many');

      expect(replies[0]?.content).toContain('limit');
      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(MAX_PLAYLISTS_PER_OWNER);
    });

    it('keeps one guild out of another', async () => {
      const service = new PlaylistService(repository, music());

      await service.create(harness().ctx, 'Chill');
      await service.create(harness({ guildId: 'other' }).ctx, 'Chill');

      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(1);
      expect(await repository.listByOwner('other', 'owner')).toHaveLength(1);
    });
  });

  describe('addCurrent', () => {
    it('says so when nothing is playing', async () => {
      const service = new PlaylistService(repository, music(undefined));
      const { ctx, replies } = harness();

      await service.addCurrent(ctx, 'Chill');

      expect(replies[0]?.content).toContain('Nothing is playing');
      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(0);
    });

    it('creates the playlist when it does not exist yet', async () => {
      const service = new PlaylistService(repository, music(track()));
      const { ctx, replies } = harness();

      await service.addCurrent(ctx, 'Chill');

      const stored = await repository.findByName('guild', 'owner', 'Chill');
      expect(stored?.tracks).toHaveLength(1);
      expect(replies[0]?.content).toContain('new playlist');
    });

    it('re-attributes the track to whoever plays it later', async () => {
      const service = new PlaylistService(repository, music(track()));
      await service.addCurrent(harness().ctx, 'Chill');

      const stored = await repository.findByName('guild', 'owner', 'Chill');
      expect(stored?.tracks[0]).not.toHaveProperty('requesterId');
    });

    it('appends to an existing playlist', async () => {
      const service = new PlaylistService(repository, music(track('One')));
      await service.create(harness().ctx, 'Chill');
      await service.addCurrent(harness().ctx, 'Chill');
      await service.addCurrent(harness().ctx, 'chill');

      const stored = await repository.findByName('guild', 'owner', 'Chill');
      expect(stored?.tracks).toHaveLength(2);
    });
  });

  describe('play', () => {
    it('queues every saved track', async () => {
      const player = music(track('One'));
      const service = new PlaylistService(repository, player);

      await service.addCurrent(harness().ctx, 'Chill');
      const { ctx } = harness();
      await service.play(ctx, 'Chill');

      expect(player.enqueueResolved).toHaveBeenCalledTimes(1);
      const [, inputs, label] = player.enqueueResolved.mock.calls[0] as [
        unknown,
        Array<{ requesterId: string }>,
        string,
      ];
      expect(inputs).toHaveLength(1);
      expect(inputs[0]?.requesterId).toBe('owner');
      expect(label).toBe('Chill');
    });

    it('does not queue an empty playlist', async () => {
      const player = music();
      const service = new PlaylistService(repository, player);

      await service.create(harness().ctx, 'Empty');
      const { ctx, replies } = harness();
      await service.play(ctx, 'Empty');

      expect(player.enqueueResolved).not.toHaveBeenCalled();
      expect(replies[0]?.content).toContain('empty');
    });

    it('points at the library when the name is unknown', async () => {
      const service = new PlaylistService(repository, music(), { prefix: '!' });
      const { ctx, replies } = harness({ sourceType: 'prefix' });

      await service.play(ctx, 'Nope');

      expect(replies[0]?.content).toContain('!playlist list');
      expect(replies[0]?.ephemeral).toBe(true);
    });
  });

  describe('removeTrack', () => {
    it('removes by position', async () => {
      const service = new PlaylistService(repository, music(track('One')));
      await service.addCurrent(harness().ctx, 'Chill');
      await service.addCurrent(harness().ctx, 'Chill');

      const { ctx, replies } = harness();
      await service.removeTrack(ctx, 'Chill', 1);

      const stored = await repository.findByName('guild', 'owner', 'Chill');
      expect(stored?.tracks).toHaveLength(1);
      expect(replies[0]?.content).toContain('1 left');
    });

    it('reports a position that does not exist', async () => {
      const service = new PlaylistService(repository, music());
      await service.create(harness().ctx, 'Chill');

      const { ctx, replies } = harness();
      await service.removeTrack(ctx, 'Chill', 9);

      expect(replies[0]?.content).toContain('no #9');
    });
  });

  describe('delete', () => {
    it('removes the playlist', async () => {
      const service = new PlaylistService(repository, music());
      await service.create(harness().ctx, 'Chill');

      await service.delete(harness().ctx, 'Chill');

      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(0);
    });

    it('leaves a playlist owned by someone else alone', async () => {
      const service = new PlaylistService(repository, music());
      await service.create(harness({ userId: 'someone-else' }).ctx, 'Chill');

      const { ctx, replies } = harness();
      await service.delete(ctx, 'Chill');

      expect(replies[0]?.content).toContain('no playlist called');
      expect(await repository.listByOwner('guild', 'someone-else')).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('renders a card and attaches page buttons', async () => {
      const service = new PlaylistService(repository, music(), {
        libraryComponents: (page, totalPages) => [{ page, totalPages }],
      });
      await service.create(harness().ctx, 'Chill');

      const { ctx, replies } = harness();
      await service.list(ctx);

      expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('playlists'));
      expectCardImage(replies[0]?.attachments?.[0]?.data);
      expect(replies[0]?.components).toEqual([{ page: 1, totalPages: 1 }]);
    });

    it('renders an empty library rather than refusing', async () => {
      const service = new PlaylistService(repository, music());
      const { ctx, replies } = harness();

      await service.list(ctx);

      expect(replies[0]?.attachments).toHaveLength(1);
    });

    it('clamps a page past the end', async () => {
      const service = new PlaylistService(repository, music(), {
        libraryComponents: (page, totalPages) => [{ page, totalPages }],
      });
      await service.create(harness().ctx, 'Chill');

      const { ctx, replies } = harness();
      await service.list(ctx, 99);

      expect(replies[0]?.components).toEqual([{ page: 1, totalPages: 1 }]);
    });
  });

  describe('toggleFavorite', () => {
    it('saves the current track the first time', async () => {
      const service = new PlaylistService(repository, music(track('Chăm Hoa')));
      const { ctx, replies } = harness();

      await service.toggleFavorite(ctx);

      const favorites = await repository.findByName('guild', 'owner', FAVORITES_NAME);
      expect(favorites?.tracks).toHaveLength(1);
      expect(replies[0]?.title).toBe('Favorited');
    });

    it('takes it out again on a second press', async () => {
      const service = new PlaylistService(repository, music(track('Chăm Hoa')));

      await service.toggleFavorite(harness().ctx);
      const { ctx, replies } = harness();
      await service.toggleFavorite(ctx);

      const favorites = await repository.findByName('guild', 'owner', FAVORITES_NAME);
      expect(favorites?.tracks).toHaveLength(0);
      expect(replies[0]?.title).toBe('Unfavorited');
    });

    it('matches the same song rather than the same queue entry', async () => {
      // Two enqueues of one song get different track ids; favoriting must not
      // end up holding it twice.
      const service = new PlaylistService(repository, music(track('Chăm Hoa')));
      await service.toggleFavorite(harness().ctx);

      const again = new PlaylistService(repository, music(track('Chăm Hoa')));
      await again.toggleFavorite(harness().ctx);

      const favorites = await repository.findByName('guild', 'owner', FAVORITES_NAME);
      expect(favorites?.tracks).toHaveLength(0);
    });

    it('keeps different songs apart', async () => {
      const first = new PlaylistService(repository, music(track('Chăm Hoa')));
      await first.toggleFavorite(harness().ctx);

      const second = new PlaylistService(repository, music(track('Lạc Trôi')));
      await second.toggleFavorite(harness().ctx);

      const favorites = await repository.findByName('guild', 'owner', FAVORITES_NAME);
      expect(favorites?.tracks.map((entry) => entry.title)).toEqual(['Chăm Hoa', 'Lạc Trôi']);
    });

    it('says so when nothing is playing', async () => {
      const service = new PlaylistService(repository, music(undefined));
      const { ctx, replies } = harness();

      await service.toggleFavorite(ctx);

      expect(replies[0]?.content).toContain('Nothing is playing');
      expect(await repository.listByOwner('guild', 'owner')).toHaveLength(0);
    });

    it('keeps one person’s favorites out of another’s', async () => {
      const service = new PlaylistService(repository, music(track('Chăm Hoa')));

      await service.toggleFavorite(harness().ctx);
      await service.toggleFavorite(harness({ userId: 'someone-else' }).ctx);

      expect((await repository.findByName('guild', 'owner', FAVORITES_NAME))?.tracks).toHaveLength(
        1,
      );
      expect(
        (await repository.findByName('guild', 'someone-else', FAVORITES_NAME))?.tracks,
      ).toHaveLength(1);
    });

    it('shows favorites in the library like any other playlist', async () => {
      const service = new PlaylistService(repository, music(track('Chăm Hoa')));
      await service.toggleFavorite(harness().ctx);

      const listed = await repository.listByOwner('guild', 'owner');
      expect(listed.map((entry) => entry.name)).toEqual([FAVORITES_NAME]);
    });
  });

  describe('setVisibility', () => {
    it('marks a playlist private', async () => {
      const service = new PlaylistService(repository, music());
      await service.create(harness().ctx, 'Chill');

      await service.setVisibility(harness().ctx, 'Chill', 'private');

      const stored = await repository.findByName('guild', 'owner', 'Chill');
      expect(stored?.visibility).toBe('private');
    });
  });
});

describe('prefix hints', () => {
  function serviceWith(prefixFor?: () => Promise<string | undefined>): PlaylistService {
    return new PlaylistService(new InMemoryPlaylistRepository(), {} as MusicService, {
      prefix: '!',
      botName: 'Melody',
      ...(prefixFor ? { prefixFor } : {}),
    });
  }

  /** The hint text from a failed lookup, however the command was invoked. */
  async function hint(
    service: PlaylistService,
    sourceType: CommandContext['sourceType'],
  ): Promise<string> {
    const { ctx, replies } = harness({ sourceType });
    await service.play(ctx, 'Nope');

    return replies[0]?.content ?? '';
  }

  it('uses the guild’s own prefix for a typed command', async () => {
    // A hint telling people to type `!playlist` on a server using `?` is
    // wrong twice.
    expect(
      await hint(
        serviceWith(async () => '?'),
        'prefix',
      ),
    ).toContain('?playlist list');
  });

  it('uses a slash for a slash command, whatever the guild prefix is', async () => {
    expect(
      await hint(
        serviceWith(async () => '?'),
        'slash',
      ),
    ).toContain('/playlist list');
  });

  it('uses the bot’s name for a mention', async () => {
    // Somebody who typed `@Melody playlist` has no prefix in their head.
    expect(
      await hint(
        serviceWith(async () => '?'),
        'mention',
      ),
    ).toContain('@Melody playlist list');
  });

  it('falls back to the configured prefix when the lookup fails', async () => {
    const broken = serviceWith(async () => {
      throw new Error('settings are down');
    });

    expect(await hint(broken, 'prefix')).toContain('!playlist list');
  });
});
