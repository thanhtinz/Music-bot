import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { SearchService } from '../../src/application/search';
import { MusicService } from '../../src/application/services/music.service';
import {
  ResolverError,
  ResolverRegistry,
  type SourceResolver,
  type TrackCandidate,
} from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';
import { cardFile } from '../../src/ui/canvas';

function candidate(title: string, index: number): TrackCandidate {
  return {
    source: 'youtube',
    identifier: `id-${index}`,
    title,
    author: 'MONO',
    durationMs: 200_000,
  };
}

const RESULTS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(candidate);

/** A provider with no network behind it. */
function provider(search: (query: string) => Promise<TrackCandidate[]>): ResolverRegistry {
  const registry = new ResolverRegistry();

  registry.register({
    name: 'fake',
    source: 'youtube',
    canHandle: () => true,
    search: (query) => search(query),
    resolveTrack: async () => RESULTS[0]!,
  } satisfies SourceResolver);

  return registry;
}

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'asker',
    voiceChannelId: 'voice',
    commandName: 'search',
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

/** A clock the test moves by hand. */
class Clock {
  constructor(private value = 1_000) {}

  readonly now = (): number => this.value;

  advance(ms: number): void {
    this.value += ms;
  }
}

describe('SearchService', () => {
  let backend: FakeAudioBackend;
  let players: PlayerManager;
  let music: MusicService;
  let clock: Clock;
  let service: SearchService;
  let queries: string[];

  beforeEach(() => {
    backend = new FakeAudioBackend();
    players = new PlayerManager(backend, { maxQueueSize: 50 });
    music = new MusicService(players, new ResolverRegistry(), { defaultVolume: 70 });
    clock = new Clock();
    queries = [];

    service = new SearchService(
      provider(async (query) => {
        queries.push(query);
        return RESULTS;
      }),
      music,
      { now: clock.now },
    );
  });

  describe('search', () => {
    it('answers with a card of results', async () => {
      const { ctx, replies } = harness();

      await service.search(ctx, 'chăm hoa');

      expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('search'));
      expect(queries).toEqual(['chăm hoa']);
    });

    it('shows five results, however many came back', async () => {
      const { ctx } = harness();

      await service.search(ctx, 'anything');

      // Six results came back; the sixth has no button to pick it with, so it
      // must not be on the card either.
      await service.pick(ctx, 6);
      expect(players.get('guild')).toBeUndefined();
    });

    it('asks what to look for rather than searching for nothing', async () => {
      const { ctx, replies } = harness();

      await service.search(ctx, '   ');

      expect(replies[0]?.title).toBe('Search for what?');
      expect(queries).toEqual([]);
    });

    it('says so when nothing was found', async () => {
      const empty = new SearchService(
        provider(async () => []),
        music,
        { now: clock.now },
      );
      const { ctx, replies } = harness();

      await empty.search(ctx, 'zzzzz');

      expect(replies[0]?.attachments).toBeUndefined();
      expect(replies[0]?.title).toBe('No results');
    });

    it('reads a provider that failed inside the registry as no results', async () => {
      const failing = new SearchService(
        provider(async () => {
          throw new ResolverError('UNAVAILABLE', 'nope');
        }),
        music,
        { now: clock.now },
      );
      const { ctx, replies } = harness();

      await failing.search(ctx, 'chăm hoa');

      // The registry catches a provider's failure and drops its results, so
      // one dead source cannot empty the whole list — which leaves nothing
      // here to tell an outage apart from a query that matches nothing.
      expect(replies[0]?.title).toBe('No results');
    });

    it('reports a search that failed outright rather than throwing at the caller', async () => {
      const broken = new SearchService(
        {
          search: async () => {
            throw new Error('registry is down');
          },
        } as unknown as ResolverRegistry,
        music,
        { now: clock.now },
      );
      const { ctx, replies } = harness();

      await broken.search(ctx, 'chăm hoa');

      expect(replies[0]?.title).toBe('Search failed');
      expect(replies[0]?.ephemeral).toBe(true);
    });

    it('attaches one pick button per result', async () => {
      const withButtons = new SearchService(
        provider(async () => RESULTS.slice(0, 3)),
        music,
        { now: clock.now, searchComponents: (count) => [`picks:${count}`] },
      );
      const { ctx, replies } = harness();

      await withButtons.search(ctx, 'chăm hoa');

      expect(replies[0]?.components).toEqual(['picks:3']);
    });
  });

  describe('pick', () => {
    it('queues the numbered result', async () => {
      const { ctx } = harness();
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 2);

      expect(players.get('guild')?.queue.current?.title).toBe('Two');
    });

    it('counts from 1, as the card does', async () => {
      const { ctx } = harness();
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 1);

      expect(players.get('guild')?.queue.current?.title).toBe('One');
    });

    it('credits the track to whoever picked it', async () => {
      const { ctx } = harness({ userId: 'linh' });
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 1);

      expect(players.get('guild')?.queue.current?.requesterId).toBe('linh');
    });

    it('has nothing to pick before a search', async () => {
      const { ctx, replies } = harness();

      await service.pick(ctx, 1);

      expect(replies[0]?.title).toBe('Nothing to pick');
      expect(players.get('guild')).toBeUndefined();
    });

    it('will not let somebody else pick from your list', async () => {
      const mine = harness({ userId: 'asker' });
      await service.search(mine.ctx, 'chăm hoa');

      const theirs = harness({ userId: 'someone-else' });
      await service.pick(theirs.ctx, 1);

      expect(theirs.replies[0]?.title).toBe('Nothing to pick');
      expect(players.get('guild')).toBeUndefined();
    });

    it('keeps two people’s searches apart', async () => {
      const mine = harness({ userId: 'asker' });
      const theirs = harness({ userId: 'linh' });

      const other = new SearchService(
        provider(async () => [RESULTS[3]!]),
        music,
        {
          now: clock.now,
        },
      );
      await service.search(mine.ctx, 'mine');
      await other.search(theirs.ctx, 'theirs');

      await service.pick(mine.ctx, 1);

      expect(players.get('guild')?.queue.current?.title).toBe('One');
    });

    it('expires, rather than queueing what somebody chose an hour ago', async () => {
      const { ctx, replies } = harness();
      await service.search(ctx, 'chăm hoa');

      clock.advance(3_600_000);
      await service.pick(ctx, 1);

      expect(replies[1]?.title).toBe('Nothing to pick');
      expect(players.get('guild')).toBeUndefined();
    });

    it('is spent once used, so one search queues one track', async () => {
      const { ctx, replies } = harness();
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 1);
      await service.pick(ctx, 2);

      expect(replies.at(-1)?.title).toBe('Nothing to pick');
      expect(players.get('guild')?.queue.size).toBe(0);
    });

    it('keeps the list when the number is off the end', async () => {
      const { ctx, replies } = harness();
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 9);

      expect(replies[1]?.title).toBe('No such result');

      // Losing the whole search over a typo would be the harsher answer.
      await service.pick(ctx, 1);
      expect(players.get('guild')?.queue.current?.title).toBe('One');
    });

    it('keeps the list when the picker is not in a voice channel', async () => {
      const { ctx, replies } = harness({ voiceChannelId: undefined });
      await service.search(ctx, 'chăm hoa');

      await service.pick(ctx, 1);

      expect(replies[1]?.title).toBe('Which channel?');
      expect(players.get('guild')).toBeUndefined();

      const joined = harness({ userId: ctx.userId });
      await service.pick(joined.ctx, 1);
      expect(players.get('guild')?.queue.current?.title).toBe('One');
    });

    it('forgets a guild on request', async () => {
      const { ctx, replies } = harness();
      await service.search(ctx, 'chăm hoa');

      service.forget('guild');
      await service.pick(ctx, 1);

      expect(replies[1]?.title).toBe('Nothing to pick');
    });
  });
});
