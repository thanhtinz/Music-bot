import {
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
} from 'discord.js';

import {
  mapPositionalOptions,
  type Command,
  type CommandContext,
  type PermissionTier,
  type ReplyPayload,
} from '../../application/commands';
import { createLogger } from '../../telemetry/logger';

const logger = createLogger('discord-context');

export interface ContextDependencies {
  tier: PermissionTier;
  /** Voice channel the invoking member is in, if any. */
  voiceChannelId?: string;
}

/**
 * Turns a framework-neutral reply into the fields discord.js accepts.
 *
 * Kept as a bare object rather than a typed option bag: the same fields go to
 * `interaction.reply`, `interaction.editReply` and `message.reply`, and each of
 * those wants a different option type around them.
 */
export function toMessageOptions(payload: ReplyPayload): {
  content?: string;
  files?: AttachmentBuilder[];
  components?: never[];
} {
  const files = (payload.attachments ?? []).map(
    (attachment) => new AttachmentBuilder(attachment.data, { name: attachment.name }),
  );

  return {
    ...(payload.content ? { content: payload.content } : {}),
    ...(files.length > 0 ? { files } : {}),
    // The application layer builds these; only this adapter knows their type.
    ...(payload.components ? { components: payload.components as never[] } : {}),
  };
}

/**
 * Builds a {@link CommandContext} from a slash-command interaction.
 *
 * Slash options are read by name; the same names the catalog declares, so a
 * command reads its arguments identically whichever interface invoked it.
 */
export function createInteractionContext(
  interaction: ChatInputCommandInteraction,
  dependencies: ContextDependencies,
): CommandContext {
  let deferred = false;
  let replied = false;

  return {
    guildId: interaction.guildId ?? '',
    channelId: interaction.channelId,
    userId: interaction.user.id,
    voiceChannelId: dependencies.voiceChannelId,
    commandName: interaction.commandName,
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: dependencies.tier,
    correlationId: interaction.id,

    option(name) {
      return interaction.options.get(name)?.value?.toString();
    },

    async defer(ephemeral) {
      if (deferred || replied || interaction.deferred || interaction.replied) return;
      deferred = true;
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    },

    async reply(payload) {
      const options = toMessageOptions(payload);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(options);
        } else if (payload.ephemeral) {
          await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply(options);
        }
        replied = true;
      } catch (error) {
        // A reply can fail because the interaction token expired (3s to ack,
        // 15 minutes to edit); losing the reply must not fail the command.
        logger.warn({ err: error, commandName: interaction.commandName }, 'reply failed');
      }
    },
  };
}

/**
 * Builds a {@link CommandContext} from a prefix or mention message.
 *
 * Positional arguments are mapped onto the command's declared option names, so
 * `!play chạy ngay đi` and `/play query:chạy ngay đi` produce the same context.
 */
export function createMessageContext(
  message: Message,
  parsed: { name: string; args: string[]; rest: string; source: 'prefix' | 'mention' },
  command: Command | undefined,
  dependencies: ContextDependencies,
): CommandContext {
  const options = command ? mapPositionalOptions(command, parsed.args) : new Map<string, string>();
  let sent: Message | undefined;

  return {
    guildId: message.guildId ?? '',
    channelId: message.channelId,
    userId: message.author.id,
    voiceChannelId: dependencies.voiceChannelId,
    commandName: parsed.name,
    args: parsed.args,
    rest: parsed.rest,
    sourceType: parsed.source,
    tier: dependencies.tier,
    correlationId: message.id,

    option(name) {
      return options.get(name);
    },

    async defer() {
      // Messages have no deferral; a typing indicator is the closest signal
      // that the bot heard the command and is working (spec §35).
      if (message.channel.isSendable()) {
        await message.channel.sendTyping().catch(() => undefined);
      }
    },

    async reply(payload) {
      const options = toMessageOptions(payload);

      try {
        if (payload.edit && sent) {
          await sent.edit(options);
          return;
        }

        // Prefix commands have no ephemeral mode; the reply is just a message.
        sent = await message.reply(options);
      } catch (error) {
        logger.warn({ err: error, commandName: parsed.name }, 'reply failed');
      }
    },
  };
}

/** Voice channel the member is currently connected to, if any. */
export function voiceChannelOf(member: GuildMember | null): string | undefined {
  return member?.voice.channelId ?? undefined;
}
