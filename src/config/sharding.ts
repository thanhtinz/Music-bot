/**
 * What this process is, when the bot is spread across several of them.
 *
 * discord.js fills `SHARDS` and `SHARD_COUNT` in every process a
 * `ShardingManager` spawns, so a shard knows which slice of guilds it serves
 * without being told twice. A bot running on its own has neither, and is shard
 * 0 of 1 — the same code path, not a special case.
 */
export interface ShardIdentity {
  /** This process's shard id, counting from 0. */
  id: number;
  /** How many shards the bot is spread across. */
  total: number;
  /** True when a sharding manager spawned this process. */
  managed: boolean;
}

/** Reads the shard identity out of the environment a manager set up. */
export function shardIdentity(env: NodeJS.ProcessEnv = process.env): ShardIdentity {
  // `SHARDS` is a JSON array — a process can serve more than one shard — and
  // the first is the one everything here keys off.
  const ids = parseShardList(env.SHARDS);
  const total = Number(env.SHARD_COUNT);

  if (ids.length === 0 || !Number.isInteger(total) || total < 1) {
    return { id: 0, total: 1, managed: false };
  }

  return { id: ids[0]!, total, managed: true };
}

function parseShardList(raw: string | undefined): number[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];

    return list.filter(
      (value): value is number => Number.isInteger(value) && (value as number) >= 0,
    );
  } catch {
    // A bare number is what an operator writes by hand when running one shard.
    const single = Number(raw);
    return Number.isInteger(single) && single >= 0 ? [single] : [];
  }
}

/**
 * The health port this shard should listen on.
 *
 * Every shard is its own process on one machine, so they cannot all bind the
 * configured port — the second would fail to start, and a bot that dies because
 * its metrics endpoint collided is a bot that dies for no reason. Each shard
 * takes the base port plus its id, which keeps them predictable: shard 3 of a
 * bot on 9100 is on 9103.
 *
 * `0` stays `0`, because that is what turns the endpoint off.
 */
export function healthPortFor(basePort: number, shard: ShardIdentity): number {
  if (basePort === 0) return 0;
  return basePort + shard.id;
}

/**
 * Whether this process should publish the slash commands.
 *
 * Registration is global to the application, not to a shard: every shard doing
 * it would send the same payload N times on every boot, for nothing. Shard 0
 * does it, and a single-process bot is shard 0.
 */
export function shouldRegisterCommands(shard: ShardIdentity): boolean {
  return shard.id === 0;
}

/**
 * Why a sharded bot cannot keep its data in JSON files.
 *
 * The file stores read a whole file, change it and write it back. Two processes
 * doing that to the same file do not merge — the last writer wins and the other
 * shard's playlists are gone, without an error anywhere. Postgres is what makes
 * more than one process safe, so sharding without it is refused rather than
 * left to corrupt quietly.
 *
 * Returns the reason to refuse, or `undefined` when the setup is sound.
 */
export function refuseUnsafeSharding(
  shard: ShardIdentity,
  storeKind: 'postgres' | 'files',
): string | undefined {
  if (!shard.managed || shard.total < 2) return undefined;
  if (storeKind === 'postgres') return undefined;

  return (
    `Sharding needs DATABASE_URL. ${shard.total} processes writing the same JSON ` +
    'files would overwrite each other, and the loser would lose its playlists ' +
    'with nothing logged.'
  );
}
