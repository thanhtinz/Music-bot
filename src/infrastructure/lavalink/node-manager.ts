/** Health of a single audio node, as last reported by its stats frame. */
export interface NodeStats {
  /** System CPU load, 0..1. */
  cpu: number;
  /** Memory in use, 0..1 of the node's allocation. */
  memory: number;
  players: number;
  latencyMs: number;
}

export type NodeState = 'connected' | 'connecting' | 'draining' | 'disconnected';

export interface NodeDescriptor {
  id: string;
  host: string;
  port: number;
  secure?: boolean;
  /** Relative capacity — a bigger node absorbs proportionally more players. */
  weight?: number;
  /** Region hint used to keep players close to their listeners (spec §32). */
  region?: string;
}

export interface NodeRuntime extends NodeDescriptor {
  state: NodeState;
  stats: NodeStats;
  /** Consecutive failures, feeding the score penalty and the backoff delay. */
  failures: number;
}

/**
 * Weights for the load-balancing score (spec §8.2).
 *
 * Player count dominates because it is the only signal that is accurate the
 * instant a player is assigned; CPU and memory lag behind by a stats interval.
 */
export const SCORE_WEIGHTS = {
  cpu: 25,
  memory: 10,
  players: 40,
  latency: 15,
  failurePenalty: 50,
} as const;

/** Player count treated as "full" when normalising. */
const PLAYER_SATURATION = 100;
/** Latency treated as "bad" when normalising. */
const LATENCY_SATURATION_MS = 500;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Scores a node; lower is better.
 *
 * Pure so the balancing policy can be tuned and tested without a live cluster.
 */
export function scoreNode(node: NodeRuntime): number {
  const weight = node.weight && node.weight > 0 ? node.weight : 1;

  const cpu = clamp01(node.stats.cpu) * SCORE_WEIGHTS.cpu;
  const memory = clamp01(node.stats.memory) * SCORE_WEIGHTS.memory;
  const players =
    clamp01(node.stats.players / (PLAYER_SATURATION * weight)) * SCORE_WEIGHTS.players;
  const latency = clamp01(node.stats.latencyMs / LATENCY_SATURATION_MS) * SCORE_WEIGHTS.latency;
  const penalty = node.failures * SCORE_WEIGHTS.failurePenalty;

  return cpu + memory + players + latency + penalty;
}

/**
 * Reconnect delay with full jitter.
 *
 * Jitter matters when a whole cluster drops at once: without it every bot
 * instance retries in lockstep and hammers the nodes back down.
 */
export function reconnectDelayMs(failures: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/**
 * Tracks the audio node pool and decides where a new player goes.
 *
 * Holds no sockets — the concrete Lavalink client feeds it stats and state, so
 * the routing policy stays testable on its own (spec §8).
 */
export class NodeManager {
  private readonly nodes = new Map<string, NodeRuntime>();

  register(descriptor: NodeDescriptor): NodeRuntime {
    if (this.nodes.has(descriptor.id)) {
      throw new Error(`Duplicate node id: ${descriptor.id}`);
    }

    const node: NodeRuntime = {
      ...descriptor,
      state: 'disconnected',
      failures: 0,
      stats: { cpu: 0, memory: 0, players: 0, latencyMs: 0 },
    };

    this.nodes.set(descriptor.id, node);
    return node;
  }

  get(id: string): NodeRuntime | undefined {
    return this.nodes.get(id);
  }

  list(): NodeRuntime[] {
    return [...this.nodes.values()];
  }

  /** Nodes that may take new players. */
  available(region?: string): NodeRuntime[] {
    const connected = this.list().filter((node) => node.state === 'connected');
    if (!region) return connected;

    // Prefer the requested region, but never refuse to play because it is down.
    const regional = connected.filter((node) => node.region === region);
    return regional.length > 0 ? regional : connected;
  }

  /** Records a stats frame and clears the failure penalty. */
  updateStats(id: string, stats: Partial<NodeStats>): void {
    const node = this.nodes.get(id);
    if (!node) return;

    node.stats = { ...node.stats, ...stats };
  }

  setState(id: string, state: NodeState): void {
    const node = this.nodes.get(id);
    if (!node) return;

    node.state = state;
    if (state === 'connected') node.failures = 0;
  }

  /** Marks a failed connection and returns how long to wait before retrying. */
  recordFailure(id: string, random: () => number = Math.random): number {
    const node = this.nodes.get(id);
    if (!node) return BASE_BACKOFF_MS;

    node.failures += 1;
    node.state = 'disconnected';
    return reconnectDelayMs(node.failures, random);
  }

  /**
   * Stops routing new players to a node without dropping its existing ones,
   * which is the first step of a graceful failover (spec §8.3).
   */
  drain(id: string): void {
    this.setState(id, 'draining');
  }

  /** Picks the healthiest node, or `undefined` when the cluster is down. */
  select(region?: string): NodeRuntime | undefined {
    const candidates = this.available(region);
    if (candidates.length === 0) return undefined;

    return candidates.reduce((best, node) => (scoreNode(node) < scoreNode(best) ? node : best));
  }

  /** Picks a replacement for a failed node, excluding it from the pool. */
  selectFailover(excludeId: string, region?: string): NodeRuntime | undefined {
    const candidates = this.available(region).filter((node) => node.id !== excludeId);
    if (candidates.length === 0) return undefined;

    return candidates.reduce((best, node) => (scoreNode(node) < scoreNode(best) ? node : best));
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(1, value);
}
