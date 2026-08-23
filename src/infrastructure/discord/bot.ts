import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ButtonInteraction,
  type GuildMember,
  type Interaction,
  type Message,
  type VoiceState,
} from 'discord.js';

import {
  CommandRouter,
  parseMessage,
  type CommandContext,
  type CommandRegistry,
  type ReplyPayload,
} from '../../application/commands';
import { withNoticeCards, type NoticeRenderer } from '../../application/commands';
import type { PlaylistService } from '../../application/playlist';
import type { LyricsService } from '../../application/services/lyrics.service';
import type { MusicService } from '../../application/services/music.service';
import type { PlayerManager } from '../../application/player';
import { createLogger } from '../../telemetry/logger';

import { decodeComponentId } from './components';
import {
  createInteractionContext,
  createMessageContext,
  toMessageOptions,
  voiceChannelOf,
} from './context';
import { missingVoicePermissions, resolveTier, type GuildPermissionSettings } from './permissions';

const logger = createLogger('discord-bot');

export interface BotOptions {
  prefix: string;
  permissions: GuildPermissionSettings;
  /** Saved playlists; without it the library's page buttons say so. */
  playlists?: PlaylistService;
  /** Lyrics, for the page buttons on a lyrics card. */
  lyrics?: LyricsService;
  /**
   * Draws text replies as notice panels.
   *
   * Left out, commands answer in plain text — which is what the tests want,
   * and what a deployment gets if rendering is ever turned off.
   */
  notices?: NoticeRenderer;
}

/**
 * Creates the gateway client.
 *
 * Separate from {@link attachHandlers} because Shoukaku needs the client before
 * the audio backend — and therefore the service the handlers call — can exist.
 */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      // Needed for prefix commands; enable "Message Content" in the developer
      // portal or the bot only ever sees slash commands and mentions.
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}

/**
 * Wires the three entry points onto a client.
 *
 * Slash commands, prefix/mention messages and button presses all end up calling
 * the same {@link MusicService}; this file only translates between Discord's
 * shapes and the application's.
 */
