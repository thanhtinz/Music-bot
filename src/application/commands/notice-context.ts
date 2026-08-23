import { createLogger } from '../../telemetry/logger';

import type { CommandContext, ReplyPayload } from './context';

const logger = createLogger('notice-context');

/**
 * Renders a notice panel. Kept as a function so the application layer never
 * imports the canvas cards directly.
 */
export type NoticeRenderer = (notice: {
  title?: string;
  message: string;
  icon?: string;
  tone?: 'success' | 'info' | 'warning' | 'error';
  footnote?: string;
}) => Promise<Buffer>;

export interface NoticeContextOptions {
  render: NoticeRenderer;
  /** File name for the attachment; only visible if a client cannot render it. */
  fileName?: string;
}

/**
 * Wraps a context so plain-text replies come back as cards.
 *
 * Doing it here rather than at each call site means every command answers in
 * the same style — including the ones not written yet — and a command still
 * writes its reply as a sentence rather than as a drawing instruction.
 */
export function withNoticeCards(
  ctx: CommandContext,
  options: NoticeContextOptions,
): CommandContext {
  return {
    ...ctx,

    async reply(payload: ReplyPayload) {
      // Anything already carrying a panel is left alone, and so is an empty
      // reply: there is nothing to draw on a card.
      if (!payload.content || payload.attachments?.length) {
        return ctx.reply(payload);
      }

      const { content, ...rest } = payload;

      try {
        const card = await options.render({
          message: content,
          title: payload.title,
          icon: payload.icon,
          // An ephemeral line is almost always something that did not go
          // through, so it gets the warning accent unless told otherwise.
          tone: payload.tone ?? (payload.ephemeral ? 'warning' : 'success'),
        });

        return await ctx.reply({
          ...rest,
          attachments: [{ name: options.fileName ?? 'notice.png', data: card }],
        });
      } catch (error) {
        // A card that will not draw must not swallow what the bot was trying
        // to say, so the original text goes out instead.
        logger.warn({ err: error }, 'could not render a notice card; replying with text');
        return await ctx.reply(payload);
      }
    },

    defer: (ephemeral) => ctx.defer(ephemeral),
    option: (name) => ctx.option(name),
  };
}
