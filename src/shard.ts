import { resolve } from 'node:path';

import { ShardingManager } from 'discord.js';

import { loadEnv } from './config/env';
import { createLogger, logger } from './telemetry/logger';

const log = createLogger('sharding');

/**
 * Runs the bot across several processes (spec §32, F9).
 *
 * Discord requires a bot past roughly 2,500 guilds to split its gateway
 * connection into shards, and one process cannot hold them all comfortably long
 * before that. This spawns `main.ts` once per shard and lets discord.js hand
 * each process its slice; nothing in the bot itself changes, because a shard is
 * just a client that sees fewer guilds.
 *
 * Below that scale this is the wrong entry point. `npm start` runs one process,
 * which is simpler to reason about and to watch — use this when one process is
 * genuinely not enough, not before.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  if (!env.DATABASE_URL) {
    // The same refusal the shards themselves make, made here first so it costs
    // one message instead of N processes each starting and dying.
    log.fatal(
      'Sharding needs DATABASE_URL. Several processes writing the same JSON ' +
        'files would overwrite each other, and the loser would lose its ' +
        'playlists with nothing logged.',
    );
    process.exit(1);
  }

  const totalShards = env.SHARD_COUNT === 'auto' ? 'auto' : Number(env.SHARD_COUNT);

  const manager = new ShardingManager(resolve(__dirname, 'main.js'), {
    token: env.DISCORD_TOKEN,
    totalShards,
    // Each shard is a full bot process; respawning one that dies is the whole
    // point of running them under a manager.
    respawn: true,
    mode: 'process',
  });

  manager.on('shardCreate', (shard) => {
    log.info({ shard: shard.id }, 'shard starting');

    shard.on('death', () => log.error({ shard: shard.id }, 'shard died'));
    shard.on('ready', () => log.info({ shard: shard.id }, 'shard ready'));
    shard.on('disconnect', () => log.warn({ shard: shard.id }, 'shard disconnected'));
    shard.on('reconnecting', () => log.warn({ shard: shard.id }, 'shard reconnecting'));
  });

  /** Stops every shard this manager started. */
  const killAll = (): void => {
    for (const shard of manager.shards.values()) shard.kill();
  };

  const stop = (signal: string): void => {
    log.info({ signal }, 'stopping every shard');
    killAll();
    process.exit(0);
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  try {
    const shards = await manager.spawn();
    log.info({ shards: shards.size }, 'every shard spawned');
  } catch (error) {
    // A shard that dies during spawn rejects this, and the manager exiting on
    // its own would leave the ones that did start as orphans — still running,
    // still respawning, with nothing supervising them. Found by spawning for
    // real against a token Discord refused.
    log.fatal({ err: error }, 'a shard died while starting; stopping the rest');
    killAll();
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'the sharding manager failed to start');
  process.exit(1);
});
