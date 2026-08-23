/**
 * Per-user, per-command cooldown tracker (spec §26).
 *
 * In-memory by design: cooldowns are cheap abuse control, not a correctness
 * guarantee, so a bot restart resetting them is acceptable. Multi-instance
 * deployments layer a Redis counter on top of the same interface.
 */
export class CooldownTracker {
  private readonly hits = new Map<string, number>();
  /** Sweep once this many entries accumulate, to bound memory. */
  private readonly sweepThreshold = 5_000;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Records an attempt.
   *
   * Returns `0` when the command may run, or the milliseconds still remaining.
   */
  hit(userId: string, commandName: string, cooldownMs: number): number {
    if (cooldownMs <= 0) return 0;

    const key = `${userId}:${commandName}`;
    const now = this.now();
    const expiresAt = this.hits.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return expiresAt - now;
    }

    this.hits.set(key, now + cooldownMs);
    if (this.hits.size > this.sweepThreshold) this.sweep(now);
    return 0;
  }

  /** Milliseconds remaining without recording an attempt. */
  remaining(userId: string, commandName: string): number {
    const expiresAt = this.hits.get(`${userId}:${commandName}`);
    if (expiresAt === undefined) return 0;
    return Math.max(0, expiresAt - this.now());
  }

  /** Clears a user's cooldown, e.g. when a command failed before doing work. */
  clear(userId: string, commandName: string): void {
    this.hits.delete(`${userId}:${commandName}`);
  }

  reset(): void {
    this.hits.clear();
  }

  get size(): number {
    return this.hits.size;
  }

  private sweep(now: number): void {
    for (const [key, expiresAt] of this.hits) {
      if (expiresAt <= now) this.hits.delete(key);
    }
  }
}
