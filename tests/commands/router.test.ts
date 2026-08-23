import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CommandRegistry,
  CommandRouter,
  CooldownTracker,
  mapPositionalOptions,
  usage,
  type Command,
  type CommandContext,
  type PermissionTier,
  type ReplyPayload,
  type SourceType,
} from '../../src/application/commands';

const playCommand: Command = {
  name: 'play',
  description: 'Play a track',
  category: 'playback',
  aliases: ['p'],
  options: [{ name: 'query', description: 'Search or URL', required: true, rest: true }],
  requiresVoice: true,
  deferred: true,
  execute: vi.fn(async () => undefined),
};

const skipCommand: Command = {
  name: 'skip',
  description: 'Skip the current track',
  category: 'playback',
  tier: 'dj',
  cooldownMs: 3_000,
  execute: vi.fn(async () => undefined),
};

/** Test double that records replies instead of talking to Discord. */
function makeContext(overrides: Partial<CommandContext> = {}) {
  const replies: ReplyPayload[] = [];
  const deferred: boolean[] = [];

  const args = (overrides.args ?? []) as string[];
  const command = overrides.commandName ?? 'play';
  const resolved = mapPositionalOptions(
    command === 'play' ? playCommand : skipCommand,
    args,
  );

  const ctx: CommandContext = {
    guildId: 'g1',
    channelId: 'c1',
    userId: 'u1',
    voiceChannelId: 'v1',
    commandName: command,
    args,
    rest: args.join(' '),
    sourceType: 'slash' as SourceType,
    tier: 'everyone' as PermissionTier,
    correlationId: 'corr-1',
    reply: async (payload) => {
      replies.push(payload);
    },
    defer: async (ephemeral) => {
      deferred.push(Boolean(ephemeral));
    },
    option: (name) => resolved.get(name),
    ...overrides,
  };

  return { ctx, replies, deferred };
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    registry.registerAll([playCommand, skipCommand]);
  });

  it('resolves by name and alias, case-insensitively', () => {
    expect(registry.get('play')).toBe(playCommand);
    expect(registry.get('P')).toBe(playCommand);
    expect(registry.get('SKIP')).toBe(skipCommand);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('rejects duplicate names and aliases', () => {
    expect(() => registry.register(playCommand)).toThrow(/Duplicate/);
    expect(() =>
      registry.register({ ...skipCommand, name: 'other', aliases: ['p'] }),
    ).toThrow(/Duplicate/);
  });

  it('groups commands by category', () => {
    expect(registry.byCategory().get('playback')).toHaveLength(2);
  });

  it('suggests a close name for a typo but not for nonsense', () => {
    expect(registry.suggest('ply')).toBe('play');
    expect(registry.suggest('skp')).toBe('skip');
    expect(registry.suggest('xyzzyqwerty')).toBeUndefined();
  });
});

describe('usage and option mapping', () => {
  it('renders a usage line per interface', () => {
    expect(usage(playCommand, '/')).toBe('/play <query>');
    expect(usage(playCommand, '!')).toBe('!play <query>');
    expect(usage(skipCommand, '!')).toBe('!skip');
  });

  it('folds trailing tokens into a rest option', () => {
    const resolved = mapPositionalOptions(playCommand, ['chạy', 'ngay', 'đi']);
    expect(resolved.get('query')).toBe('chạy ngay đi');
  });

  it('leaves a missing option unset', () => {
    expect(mapPositionalOptions(playCommand, []).get('query')).toBeUndefined();
  });
});

