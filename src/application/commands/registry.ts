import type { Command } from './command';

/**
 * Name → command lookup shared by all three interfaces.
 *
 * Registering the same command once and resolving it for slash, prefix, and
 * mention is what guarantees the three behave identically (spec §37).
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly aliases = new Map<string, string>();

  /** Registers a command. Throws on a duplicate name or alias collision. */
  register(command: Command): void {
    const name = command.name.toLowerCase();

    if (this.commands.has(name) || this.aliases.has(name)) {
      throw new Error(`Duplicate command name: ${name}`);
    }

    for (const alias of command.aliases ?? []) {
      const key = alias.toLowerCase();
      if (this.commands.has(key) || this.aliases.has(key)) {
        throw new Error(`Duplicate command alias: ${key}`);
      }
    }

    this.commands.set(name, command);
    for (const alias of command.aliases ?? []) {
      this.aliases.set(alias.toLowerCase(), name);
    }
  }

  registerAll(commands: readonly Command[]): void {
    for (const command of commands) this.register(command);
  }

  /** Resolves a name or alias, case-insensitively. */
  get(nameOrAlias: string): Command | undefined {
    const key = nameOrAlias.toLowerCase();
    const resolved = this.commands.get(key);
    if (resolved) return resolved;

    const aliased = this.aliases.get(key);
    return aliased ? this.commands.get(aliased) : undefined;
  }

  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== undefined;
  }

  /** Every registered command, in registration order. */
  list(): Command[] {
    return [...this.commands.values()];
  }

  /** Commands grouped by category, for the help card. */
  byCategory(): Map<Command['category'], Command[]> {
    const grouped = new Map<Command['category'], Command[]>();

    for (const command of this.commands.values()) {
      const bucket = grouped.get(command.category);
      if (bucket) bucket.push(command);
      else grouped.set(command.category, [command]);
    }

    return grouped;
  }

  /**
   * Suggests the closest registered name for a typo.
   *
   * Uses edit distance with a cutoff that scales with the input length, so
   * `!ply` suggests `play` but `!xyzzy` suggests nothing.
   */
  suggest(nameOrAlias: string): string | undefined {
    const input = nameOrAlias.toLowerCase();
    const limit = input.length <= 4 ? 1 : 2;

    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of [...this.commands.keys(), ...this.aliases.keys()]) {
      const distance = editDistance(input, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.aliases.get(candidate) ?? candidate;
      }
    }

    return bestDistance <= limit ? best : undefined;
  }
}

/** Levenshtein distance, iterative single-row implementation. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }

  return previous[b.length] as number;
}
