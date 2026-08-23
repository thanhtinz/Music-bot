import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext, ReplyPayload } from '../../src/application/commands';
import { InMemorySettingsRepository, SettingsService } from '../../src/application/settings';
import { cardFile } from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

const DEFAULTS = { prefix: '!', defaultVolume: 70, idleTimeoutMs: 300_000 };

function harness(overrides: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'text',
    userId: 'mod',
    commandName: 'settings',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: 'moderator',
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

describe('SettingsService', () => {
  let repository: InMemorySettingsRepository;
  let service: SettingsService;

  beforeEach(() => {
    repository = new InMemorySettingsRepository();
    service = new SettingsService(repository, {
      defaults: DEFAULTS,
      guildName: () => 'Test Server',
    });
  });

  describe('forGuild', () => {
    it('fills in the environment defaults for a guild nobody has configured', async () => {
      const settings = await service.forGuild('never-seen');

      expect(settings.prefix).toBe('!');
      expect(settings.defaultVolume).toBe(70);
    });

    it('does not write those defaults back', async () => {
      await service.forGuild('never-seen');

      // Reading must not create a record; a guild only gets one once it is
      // actually configured.
      expect(await repository.find('never-seen')).toBeUndefined();
    });

    it('returns what was saved', async () => {
      await service.set(harness().ctx, 'volume', '85');

      expect((await service.forGuild('guild')).defaultVolume).toBe(85);
    });
  });

  describe('show', () => {
    it('renders the sheet as a card', async () => {
      const { ctx, replies } = harness();

      await service.show(ctx);

      expect(replies[0]?.attachments?.[0]?.name).toBe(cardFile('settings'));
      expectCardImage(replies[0]?.attachments?.[0]?.data);
    });

    it('works for a guild with nothing saved', async () => {
      const { ctx, replies } = harness({ guildId: 'fresh' });

      await service.show(ctx);

      expect(replies[0]?.attachments).toHaveLength(1);
    });
  });

  describe('set', () => {
    it('saves the change and confirms it', async () => {
      const { ctx, replies } = harness();

      await service.set(ctx, 'prefix', '?');

      expect((await repository.find('guild'))?.prefix).toBe('?');
      expect(replies[0]?.content).toContain('**?**');
      expect(replies[0]?.title).toBe('Settings');
    });

    it('reports an unknown key with the list of real ones', async () => {
      const { ctx, replies } = harness();

      await service.set(ctx, 'colour', 'pink');

      expect(replies[0]?.content).toContain('No setting called');
      expect(replies[0]?.ephemeral).toBe(true);
      expect(await repository.find('guild')).toBeUndefined();
    });

    it('reports a value it will not take, and saves nothing', async () => {
      const { ctx, replies } = harness();

      await service.set(ctx, 'volume', 'loud');

      expect(replies[0]?.content).toContain('whole number');
      expect(await repository.find('guild')).toBeUndefined();
    });

    it('asks for a value when given none', async () => {
      const { ctx, replies } = harness();

      await service.set(ctx, 'volume', '   ');

      expect(replies[0]?.content).toContain('Give a value');
      expect(replies[0]?.ephemeral).toBe(true);
    });

    it('keeps one guild out of another', async () => {
      await service.set(harness().ctx, 'prefix', '?');
      await service.set(harness({ guildId: 'other' }).ctx, 'prefix', '$');

      expect((await repository.find('guild'))?.prefix).toBe('?');
      expect((await repository.find('other'))?.prefix).toBe('$');
    });
  });

  describe('toggleStayConnected', () => {
    it('turns 24/7 on and off again', async () => {
      const first = harness({ commandName: '247' });
      await service.toggleStayConnected(first.ctx);
      expect((await repository.find('guild'))?.stayConnected).toBe(true);
      expect(first.replies[0]?.title).toBe('24/7 on');

      const second = harness({ commandName: '247' });
      await service.toggleStayConnected(second.ctx);
      expect((await repository.find('guild'))?.stayConnected).toBe(false);
      expect(second.replies[0]?.title).toBe('24/7 off');
    });

    it('takes an explicit state rather than toggling', async () => {
      await service.toggleStayConnected(harness().ctx, false);

      expect((await repository.find('guild'))?.stayConnected).toBe(false);
    });

    it('says how long it will wait when switched off', async () => {
      await service.set(harness().ctx, 'idletimeout', '2m');

      const { ctx, replies } = harness();
      await service.toggleStayConnected(ctx, false);

      expect(replies[0]?.content).toContain('2 minute(s)');
    });

    it('leaves the other settings alone', async () => {
      await service.set(harness().ctx, 'prefix', '?');
      await service.toggleStayConnected(harness().ctx);

      expect((await repository.find('guild'))?.prefix).toBe('?');
    });
  });
});
