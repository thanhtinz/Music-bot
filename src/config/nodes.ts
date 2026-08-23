/** One audio node, as Shoukaku wants it described. */
export interface NodeConfig {
  name: string;
  url: string;
  auth: string;
  secure: boolean;
}

/**
 * Parses the extra-nodes string.
 *
 * `name@host:port:password[:secure]`, comma separated. A compact format rather
 * than JSON because it lives in an environment variable, where quoting JSON is
 * how people end up with a bot that will not start.
 *
 * Entries that do not parse are skipped rather than fatal: one typo in a list
 * of three nodes should cost that node, not the whole bot.
 */
export function parseNodes(raw: string): { nodes: NodeConfig[]; rejected: string[] } {
  const nodes: NodeConfig[] = [];
  const rejected: string[] = [];

  for (const entry of raw.split(',')) {
    const text = entry.trim();
    if (!text) continue;

    const match = /^([^@]+)@([^:]+):(\d+):([^:]+)(?::(secure|tls))?$/.exec(text);
    if (!match) {
      rejected.push(text);
      continue;
    }

    const [, name, host, port, auth, secure] = match;
    nodes.push({
      name: name!.trim(),
      url: `${host!.trim()}:${port}`,
      auth: auth!.trim(),
      secure: secure !== undefined,
    });
  }

  return { nodes, rejected };
}

/** Drops nodes that repeat a name or an address already in the list. */
export function dedupeNodes(nodes: readonly NodeConfig[]): NodeConfig[] {
  const seen = new Set<string>();

  return nodes.filter((node) => {
    // Either a repeated name or a repeated address would give one node two
    // entries, and Shoukaku would connect to it twice.
    const keys = [`name:${node.name}`, `url:${node.url}`];
    if (keys.some((key) => seen.has(key))) return false;

    for (const key of keys) seen.add(key);
    return true;
  });
}
