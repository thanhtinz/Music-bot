import {
  AttachmentBuilder,
  EmbedBuilder,
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
  type ReplyHandle,
  type ReplyPayload,
} from '../../application/commands';
import { createLogger } from '../../telemetry/logger';

const logger = createLogger('discord-context');

export interface ContextDependencies {
  tier: PermissionTier;
  /** Voice channel the invoking member is in, if any. */
  voiceChannelId?: string;
}

/** Accent colour per tone, matching what the notice cards used to paint. */
const TONE_COLOR: Record<NonNullable<ReplyPayload['tone']>, number> = {
  success: 0x57f287,
  info: 0x5865f2,
  warning: 0xfee75c,
  error: 0xed4245,
};

/** A small emoji for each glyph key a command reaches for. */
const ICON_EMOJI: Record<string, string> = {
  play: '▶️',
  pause: '⏸️',
  resume: '▶️',
  skip: '⏭️',
  previous: '⏮️',
  stop: '⏹️',
  shuffle: '🔀',
  loop: '🔁',
  volume: '🔊',
  sliders: '🎚️',
  queue: '📜',
  search: '🔍',
  playlist: '📂',
  plus: '➕',
  info: 'ℹ️',
  warning: '⚠️',
  trash: '🗑️',
  broom: '🧹',
  clock: '⏰',
  note: '🎵',
  gear: '⚙️',
  history: '🕘',
  list: '📋',
  exit: '🚪',
  chart: '📈',
};

/** Builds the embed a plain-text reply becomes, or nothing if there is nothing to show. */
function buildEmbed(payload: ReplyPayload): EmbedBuilder | undefined {
  if (!payload.title && !payload.content && !payload.fields?.length) return undefined;

  const tone = payload.tone ?? (payload.ephemeral ? 'warning' : 'success');
  const embed = new EmbedBuilder().setColor(TONE_COLOR[tone]);

  if (payload.title) {
    const icon = payload.icon ? `${ICON_EMOJI[payload.icon] ?? ''} ` : '';
    embed.setTitle(`${icon}${payload.title}`.trim());
  }

  if (payload.content) embed.setDescription(payload.content);

  if (payload.fields?.length) {
    embed.addFields(
      payload.fields.map((field) => ({
        name: field.name,
        value: field.value,
        ...(field.inline === undefined ? {} : { inline: field.inline }),
      })),
    );
  }

  if (payload.footer) embed.setFooter({ text: payload.footer });

  return embed;
}

/**
 * Builds a one-off notice embed for a message the bot sends on its own —
 * the sleep timer running out, or stepping out because the channel went
 * quiet — where there is no {@link CommandContext} to reply through.
 */
export function noticeEmbed(notice: {
  title?: string;
  message: string;
  icon?: string;
  tone?: ReplyPayload['tone'];
}): EmbedBuilder {
  // Never undefined: a title-or-content check gates buildEmbed, and this
  // notice always has a message.
  return buildEmbed({ content: notice.message, ...notice }) as EmbedBuilder;
}

/**
 * Turns a framework-neutral reply into the fields discord.js accepts.
 *
 * Kept as a bare object rather than a typed option bag: the same fields go to
 * `interaction.reply`, `interaction.editReply` and `message.reply`, and each of
 * those wants a different option type around them.
 *
 * An attachment (only the Now Playing panel carries one) is sent as-is, plain
 * text above the image; everything else — every notice, queue, list and
 * lookup — becomes a real Discord embed instead of a drawn card.
 */
export function toMessageOptions(payload: ReplyPayload): {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components?: never[];
} {
  const files = (payload.attachments ?? []).map(
    (attachment) => new AttachmentBuilder(attachment.data, { name: attachment.name }),
  );

  const components = payload.components ? { components: payload.components as never[] } : {};

  if (files.length > 0) {
    return {
      ...(payload.content ? { content: payload.content } : {}),
      files,
      ...components,
    };
  }

  const embed = buildEmbed(payload);

  return {
    ...(embed ? { embeds: [embed] } : {}),
    ...components,
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
      const found = interaction.options.get(name);
      // An attachment option's `value` is Discord's id for the upload, which
      // nothing downstream can play; the URL is what the resolver needs.
      return found?.attachment?.url ?? found?.value?.toString();
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

        // An ephemeral reply is nobody's panel, and editing one later has no
        // audience to keep up to date.
        return payload.ephemeral ? undefined : editContentOf(interaction);
      } catch (error) {
        // A reply can fail because the interaction token expired (3s to ack,
        // 15 minutes to edit); losing the reply must not fail the command.
        logger.warn({ err: error, commandName: interaction.commandName }, 'reply failed');
        return undefined;
      }
    },
  };
}

/**
 * A handle that rewrites an interaction reply's text and nothing else.
 *
 * `editReply` with only `content` leaves the attachment where it is, so the
 * card is not re-uploaded and a viewer's client does not re-fetch it — which is
 * what keeps a moving progress line from making the panel blink.
 */
function editContentOf(interaction: ChatInputCommandInteraction): ReplyHandle {
  return {
    async setContent(content: string) {
      try {
        await interaction.editReply({ content });
        return true;
      } catch (error) {
        // The token lasts fifteen minutes; a longer song outlives it, and the
        // caller is expected to stop rather than retry.
        logger.debug({ err: error }, 'could not edit an interaction reply');
        return false;
      }
    },
  };
}

/**
 * The same for a plain message the bot sent itself.
 *
 * A message the bot authored has no token behind it, so this one keeps working
 * for as long as the message exists.
 */
function editContentOfMessage(sent: Message): ReplyHandle {
  return {
    async setContent(content: string) {
      try {
        await sent.edit({ content });
        return true;
      } catch (error) {
        logger.debug({ err: error }, 'could not edit a sent message');
        return false;
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

  // A typed command carries its upload on the message rather than in an
  // argument, so the file lands under the option name the command declared for
  // it — `!play` with an mp3 attached reads the same as `/play file:…`.
  const upload = message.attachments.first()?.url;
  const fileOption = command?.options?.find((option) => option.type === 'attachment');
  if (upload && fileOption && !options.has(fileOption.name)) options.set(fileOption.name, upload);

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
          return editContentOfMessage(sent);
        }

        // Prefix commands have no ephemeral mode; the reply is just a message.
        sent = await message.reply(options);
        return editContentOfMessage(sent);
      } catch (error) {
        logger.warn({ err: error, commandName: parsed.name }, 'reply failed');
        return undefined;
      }
    },
  };
}

/** Voice channel the member is currently connected to, if any. */
export function voiceChannelOf(member: GuildMember | null): string | undefined {
  return member?.voice.channelId ?? undefined;
}