export function attachHandlers(
  client: Client,
  registry: CommandRegistry,
  service: MusicService,
  players: PlayerManager,
  options: BotOptions,
): Client {
  const router = new CommandRouter(registry, {
    prefixFor: (ctx) => (ctx.sourceType === 'slash' ? '/' : options.prefix),
  });

  // The bot leaves a channel it is alone in, so it has to know when that
  // becomes true — including when the last person leaves mid-track.
  client.on(Events.VoiceStateUpdate, (before: VoiceState, after: VoiceState) => {
    const guildId = after.guild?.id ?? before.guild?.id;
    if (!guildId) return;

    const player = players.get(guildId);
    if (!player) return;

    // Only states touching the bot's own channel can change whether it is
    // alone; anything else is somebody else's room.
    const channelId = player.voiceChannelId;
    if (before.channelId !== channelId && after.channelId !== channelId) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return;

    const humans = channel.members.filter((member) => !member.user.bot).size;
    void players.setAlone(guildId, humans === 0).catch((error) => {
      logger.warn({ err: error, guildId }, 'could not update the idle watch');
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, registry, router, service, options).catch((error) => {
      logger.error({ err: error }, 'interaction handler failed');
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message, registry, router, client, options).catch((error) => {
      logger.error({ err: error }, 'message handler failed');
    });
  });

  // Leaving an empty channel is both polite and cheaper than holding a node
  // slot for nobody (spec §15).
  client.on(Events.VoiceStateUpdate, (oldState) => {
    const guildId = oldState.guild.id;
    const player = players.get(guildId);
    if (!player) return;

    const channel = oldState.guild.channels.cache.get(player.voiceChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((member) => !member.user.bot).size;
    if (humans === 0) {
      logger.info({ guildId }, 'voice channel empty, stopping playback');
      void players.destroy(guildId);
    }
  });

  return client;
}

async function handleInteraction(
  interaction: Interaction,
  registry: CommandRegistry,
  router: CommandRouter,
  service: MusicService,
  options: BotOptions,
): Promise<void> {
  if (interaction.isButton()) {
    await handleButton(interaction, service, options);
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  const member = interaction.member as GuildMember | null;
  const voiceChannelId = voiceChannelOf(member);

  const command = registry.get(interaction.commandName);
  const context = decorate(
    createInteractionContext(interaction, {
      tier: member ? resolveTier(member, options.permissions) : 'everyone',
      voiceChannelId,
    }),
    options,
  );

  if (command?.requiresVoice && voiceChannelId) {
    const denied = await refuseWithoutVoicePermissions(interaction.guild, voiceChannelId, context);
    if (denied) return;
  }

  await router.dispatch(context);
}

async function handleMessage(
  message: Message,
  registry: CommandRegistry,
  router: CommandRouter,
  client: Client,
  options: BotOptions,
): Promise<void> {
  if (message.author.bot || !message.inGuild() || !client.user) return;

  const parsed = parseMessage(message.content, {
    prefix: options.prefix,
    botUserId: client.user.id,
  });
  if (!parsed) return;

  const member = message.member;
  const voiceChannelId = voiceChannelOf(member);
  const command = registry.get(parsed.name);

  const context = decorate(
    createMessageContext(message, parsed, command, {
      tier: member ? resolveTier(member, options.permissions) : 'everyone',
      voiceChannelId,
    }),
    options,
  );

  if (command?.requiresVoice && voiceChannelId) {
    const denied = await refuseWithoutVoicePermissions(message.guild, voiceChannelId, context);
    if (denied) return;
  }

  await router.dispatch(context);
}

/**
 * Handles a button press on a panel the bot posted.
 *
 * Buttons act on the guild's player directly rather than going through the
 * command router: there is no argument to parse, and the press has already
 * proven the user can see the channel.
 */
async function handleButton(
  interaction: ButtonInteraction,
  service: MusicService,
  options: BotOptions,
): Promise<void> {
  const id = decodeComponentId(interaction.customId);
  if (!id || !interaction.inGuild()) return;

  // Acknowledge inside Discord's three-second window; the panel is edited after.
  await interaction.deferUpdate().catch(() => undefined);

  const member = interaction.member as GuildMember | null;
  const context = decorate(
    createButtonContext(interaction, {
      tier: member ? resolveTier(member, options.permissions) : 'everyone',
      voiceChannelId: voiceChannelOf(member),
    }),
    options,
  );

  switch (id.action) {
    case 'playpause':
      await service.togglePause(context);
      return;
    case 'skip':
      await service.skip(context);
      return;
    case 'previous':
      await service.previous(context);
      return;
    case 'shuffle':
      await service.shuffle(context);
      return;
    case 'loop':
      await service.setLoop(context);
      return;
    case 'stop':
      await service.stop(context);
      return;
    case 'queue':
      await service.queue(context, 1);
      return;
    case 'page':
      await service.queue(context, Number(id.arg) || 1);
      return;
    case 'plpage':
      await options.playlists?.list(context, Number(id.arg) || 1);
      return;
    case 'lypage':
      await options.lyrics?.page(context, Number(id.arg) || 1);
      return;
    case 'favorite':
      await options.playlists?.toggleFavorite(context);
      return;
    default:
      return;
  }
}

/** Applies the notice-card wrapper, when one is configured. */
function decorate(context: CommandContext, options: BotOptions): CommandContext {
  return options.notices ? withNoticeCards(context, { render: options.notices }) : context;
}

/**
 * Context for a button press.
 *
 * Replies edit the panel the button sits on, so pressing next page swaps the
 * image in place instead of posting a new message (spec §35).
 */
function createButtonContext(
  interaction: ButtonInteraction,
  dependencies: { tier: CommandContext['tier']; voiceChannelId?: string },
): CommandContext {
  return {
    guildId: interaction.guildId ?? '',
    channelId: interaction.channelId,
    userId: interaction.user.id,
    voiceChannelId: dependencies.voiceChannelId,
    commandName: 'button',
    args: [],
    rest: '',
    sourceType: 'slash',
    tier: dependencies.tier,
    correlationId: interaction.id,

    option: () => undefined,
    defer: async () => undefined,

    async reply(payload: ReplyPayload) {
      const options = toMessageOptions(payload);

      try {
        if (payload.ephemeral) {
          await interaction.followUp({ ...options, ephemeral: true });
          return;
        }

        await interaction.editReply(options);
      } catch (error) {
        logger.warn({ err: error, action: interaction.customId }, 'button reply failed');
      }
    },
  };
}

/** Replies with the missing permissions and reports whether it refused. */
async function refuseWithoutVoicePermissions(
  guild: { members: { me: GuildMember | null } } | null,
  voiceChannelId: string,
  context: CommandContext,
): Promise<boolean> {
  const me = guild?.members.me;
  if (!me) return false;

  const missing = missingVoicePermissions(me, voiceChannelId);
  if (missing.length === 0) return false;

  await context.reply({
    content: `I need **${missing.join('**, **')}** in that voice channel.`,
    ephemeral: true,
  });
  return true;
}
