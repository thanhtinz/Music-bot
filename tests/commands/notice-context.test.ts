import { describe, expect, it, vi } from 'vitest';

import {
  withNoticeCards,
  type CommandContext,
  type ReplyPayload,
} from '../../src/application/commands';
import { cardFile } from '../../src/ui/canvas';

function base(): { ctx: CommandContext; replies: ReplyPayload[] } {
  const replies: ReplyPayload[] = [];

  const ctx = {
    guildId: 'guild',
    channelId: 'channel',
    userId: 'user',
    commandName: 'volume',
    args: ['85'],
    rest: '85',
    sourceType: 'prefix',
    tier: 'everyone',
    correlationId: 'corr',
    async reply(payload: ReplyPayload) {
      replies.push(payload);
    },
    defer: vi.fn(async () => {}),
    option: vi.fn(() => '85'),
  } as unknown as CommandContext;

  return { ctx, replies };
}

const CARD = Buffer.from('card');

describe('withNoticeCards', () => {
  it('replaces a text reply with a rendered card', async () => {
    const { ctx, replies } = base();
    const render = vi.fn(async () => CARD);

    await withNoticeCards(ctx, { render }).reply({ content: 'Volume set to **85%**.' });

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Volume set to **85%**.', tone: 'success' }),
    );
    expect(replies[0]?.content).toBeUndefined();
    expect(replies[0]?.attachments).toEqual([{ name: cardFile('notice'), data: CARD }]);
  });

  it('passes the title and icon through to the card', async () => {
    const { ctx } = base();
    const render = vi.fn(async () => CARD);

    await withNoticeCards(ctx, { render }).reply({
      content: 'Volume set to **85%**.',
      title: 'Volume',
      icon: 'volume',
    });

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Volume', icon: 'volume' }),
    );
  });

  it('treats an ephemeral line as a warning by default', async () => {
    const { ctx } = base();
    const render = vi.fn(async () => CARD);

    await withNoticeCards(ctx, { render }).reply({ content: 'Nope.', ephemeral: true });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
  });

  it('lets an explicit tone win over that default', async () => {
    const { ctx } = base();
    const render = vi.fn(async () => CARD);

    await withNoticeCards(ctx, { render }).reply({
      content: 'Nope.',
      ephemeral: true,
      tone: 'error',
    });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });

  it('keeps the flags the reply already carried', async () => {
    const { ctx, replies } = base();

    await withNoticeCards(ctx, { render: async () => CARD }).reply({
      content: 'Nope.',
      ephemeral: true,
      edit: true,
      components: ['row'],
    });

    expect(replies[0]).toMatchObject({ ephemeral: true, edit: true, components: ['row'] });
  });

  it('leaves a reply that already has a panel alone', async () => {
    const { ctx, replies } = base();
    const render = vi.fn(async () => CARD);
    const existing = { name: 'queue.png', data: Buffer.from('queue') };

    await withNoticeCards(ctx, { render }).reply({
      content: 'Here is the queue.',
      attachments: [existing],
    });

    expect(render).not.toHaveBeenCalled();
    expect(replies[0]?.attachments).toEqual([existing]);
    expect(replies[0]?.content).toBe('Here is the queue.');
  });

  it('leaves a reply with nothing to draw alone', async () => {
    const { ctx, replies } = base();
    const render = vi.fn(async () => CARD);

    await withNoticeCards(ctx, { render }).reply({ components: ['row'] });

    expect(render).not.toHaveBeenCalled();
    expect(replies[0]).toEqual({ components: ['row'] });
  });

  it('falls back to the text when the card will not render', async () => {
    const { ctx, replies } = base();
    const render = vi.fn(async () => {
      throw new Error('canvas is unhappy');
    });

    await withNoticeCards(ctx, { render }).reply({ content: 'Volume set.' });

    // Losing the card is survivable; losing what the bot was saying is not.
    expect(replies[0]?.content).toBe('Volume set.');
    expect(replies[0]?.attachments).toBeUndefined();
  });

  it('uses the configured file name', async () => {
    const { ctx, replies } = base();

    await withNoticeCards(ctx, { render: async () => CARD, fileName: 'reply.png' }).reply({
      content: 'Done.',
    });

    expect(replies[0]?.attachments?.[0]?.name).toBe('reply.png');
  });

  it('leaves the rest of the context working', async () => {
    const { ctx } = base();
    const wrapped = withNoticeCards(ctx, { render: async () => CARD });

    await wrapped.defer(true);

    expect(wrapped.option('level')).toBe('85');
    expect(wrapped.guildId).toBe('guild');
    expect(ctx.defer).toHaveBeenCalledWith(true);
  });
});
