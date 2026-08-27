import { Events, type Client } from 'discord.js';
import { Connectors, Constants, Shoukaku } from 'shoukaku';

import { CommandRegistry } from './application/commands';
import {
  AutoplaySelector,
  IdleMonitor,
  PlayerManager,
  ProgressTicker,
  SleepTimer,
  type Player,
} from './application/player';
import { restoreSessions, SessionRecorder } from './application/session';
import { PlaylistService } from './application/playlist';
import { CachedSettingsRepository, SettingsService } from './application/settings';
import { StatsRecorder, StatsService } from './application/stats';
import { SearchService } from './application/search';
import { LyricsService } from './application/services/lyrics.service';
import { MusicService } from './application/services/music.service';
import { buildCommands } from './commands/handlers';
import { loadEnv } from './config/env';
import {
  healthPortFor,
  refuseUnsafeSharding,
  shardIdentity,
  shouldRegisterCommands,
} from './config/sharding';
import { dedupeNodes, parseNodes } from './config/nodes';
import { attachHandlers, createClient } from './infrastructure/discord/bot';
import { noticeEmbed } from './infrastructure/discord/context';
import {
  buildHelpCategories,
  buildHelpPagination,
  buildLyricsPagination,
  buildNowPlayingControls,
  buildPlaylistPagination,
  buildQueuePagination,
  buildSearchPicks,
} from './infrastructure/discord/components';
import { registerSlashCommands } from './infrastructure/discord/register-commands';
import { LavalinkBackend } from './infrastructure/lavalink/lavalink-backend';
import { createStores } from './infrastructure/storage/stores';
import { LrclibProvider } from './lyrics';
import {
  FileResolver,
  LavaSrcResolver,
  RadioResolver,
  ResolverRegistry,
  YouTubeResolver,
} from './resolvers';
import { configureCardEncoding } from './ui/canvas';
import { createBotMetrics } from './telemetry/bot-metrics';
import { createHealthServer } from './infrastructure/http/health-server';
import type { DashboardStatus } from './infrastructure/http/dashboard';
import { inviteUrl } from './infrastructure/http/invite';
import { createPublicServer } from './infrastructure/http/public-server';
import {
  toPublicStatus,
  type PublicStatus,
  type ShardVitals,
} from './infrastructure/http/public-status';
import { createLogger, logger } from './telemetry/logger';

const log = createLogger('main');

/**
 * A shard's own status, reachable from inside `broadcastEval`.
 *
 * That call runs its function in the other shard processes, where the only
 * thing in scope is their own client — so the reader is hung on the client
 * rather than closed over here, which would not survive the trip.
 */
type StatusClient = Client & {
  __shardStatus?: () => DashboardStatus & ShardVitals;
};