describe('CommandRouter', () => {
  let registry: CommandRegistry;
  let router: CommandRouter;
  let cooldown: CooldownTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new CommandRegistry();
    registry.registerAll([playCommand, skipCommand]);
    cooldown = new CooldownTracker();
    router = new CommandRouter(registry, { cooldown });
  });

  it('runs a valid command and defers first when asked', async () => {
    const { ctx, deferred } = makeContext({ args: ['faded'] });

    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'ok' });
    expect(deferred).toHaveLength(1);
    expect(playCommand.execute).toHaveBeenCalledOnce();
  });

  it('reports an unknown command with a suggestion', async () => {
    const { ctx, replies } = makeContext({ commandName: 'ply' });

    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'unknown-command' });
    expect(replies[0]?.content).toContain('play');
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it('blocks a command the member lacks the tier for', async () => {
    const { ctx, replies } = makeContext({ commandName: 'skip', tier: 'everyone' });

    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'missing-permission' });
    expect(skipCommand.execute).not.toHaveBeenCalled();
    expect(replies[0]?.content).toContain('dj');
  });

  it('allows a higher tier than required', async () => {
    const { ctx } = makeContext({ commandName: 'skip', tier: 'admin' });
    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'ok' });
  });

  it('requires a voice channel when the command declares it', async () => {
    const { ctx, replies } = makeContext({ args: ['faded'], voiceChannelId: undefined });

    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'needs-voice' });
    expect(replies[0]?.content).toContain('voice channel');
  });

  it('rejects a missing required option with a usage hint', async () => {
    const { ctx, replies } = makeContext({ args: [] });

    await expect(router.dispatch(ctx)).resolves.toMatchObject({ status: 'missing-argument' });
    expect(replies[0]?.content).toContain('query');
    expect(replies[0]?.content).toContain('play');
  });

  it('enforces a per-user cooldown', async () => {
    const first = makeContext({ commandName: 'skip', tier: 'dj' });
    await expect(router.dispatch(first.ctx)).resolves.toMatchObject({ status: 'ok' });

    const second = makeContext({ commandName: 'skip', tier: 'dj' });
    const result = await router.dispatch(second.ctx);

    expect(result.status).toBe('cooldown');
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(skipCommand.execute).toHaveBeenCalledOnce();
  });

  it('scopes the cooldown to one user', async () => {
    await router.dispatch(makeContext({ commandName: 'skip', tier: 'dj' }).ctx);
    const other = makeContext({ commandName: 'skip', tier: 'dj', userId: 'u2' });

    await expect(router.dispatch(other.ctx)).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports a failing command without leaking the error, and refunds the cooldown', async () => {
    const boom: Command = {
      name: 'boom',
      description: 'Always fails',
      category: 'general',
      cooldownMs: 5_000,
      execute: async () => {
        throw new Error('lavalink exploded');
      },
    };
    registry.register(boom);

    const { ctx, replies } = makeContext({ commandName: 'boom' });
    const result = await router.dispatch(ctx);

    expect(result.status).toBe('error');
    expect(replies[0]?.content).not.toContain('lavalink');
    expect(cooldown.remaining('u1', 'boom')).toBe(0);
  });

  it('treats slash, prefix, and mention identically', async () => {
    const results = await Promise.all(
      (['slash', 'prefix', 'mention'] as SourceType[]).map((sourceType) =>
        router.dispatch(makeContext({ args: ['faded'], sourceType }).ctx),
      ),
    );

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(playCommand.execute).toHaveBeenCalledTimes(3);
  });
});

describe('CooldownTracker', () => {
  it('counts down against an injected clock', () => {
    let now = 1_000;
    const tracker = new CooldownTracker(() => now);

    expect(tracker.hit('u1', 'skip', 3_000)).toBe(0);
    expect(tracker.hit('u1', 'skip', 3_000)).toBe(3_000);

    now += 2_000;
    expect(tracker.remaining('u1', 'skip')).toBe(1_000);

    now += 1_000;
    expect(tracker.hit('u1', 'skip', 3_000)).toBe(0);
  });

  it('treats a zero cooldown as no cooldown', () => {
    const tracker = new CooldownTracker();
    expect(tracker.hit('u1', 'play', 0)).toBe(0);
    expect(tracker.hit('u1', 'play', 0)).toBe(0);
    expect(tracker.size).toBe(0);
  });

  it('clears and resets', () => {
    const tracker = new CooldownTracker();
    tracker.hit('u1', 'skip', 10_000);
    tracker.clear('u1', 'skip');
    expect(tracker.remaining('u1', 'skip')).toBe(0);

    tracker.hit('u2', 'skip', 10_000);
    tracker.reset();
    expect(tracker.size).toBe(0);
  });
});
