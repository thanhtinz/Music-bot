import type { DashboardStatus } from './dashboard';

/**
 * One shard, as the public site is allowed to describe it.
 *
 * Counts and health, and nothing that names anybody.
 */
export interface PublicShard {
  id: number;
  ready: boolean;
  guilds: number;
  players: number;
  /** Round trip to Discord's gateway, in milliseconds. */
  latencyMs: number;
  uptimeMs: number;
}

export interface PublicNode {
  name: string;
  connected: boolean;
  players: number;
}

/** Everything the public site is allowed to know. */
export interface PublicStatus {
  botName: string;
  /** True when at least one shard is up and can play. */
  online: boolean;
  guilds: number;
  players: number;
  shards: PublicShard[];
  nodes: PublicNode[];
  /** The longest-running shard, which is the bot's own uptime. */
  uptimeMs: number;
}

/**
 * Reduces what the bot knows to what a stranger may see.
 *
 * This is the whole security boundary of the public site, so it is one function
 * and it works by construction: it reads named fields off the internal status
 * and never spreads it. A spread would mean the next field added to the
 * dashboard is published the day it is added, by nobody's decision.
 *
 * The internal dashboard lists guild names, channel names, track titles and how
 * many people are in each voice channel. None of that belongs on the internet —
 * it is a live record of what identifiable communities are listening to. What
 * comes out here is counts.
 */
export interface PublicStatusOptions {
  /**
   * How many shards the bot is supposed to have.
   *
   * A shard that is dead does not answer the broadcast at all, so it is absent
   * from the list rather than present and unhealthy — and a page that counted
   * only what answered would report "2/2 up" while a third of the servers had
   * no bot in them. The ones that did not answer are filled in as not
   * reporting, so the denominator is the truth.
   */
  expectedShards?: number;
}

export function toPublicStatus(
  shards: readonly (DashboardStatus & { shardId: number })[],
  options: PublicStatusOptions = {},
): PublicStatus {
  const nodes = new Map<string, PublicNode>();

  for (const shard of shards) {
    for (const node of shard.nodes) {
      const seen = nodes.get(node.name);

      // A node is shared between shards, so its players are summed while its
      // connectedness is "any shard can reach it".
      nodes.set(node.name, {
        name: node.name,
        connected: (seen?.connected ?? false) || node.connected,
        players: (seen?.players ?? 0) + node.players,
      });
    }
  }

  return {
    botName: shards[0]?.botName ?? 'Music Bot',
    online: shards.some((shard) => shard.ready),
    guilds: shards.reduce((total, shard) => total + shard.guilds, 0),
    players: shards.reduce((total, shard) => total + shard.players.length, 0),
    shards: withMissing(shards, options.expectedShards),
    nodes: [...nodes.values()].sort((left, right) => left.name.localeCompare(right.name)),
    uptimeMs: shards.reduce((longest, shard) => Math.max(longest, shard.uptimeMs), 0),
  };
}

/**
 * Every shard that answered, plus a row for every one that did not.
 *
 * A missing shard reports nothing rather than zero: it is not serving zero
 * servers, it is not saying, and those are different claims. Its uptime and
 * latency are zero because there is no honest number to put there.
 */
function withMissing(
  shards: readonly (DashboardStatus & { shardId: number })[],
  expected: number | undefined,
): PublicShard[] {
  const reported = new Map(
    shards.map((shard) => [
      shard.shardId,
      {
        id: shard.shardId,
        ready: shard.ready,
        guilds: shard.guilds,
        players: shard.players.length,
        latencyMs: Math.max(0, Math.round(shard.gatewayLatencyMs)),
        uptimeMs: Math.max(0, Math.round(shard.uptimeMs)),
      },
    ]),
  );

  const total = Math.max(expected ?? 0, reported.size);

  for (let id = 0; id < total; id++) {
    if (reported.has(id)) continue;
    reported.set(id, { id, ready: false, guilds: 0, players: 0, latencyMs: 0, uptimeMs: 0 });
  }

  return [...reported.values()].sort((left, right) => left.id - right.id);
}
