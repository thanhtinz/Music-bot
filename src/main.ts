import type { Client } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';

import { CommandRegistry } from './application/commands';
import { PlayerManager, type Player } from './application/player';
import { MusicService } from './application/services/music.service';
import { buildCommands } from './commands/handlers';
import { loadEnv } from './config/env';
import { attachHandlers, createClient } from './infrastructure/discord/bot';
import { buildNowPlayingControls, buildQueuePagination } from './infrastructure/discord/components';
import { registerSlashCommands } from './infrastructure/discord/register-commands';
import { LavalinkBackend } from './infrastructure/lavalink/lavalink-backend';
import { RadioResolver, ResolverRegistry, YouTubeResolver } from './resolvers';
import { createLogger, logger } from './telemetry/logger';

const log = createLogger('main');

/**
 * Boots the bot.
 *
 * The graph is built strictly in dependency order — client, then audio node,
 * then player manager, then the service the command handlers call — so nothing
 * has to be patched together after the fact.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const client = createClient();
  const shoukaku = createShoukaku(client, env);
  const backend = new LavalinkBackend(shoukaku, {
    shardIdFor: (guildId) => client.guilds.cache.get(guildId)?.shardId ?? 0,
  });

  const players = new PlayerManager(backend, {
    defaultVolume: env.DEFAULT_VOLUME,
    maxQueueSize: env.MAX_QUEUE_SIZE,
  });

  const resolvers = new ResolverRegistry();
  // Radio goes first so a station name is not swallowed by the search provider.
  resolvers.registerAll([new RadioResolver(), new YouTubeResolver(backend)]);

  const service = new MusicService(players, resolvers, {
    variant: env.CARD_VARIANT,
    theme: env.CANVAS_THEME,
    defaultVolume: env.DEFAULT_VOLUME,
    maxQueueSize: env.MAX_QUEUE_SIZE,
    nowPlayingComponents: (player: Player) =>
      buildNowPlayingControls({
        paused: player.status === 'paused',
        hasPrevious: player.queue.history.length > 0,
        hasQueue: player.queue.size > 0,
        loop: player.loop,
      }),
    queueComponents: (page, totalPages) => buildQueuePagination(page, totalPages),
    displayName: (userId) => client.users.cache.get(userId)?.displayName,
  });

  const registry = new CommandRegistry();
  registry.registerAll(buildCommands(service, { prefix: env.DEFAULT_PREFIX, botName: 'MusicBot' }));

  attachHandlers(client, registry, service, players, {
    prefix: env.DEFAULT_PREFIX,
    permissions: {
      botOwnerIds: env.BOT_OWNER_IDS,
      everyoneIsDj: env.EVERYONE_IS_DJ,
      djRoleId: env.DJ_ROLE_ID,
    },
  });

  client.once('clientReady', () => {
    log.info({ user: client.user?.tag, guilds: client.guilds.cache.size }, 'bot online');

    void registerSlashCommands({
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_DEV_GUILD_ID,
    }).catch((error) => log.error({ err: error }, 'slash registration failed'));
  });

  installShutdownHandlers(async () => {
    log.info('shutting down');
    await players.destroyAll().catch(() => undefined);
    await client.destroy();
  });

  await client.login(env.DISCORD_TOKEN);
}

/** Connects the audio node pool and logs its lifecycle (spec §8). */
function createShoukaku(client: Client, env: ReturnType<typeof loadEnv>): Shoukaku {
  const shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    [
      {
        name: env.LAVALINK_NAME,
        url: `${env.LAVALINK_HOST}:${env.LAVALINK_PORT}`,
        auth: env.LAVALINK_PASSWORD,
        secure: env.LAVALINK_SECURE,
      },
    ],
    { moveOnDisconnect: true, resume: true, reconnectTries: 10 },
  );

  shoukaku.on('ready', (name, reconnected) => {
    log.info({ node: name, reconnected }, 'lavalink node ready');
  });
  shoukaku.on('error', (name, error) => {
    log.error({ node: name, err: error }, 'lavalink node error');
  });
  shoukaku.on('close', (name, code, reason) => {
    log.warn({ node: name, code, reason }, 'lavalink node closed');
  });
  shoukaku.on('disconnect', (name, count) => {
    log.warn({ node: name, movedPlayers: count }, 'lavalink node disconnected');
  });

  return shoukaku;
}

/** Stops accepting work and drains players before exiting (spec §31). */
function installShutdownHandlers(shutdown: () => Promise<void>): void {
  let stopping = false;

  const handler = (signal: string) => {
    if (stopping) return;
    stopping = true;

    log.info({ signal }, 'received shutdown signal');
    void shutdown()
      .catch((error) => log.error({ err: error }, 'shutdown failed'))
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

main().catch((error) => {
  log.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
