import { ResolverError } from './errors';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive provider faults before the circuit opens. */
  failureThreshold?: number;
  /** How long to stay open before letting one probe through. */
  openMs?: number;
  /** Successful probes needed to close again. */
  successThreshold?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

const DEFAULTS = {
  failureThreshold: 5,
  openMs: 30_000,
  successThreshold: 2,
};

/**
 * Per-provider circuit breaker (spec §26).
 *
 * When a source starts failing, every command that touches it would otherwise
 * wait out the same timeout. Opening the circuit turns that into an immediate,
 * explainable error and gives the provider room to recover.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly successThreshold: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULTS.failureThreshold);
    this.openMs = Math.max(0, options.openMs ?? DEFAULTS.openMs);
    this.successThreshold = Math.max(1, options.successThreshold ?? DEFAULTS.successThreshold);
    this.now = options.now ?? Date.now;
  }

  /** Current state, after accounting for an elapsed open window. */
  get status(): BreakerState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) {
      this.state = 'half-open';
      this.successes = 0;
    }
    return this.state;
  }

  /** Whether a call may go through right now. */
  get allowsRequest(): boolean {
    return this.status !== 'open';
  }

  /**
   * Runs `work` through the breaker.
   *
   * Only provider faults count against it: a track that does not exist is a
   * correct answer, not a sign the source is down.
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.allowsRequest) {
      throw new ResolverError('PROVIDER_ERROR', `${this.name} is temporarily unavailable.`, {
        source: this.name,
        retryAfterMs: Math.max(0, this.openMs - (this.now() - this.openedAt)),
      });
    }

    try {
      const result = await work();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (error instanceof ResolverError && !error.indicatesProviderFault) {
        // A definitive answer — the provider is fine, this input is not.
        this.recordSuccess();
        throw error;
      }

      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    if (this.status === 'half-open') {
      this.successes += 1;
      if (this.successes >= this.successThreshold) this.close();
      return;
    }

    this.failures = 0;
  }

  recordFailure(): void {
    if (this.status === 'half-open') {
      this.open();
      return;
    }

    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.open();
  }

  /** Forces the circuit closed, e.g. after an operator clears an incident. */
  reset(): void {
    this.close();
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = this.now();
    this.successes = 0;
  }

  private close(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
  }
}

/**
 * Runs `work` with a timeout, converting the overrun into a classified error.
 *
 * Resolvers must never hang a command: the user is waiting on a deferred reply
 * that Discord will eventually expire (spec §26).
 */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  source: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ResolverError('TIMEOUT', `${source} timed out after ${timeoutMs}ms.`, {
        source,
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retries `work` while the error is retryable, backing off between attempts.
 *
 * Bounded on purpose: a resolver that keeps retrying holds the guild's player
 * lock and delays every queued command behind it.
 */
export async function retry<T>(
  work: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;

      const retryable = !(error instanceof ResolverError) || error.retryable;
      if (!retryable || attempt === attempts) break;

      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
