import { Events, type Client } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';

import { CommandRegistry } from './application/commands';
import { AutoplaySelector, IdleMonitor, PlayerManager, type Player } from './application/player';
import { InMemorySessionRepository, restoreSessions, SessionRecorder } from './application/session';
import { InMemoryPlaylistRepository, PlaylistService } from './application/playlist';
import { InMemorySettingsRepository, SettingsService } from './application/settings';
import { InMemoryStatsRepository, StatsRecorder, StatsService } from './application/stats';
import { SearchService } from './application/search';
import { LyricsService } from './application/services/lyrics.service';
import { MusicService } from './application/services/music.service';
import { buildCommands } from './commands/handlers';
import { loadEnv } from './config/env';
import { dedupeNodes, parseNodes } from './config/nodes';
import { attachHandlers, createClient } from './infrastructure/discord/bot';
import {
  buildLyricsPagination,
  buildNowPlayingControls,
  buildPlaylistPagination,
  buildQueuePagination,
  buildSearchPicks,
} from './infrastructure/discord/components';
import { registerSlashCommands } from './infrastructure/discord/register-commands';
import { LavalinkBackend } from './infrastructure/lavalink/lavalink-backend';
import { JsonPlaylistRepository } from './infrastructure/storage/json-playlist-repository';
import { JsonSessionRepository } from './infrastructure/storage/json-session-repository';
import { JsonSettingsRepository } from './infrastructure/storage/json-settings-repository';
import { JsonStatsRepository } from './infrastructure/storage/json-stats-repository';
import { LrclibProvider } from './lyrics';
import { RadioResolver, ResolverRegistry, YouTubeResolver } from './resolvers';
import { renderSakuraNoticeCard } from './ui/canvas';
import { createBotMetrics } from './telemetry/bot-metrics';
import { createHealthServer } from './infrastructure/http/health-server';
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

  const metrics = createBotMetrics();
  const client = createClient();
  const shoukaku = createShoukaku(client, env);
  const backend = new LavalinkBackend(shoukaku, {
    shardIdFor: (guildId) => client.guilds.cache.get(guildId)?.shardId ?? 0,
  });

  // Built before the settings service so the manager can hold it, and given
  // its policy lookup afterwards — the two need each other.
  let readPolicy: (guildId: string) => Promise<{
    stayConnected: boolean;
    idleTimeoutMs: number;
  }> = async () => ({ stayConnected: false, idleTimeoutMs: env.IDLE_TIMEOUT_MS });

  const idle = new IdleMonitor({
    policyFor: (guildId) => readPolicy(guildId),
    onTimeout: (guildId, reason) => players.leaveIdle(guildId, reason),
  });

  const resolvers = new ResolverRegistry();
  // Radio goes first so a station name is not swallowed by the search provider.
  resolvers.registerAll([new RadioResolver(), new YouTubeResolver(backend)]);

  // Built before the players, which hold the callback that reaches it.
  const autoplay = new AutoplaySelector(resolvers);

  const players: PlayerManager = new PlayerManager(backend, {
    defaultVolume: env.DEFAULT_VOLUME,
    maxQueueSize: env.MAX_QUEUE_SIZE,
    idle,
    autoplayResolver: async (guildId, seed) => {
      const player = players.get(guildId);
      const avoid = player ? [...player.queue.history, ...player.queue.tracks] : [];

      return autoplay.suggest(guildId, seed, avoid);
    },
    onIdleLeave: async (player, reason) => {
      const channel = client.channels.cache.get(player.textChannelId ?? '');
      if (!channel?.isSendable()) return;

      const card = await renderSakuraNoticeCard({
        title: 'Left the channel',
        message:
          reason === 'alone'
            ? 'Everyone left, so I stepped out too. Call me back with **join**.'
            : 'The queue ran out, so I stepped out. Call me back with **join**.',
        icon: 'stop',
        tone: 'info',
      });

      await channel
        .send({ files: [{ attachment: card, name: 'notice.png' }] })
        .catch(() => undefined);
    },
  });

  // Saved so a deploy in the middle of a set costs the listeners a few seconds
  // rather than their queue.
  const sessionStore = env.SESSION_STORE_PATH
    ? new JsonSessionRepository(env.SESSION_STORE_PATH)
    : new InMemorySessionRepository();
  const sessions = new SessionRecorder(sessionStore);
  const statsStore = env.STATS_STORE_PATH
    ? new JsonStatsRepository(env.STATS_STORE_PATH)
    : new InMemoryStatsRepository();
  const statsRecorder = new StatsRecorder(statsStore);

  players.onPlayerCreated = (player) => {
    sessions.watch(player);
    statsRecorder.watch(player);
  };

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
    listenerCount: (guildId) => {
      const channelId = players.get(guildId)?.voiceChannelId;
      const channel = channelId ? client.channels.cache.get(channelId) : undefined;
      if (!channel?.isVoiceBased()) return undefined;

      return channel.members.filter((member) => !member.user.bot).size;
    },
    channelName: (channelId) => {
      const channel = client.channels.cache.get(channelId);
      return channel && 'name' in channel ? (channel.name ?? undefined) : undefined;
    },
  });

  // A file store when one is configured, memory otherwise: playlists that do
  // not survive a restart still beat a playlist command that reports an outage.
  const playlists = new PlaylistService(
    env.PLAYLIST_STORE_PATH
      ? new JsonPlaylistRepository(env.PLAYLIST_STORE_PATH)
      : new InMemoryPlaylistRepository(),
    service,
    {
      prefix: env.DEFAULT_PREFIX,
      displayName: (userId) => client.users.cache.get(userId)?.displayName,
      libraryComponents: (page, totalPages) => buildPlaylistPagination(page, totalPages),
    },
  );

  const settings = new SettingsService(
    env.SETTINGS_STORE_PATH
      ? new JsonSettingsRepository(env.SETTINGS_STORE_PATH)
      : new InMemorySettingsRepository(),
    {
      defaults: {
        prefix: env.DEFAULT_PREFIX,
        defaultVolume: env.DEFAULT_VOLUME,
        ...(env.DJ_ROLE_ID === undefined ? {} : { djRoleId: env.DJ_ROLE_ID }),
        idleTimeoutMs: env.IDLE_TIMEOUT_MS,
      },
      guildName: (guildId) => client.guilds.cache.get(guildId)?.name,
    },
  );

  readPolicy = async (guildId) => {
    const guild = await settings.forGuild(guildId);
    return { stayConnected: guild.stayConnected, idleTimeoutMs: guild.idleTimeoutMs };
  };

  const lyrics = new LyricsService(new LrclibProvider(), service, {
    pageComponents: (page, totalPages) => buildLyricsPagination(page, totalPages),
  });

  const search = new SearchService(resolvers, service, {
    searchComponents: (count) => buildSearchPicks(count),
  });

  const stats = new StatsService(statsStore, {
    displayName: (userId) => client.users.cache.get(userId)?.displayName,
    guildName: (guildId) => client.guilds.cache.get(guildId)?.name,
  });

  const registry = new CommandRegistry();
  registry.registerAll(
    buildCommands(service, {
      prefix: env.DEFAULT_PREFIX,
      botName: 'MusicBot',
      playlists,
      settings,
      lyrics,
      stats,
      search,
    }),
  );

  attachHandlers(client, registry, service, players, {
    prefix: env.DEFAULT_PREFIX,
    playlists,
    lyrics,
    search,
    onDispatched: (result, seconds) => {
      const name = result.command?.name ?? 'unknown';
      metrics.commands.increment({ command: name, status: result.status });
      metrics.commandDuration.observe(seconds, { command: name });
    },
    // Every text reply comes back as a panel in the same style as the Now
    // Playing and queue cards, rather than as a bare line of chat.
    ...(env.CARD_VARIANT === 'sakura' ? { notices: renderSakuraNoticeCard } : {}),
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

  const health = env.METRICS_PORT
    ? createHealthServer({
        port: env.METRICS_PORT,
        ...(env.METRICS_HOST ? { host: env.METRICS_HOST } : {}),
        registry: metrics.registry,
        report: () => ({
          // Alive means the process is running; readiness is what says whether
          // it can actually play anything, so a dead audio node does not get
          // the container restarted.
          alive: true,
          ready: client.isReady() && shoukaku.nodes.size > 0,
          details: {
            gateway: client.isReady(),
            nodes: shoukaku.nodes.size,
            players: players.size,
          },
        }),
        status: () => ({
          botName: client.user?.username ?? 'Melody',
          ready: client.isReady(),
          uptimeMs: client.uptime ?? 0,
          guilds: client.guilds.cache.size,
          gatewayLatencyMs: Math.max(0, client.ws.ping),
          players: players.list().map((player) => {
            const channel = client.channels.cache.get(player.voiceChannelId);
            const listeners =
              channel?.isVoiceBased() === true
                ? channel.members.filter((member) => !member.user.bot).size
                : undefined;

            return {
              guildId: player.guildId,
              ...(client.guilds.cache.get(player.guildId)?.name === undefined
                ? {}
                : { guildName: client.guilds.cache.get(player.guildId)!.name }),
              ...(channel && 'name' in channel && channel.name
                ? { channelName: channel.name }
                : {}),
              status: player.status,
              ...(player.queue.current === undefined
                ? {}
                : { title: player.queue.current.title, author: player.queue.current.author }),
              positionMs: player.positionMs,
              durationMs: player.queue.current?.durationMs ?? 0,
              queueLength: player.queue.size,
              ...(listeners === undefined ? {} : { listeners }),
            };
          }),
          nodes: [...shoukaku.nodes].map(([name, node]) => ({
            name,
            connected: node.state === 2,
            players: node.stats?.players ?? 0,
            ...(node.stats?.cpu?.systemLoad === undefined
              ? {}
              : { cpu: node.stats.cpu.systemLoad }),
            ...(node.stats?.memory === undefined
              ? {}
              : {
                  memory:
                    node.stats.memory.allocated > 0
                      ? node.stats.memory.used / node.stats.memory.allocated
                      : 0,
                }),
          })),
        }),
        collect: () => {
          metrics.players.set(players.size);
          metrics.guilds.set(client.guilds.cache.size);
          metrics.gatewayLatency.set(Math.max(0, Math.round(client.ws.ping)));

          for (const [name, node] of shoukaku.nodes) {
            metrics.nodeUp.set(node.state === 2 ? 1 : 0, { node: name });
            metrics.nodePlayers.set(node.stats?.players ?? 0, { node: name });
          }
        },
      })
    : undefined;

  if (health) {
    await health.start().catch((error) => {
      // A missing metrics endpoint is not a reason to refuse to play music.
      log.warn({ err: error, port: env.METRICS_PORT }, 'could not start the health endpoint');
    });
  }

  installShutdownHandlers(async () => {
    log.info('shutting down');
    // Written before the players are torn down: destroying them first would
    // save the state of a queue that has already been cleared.
    await sessions.flushAll(players).catch((error) => {
      log.warn({ err: error }, 'could not save sessions on the way out');
    });
    sessions.stop();

    await players.destroyAll().catch(() => undefined);
    await health?.stop().catch(() => undefined);
    await client.destroy();
  });

  client.once(Events.ClientReady, () => {
    // Restored once the gateway is up, because rejoining a voice channel needs
    // the guilds to be known.
    void restoreSessions(players, sessionStore, {
      maxAgeMs: env.SESSION_MAX_AGE_MS,
      maxQueueSize: env.MAX_QUEUE_SIZE,
    }).catch((error) => log.error({ err: error }, 'could not restore sessions'));
  });

  await client.login(env.DISCORD_TOKEN);
}

/** Connects the audio node pool and logs its lifecycle (spec §8). */
function createShoukaku(client: Client, env: ReturnType<typeof loadEnv>): Shoukaku {
  const extra = parseNodes(env.LAVALINK_NODES);
  for (const entry of extra.rejected) {
    // One typo in a list of three should cost that node, not the whole bot.
    log.warn({ entry }, 'ignoring an audio node that could not be parsed');
  }

  const nodes = dedupeNodes([
    {
      name: env.LAVALINK_NAME,
      url: `${env.LAVALINK_HOST}:${env.LAVALINK_PORT}`,
      auth: env.LAVALINK_PASSWORD,
      secure: env.LAVALINK_SECURE,
    },
    ...extra.nodes,
  ]);

  log.info({ nodes: nodes.map((node) => node.name) }, 'audio nodes configured');

  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: true,
    resume: true,
    reconnectTries: 10,
  });

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