/**
 * Boots the bot.
 *
 * The graph is built strictly in dependency order — client, then audio node,
 * then player manager, then the service the command handlers call — so nothing
 * has to be patched together after the fact.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  // Set before anything renders, so every card in the process agrees on what
  // it is encoding to and what its attachment should be called.
  configureCardEncoding({ format: env.CARD_FORMAT, quality: env.CARD_QUALITY });

  // Which slice of guilds this process serves. A bot running on its own is
  // shard 0 of 1, so nothing below has to ask whether it is sharded.
  const shard = shardIdentity();

  // Where everything is kept: Postgres when DATABASE_URL is set, JSON files
  // otherwise. Built before anything that reads, because the schema is created
  // here and the first read must not race it.
  const stores = await createStores(env);

  const unsafe = refuseUnsafeSharding(shard, stores.kind);
  if (unsafe) {
    // Refused rather than logged and carried on: the damage is silent, and the
    // shard that loses the write has no way to know it lost anything.
    log.fatal({ shard: shard.id, shards: shard.total }, unsafe);
    await stores.close().catch(() => undefined);
    process.exit(1);
  }

  if (shard.managed) log.info({ shard: shard.id, of: shard.total }, 'running as a shard');

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

  // Stops the music at a time somebody chose. Built before the players so the
  // manager can hold it — a timer left running past a `leave` would come back
  // hours later and tear down whatever the guild is playing by then.
  const sleep = new SleepTimer({
    onSleep: async (guildId) => {
      const channelId = players.get(guildId)?.textChannelId;
      await players.destroy(guildId);

      const channel = client.channels.cache.get(channelId ?? '');
      if (!channel?.isSendable()) return;

      const embed = noticeEmbed({
        title: 'Good night',
        message: 'The sleep timer ran out, so I stopped the music and stepped out.',
        icon: 'clock',
        tone: 'info',
      });

      await channel.send({ embeds: [embed] }).catch(() => undefined);
    },
  });

  const resolvers = new ResolverRegistry();
  // Radio goes first so a station name is not swallowed by the search provider.
  // Spotify goes through the node's LavaSrc plugin rather than a second API
  // client here; see docker/lavalink/application.yml.
  resolvers.registerAll([
    // Uploads go first: an attachment is an HTTP URL like a radio stream is,
    // and only this one knows the difference between a file that ends and a
    // station that does not.
    new FileResolver(backend),
    new RadioResolver(),
    new LavaSrcResolver(backend),
    new YouTubeResolver(backend),
  ]);

  // Built before the players, which hold the callback that reaches it.
  const autoplay = new AutoplaySelector(resolvers);

  const players: PlayerManager = new PlayerManager(backend, {
    defaultVolume: env.DEFAULT_VOLUME,
    maxQueueSize: env.MAX_QUEUE_SIZE,
    idle,
    sleep,
    autoplayResolver: async (guildId, seed) => {
      const player = players.get(guildId);
      const avoid = player ? [...player.queue.history, ...player.queue.tracks] : [];

      return autoplay.suggest(guildId, seed, avoid);
    },
    onIdleLeave: async (player, reason) => {
      const channel = client.channels.cache.get(player.textChannelId ?? '');
      if (!channel?.isSendable()) return;

      const embed = noticeEmbed({
        title: 'Left the channel',
        message:
          reason === 'alone'
            ? 'Everyone left, so I stepped out too. Call me back with **join**.'
            : 'The queue ran out, so I stepped out. Call me back with **join**.',
        icon: 'exit',
        tone: 'info',
      });

      await channel.send({ embeds: [embed] }).catch(() => undefined);
    },
  });

  // Saved so a deploy in the middle of a set costs the listeners a few seconds
  // rather than their queue.
  const sessions = new SessionRecorder(stores.sessions);
  const statsRecorder = new StatsRecorder(stores.stats);

  // The moving line above a Now Playing panel. Only the message text is
  // rewritten, so the card is never re-encoded and never re-fetched.
  const progress = new ProgressTicker();

  players.onPlayerCreated = (player) => {
    sessions.watch(player);
    statsRecorder.watch(player);

    // A panel belongs to the track it was sent for: when that track ends there
    // is nothing left to follow, and the next one sends a panel of its own.
    player.on('trackEnd', ({ guildId }) => {
      progress.stop(guildId);
      // "Stop after this one" is spent by the track actually ending, whenever
      // that turns out to be — after a seek, a pause, or a skip.
      void sleep.trackEnded(guildId);
    });
    player.on('queueEnd', ({ guildId }) => progress.stop(guildId));

    // A track starting on its own is the one thing nobody's command is waiting
    // on, so without this a room only ever sees the song it asked for.
    player.on('trackStart', ({ guildId }) => {
      void announceIfWanted(guildId);
    });
  };

  /** Posts the panel for a track that started by itself, if the guild wants it. */
  const announceIfWanted = async (guildId: string): Promise<void> => {
    const player = players.get(guildId);
    if (!player) return;

    try {
      if (!(await settings.forGuild(guildId)).announceTracks) return;
      await service.announceTrack(player);
    } catch (error) {
      // An announcement is a courtesy; failing it must not disturb playback.
      log.warn({ err: error, guildId }, 'could not announce a track');
    }
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
        volume: player.volume,
        muted: player.muted,
      }),
    queueComponents: (page, totalPages) => buildQueuePagination(page, totalPages),
    progress,
    sleep,
    startingVolumeFor: async (guildId) => (await settings.forGuild(guildId)).defaultVolume,
    displayName: (userId) => client.users.cache.get(userId)?.displayName,
    guildName: (guildId) => client.guilds.cache.get(guildId)?.name,
    listenerCount: (guildId) => listenersOf(client, players, guildId)?.size,
    listenerIds: (guildId) => listenersOf(client, players, guildId),
    announce: async (channelId, payload) => {
      const channel = client.channels.cache.get(channelId);
      if (!channel?.isSendable()) return undefined;

      try {
        const sent = await channel.send({
          content: payload.content,
          files: payload.attachments.map((file) => ({
            attachment: file.data,
            name: file.name,
          })),
          components: payload.components as never[] | undefined,
        });

        return {
          async setContent(content: string) {
            try {
              await sent.edit({ content });
              return true;
            } catch {
              // Deleted, or the channel is gone: the ticker stops rather than
              // retrying into nothing.
              return false;
            }
          },
        };
      } catch (error) {
        log.warn({ err: error, channelId }, 'could not post a Now Playing panel');
        return undefined;
      }
    },
    directMessage: async (userId, payload) => {
      try {
        const user = await client.users.fetch(userId);
        await user.send({
          content: payload.content,
          files: (payload.attachments ?? []).map((file) => ({
            attachment: file.data,
            name: file.name,
          })),
        });
        return true;
      } catch (error) {
        // Closed DMs are the ordinary case, not a fault worth logging loudly:
        // plenty of people have messages from server members turned off.
        log.debug({ err: error, userId }, 'could not send a direct message');
        return false;
      }
    },
    channelName: (channelId) => {
      const channel = client.channels.cache.get(channelId);
      return channel && 'name' in channel ? (channel.name ?? undefined) : undefined;
    },
  });

  const playlists = new PlaylistService(stores.playlists, service, {
    prefix: env.DEFAULT_PREFIX,
    prefixFor: async (guildId) => (await settings.forGuild(guildId)).prefix,
    get botName() {
      return client.user?.username ?? 'MusicBot';
    },
    displayName: (userId) => client.users.cache.get(userId)?.displayName,
    libraryComponents: (page, totalPages) => buildPlaylistPagination(page, totalPages),
  });

  // Wrapped, because every message reads this before it knows whether it is a
  // command: the guild's prefix is what decides that. Free against the file
  // store, which holds its records in memory; a query per message against
  // Postgres.
  const settingsStore = new CachedSettingsRepository(stores.settings);

  const settings = new SettingsService(settingsStore, {
    defaults: {
      prefix: env.DEFAULT_PREFIX,
      defaultVolume: env.DEFAULT_VOLUME,
      ...(env.DJ_ROLE_ID === undefined ? {} : { djRoleId: env.DJ_ROLE_ID }),
      idleTimeoutMs: env.IDLE_TIMEOUT_MS,
    },
    guildName: (guildId) => client.guilds.cache.get(guildId)?.name,
    get botName() {
      // Read late: the client has no user until it is logged in.
      return client.user?.username ?? 'MusicBot';
    },
  });

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

  const stats = new StatsService(stores.stats, {
    displayName: (userId) => client.users.cache.get(userId)?.displayName,
    guildName: (guildId) => client.guilds.cache.get(guildId)?.name,
  });

  const registry = new CommandRegistry();
  registry.registerAll(
    buildCommands(service, {
      prefix: env.DEFAULT_PREFIX,
      // A getter, not a value: the commands are built before the client logs
      // in, so reading it now would freeze the fallback into every card.
      get botName() {
        return client.user?.username ?? 'MusicBot';
      },
      playlists,
      settings,
      lyrics,
      stats,
      search,
      helpComponents: (categories, active, page, totalPages) => [
        ...buildHelpCategories(categories, active),
        // 1-based, so a press and a typed `help 3 2` mean the same thing.
        ...buildHelpPagination(active + 1, page, totalPages),
      ],
    }),
  );

  attachHandlers(client, registry, service, players, {
    prefix: env.DEFAULT_PREFIX,
    settings,
    playlists,
    lyrics,
    search,
    onDispatched: (result, seconds) => {
      const name = result.command?.name ?? 'unknown';
      metrics.commands.increment({ command: name, status: result.status });
      metrics.commandDuration.observe(seconds, { command: name });
    },
    permissions: {
      botOwnerIds: env.BOT_OWNER_IDS,
      everyoneIsDj: env.EVERYONE_IS_DJ,
      djRoleId: env.DJ_ROLE_ID,
    },
  });

  client.once('clientReady', () => {
    log.info({ user: client.user?.tag, guilds: client.guilds.cache.size }, 'bot online');

    // Registration is global to the application, not to a shard: every shard
    // sending the same payload on every boot would be N identical writes for
    // one result.
    if (!shouldRegisterCommands(shard)) return;

    void registerSlashCommands({
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_DEV_GUILD_ID,
    }).catch((error) => log.error({ err: error }, 'slash registration failed'));
  });

  /** Everything this process knows about itself, for both status surfaces. */
  const dashboardStatus = (): DashboardStatus => ({
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
        ...(channel && 'name' in channel && channel.name ? { channelName: channel.name } : {}),
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
      // Shoukaku's own enum rather than the number it happens to be. It had
      // been compared against 2, which is DISCONNECTING: every healthy node
      // read as down, on the dashboard, on the status page and in the metric
      // an alert would watch. Only running against a real node showed it.
      connected: node.state === Constants.State.CONNECTED,
      players: node.stats?.players ?? 0,
      ...(node.stats?.cpu?.systemLoad === undefined ? {} : { cpu: node.stats.cpu.systemLoad }),
      ...(node.stats?.memory === undefined
        ? {}
        : {
            memory:
              node.stats.memory.allocated > 0
                ? node.stats.memory.used / node.stats.memory.allocated
                : 0,
          }),
    })),
  });

  // Attached to the client so `broadcastEval` can reach it from inside each
  // shard: that call runs its function in the other processes, where the only
  // thing in scope is their own client.
  (client as StatusClient).__shardStatus = () => ({
    ...dashboardStatus(),
    shardId: shard.id,
    // Read here rather than on shard 0's side of the broadcast: each of these
    // is a fact about *this* process, and asking the asker would report shard
    // zero's memory four times over.
    cachedUsers: client.users.cache.size,
    memoryBytes: process.memoryUsage().rss,
    updatedAt: Date.now(),
  });

  // Shards are separate processes on one machine, so they cannot all bind the
  // same port: each takes the base plus its id.
  const healthPort = healthPortFor(env.METRICS_PORT, shard);

  const health = healthPort
    ? createHealthServer({
        port: healthPort,
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
        status: dashboardStatus,
        collect: () => {
          metrics.players.set(players.size);
          metrics.guilds.set(client.guilds.cache.size);
          metrics.gatewayLatency.set(Math.max(0, Math.round(client.ws.ping)));

          for (const [name, node] of shoukaku.nodes) {
            metrics.nodeUp.set(node.state === Constants.State.CONNECTED ? 1 : 0, { node: name });
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

  /**
   * The last aggregate, refreshed on a timer rather than per request.
   *
   * Gathering it crosses process boundaries, which is asynchronous and costs a
   * round trip to every shard; doing that per request would let a link in a
   * busy server turn page views into gateway chatter. A status page fifteen
   * seconds behind is fine, and the response says so in its cache header.
   */
  let publicSnapshot: PublicStatus = toPublicStatus([]);

  /**
   * The public website, on shard 0 only.
   *
   * One page for the whole bot rather than one per process: the numbers on it
   * are totals, and a visitor landing on shard 3's copy seeing a third of the
   * servers would be reading a true number that answers the wrong question.
   */
  const site =
    env.PUBLIC_PORT && shard.id === 0
      ? createPublicServer({
          port: env.PUBLIC_PORT,
          host: env.PUBLIC_HOST,
          botName: client.user?.username ?? 'Melody',
          prefix: env.DEFAULT_PREFIX,
          inviteUrl: inviteUrl({ clientId: env.DISCORD_CLIENT_ID }),
          ...(env.PUBLIC_SOURCE_URL ? { sourceUrl: env.PUBLIC_SOURCE_URL } : {}),
          ...(env.PUBLIC_SUPPORT_URL ? { supportUrl: env.PUBLIC_SUPPORT_URL } : {}),
          status: () => publicSnapshot,
        })
      : undefined;

  const refreshPublicSnapshot = async (): Promise<void> => {
    try {
      const local = (client as StatusClient).__shardStatus!();

      const gathered = client.shard
        ? await client.shard.broadcastEval((each) => (each as StatusClient).__shardStatus?.())
        : [local];

      publicSnapshot = toPublicStatus(
        gathered.filter((entry): entry is DashboardStatus & ShardVitals => Boolean(entry)),
        // A shard that is down answers nothing, so the count it should have
        // been comes from the manager rather than from who replied.
        { expectedShards: client.shard?.count ?? shard.total },
      );
    } catch (error) {
      // A shard that is restarting cannot answer; the previous snapshot is a
      // better page than an error one.
      log.debug({ err: error }, 'could not refresh the public status');
    }
  };

  const snapshotTimer = site ? setInterval(() => void refreshPublicSnapshot(), 15_000) : undefined;
  snapshotTimer?.unref();

  if (site) {
    await refreshPublicSnapshot();
    await site.start().catch((error) => {
      // Nobody in a voice channel cares that the website is down.
      log.warn({ err: error, port: env.PUBLIC_PORT }, 'could not start the public site');
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
    progress.stopAll();
    sleep.stop();

    await players.destroyAll().catch(() => undefined);
    if (snapshotTimer) clearInterval(snapshotTimer);
    await site?.stop().catch(() => undefined);
    await health?.stop().catch(() => undefined);
    await client.destroy();
    // Last: the sessions written above are still going through it.
    await stores.close().catch(() => undefined);
  });

  client.once(Events.ClientReady, () => {
    // Restored once the gateway is up, because rejoining a voice channel needs
    // the guilds to be known.
    void restoreSessions(players, stores.sessions, {
      maxAgeMs: env.SESSION_MAX_AGE_MS,
      maxQueueSize: env.MAX_QUEUE_SIZE,
    }).catch((error) => log.error({ err: error }, 'could not restore sessions'));
  });

  await client.login(env.DISCORD_TOKEN);
}

/** Connects the audio node pool and logs its lifecycle (spec §8). */
/**
 * Who is listening in a guild's voice channel, bots excluded.
 *
 * `undefined` when the channel cannot be read — an unknown room and an empty
 * one mean different things to a skip vote and to `leavecleanup`, and both ask
 * this same question, so they cannot disagree about the answer.
 */
function listenersOf(
  client: Client,
  players: PlayerManager,
  guildId: string,
): Set<string> | undefined {
  const channelId = players.get(guildId)?.voiceChannelId;
  const channel = channelId ? client.channels.cache.get(channelId) : undefined;
  if (!channel?.isVoiceBased()) return undefined;

  return new Set(channel.members.filter((member) => !member.user.bot).map((member) => member.id));
}

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
