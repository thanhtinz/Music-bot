/**
 * Error classes a resolver can fail with (spec §24).
 *
 * The command layer maps these to user-facing messages, and the circuit breaker
 * treats them differently: a track being unavailable says nothing about the
 * provider's health, whereas a rate limit or timeout does.
 */
export type ResolverErrorCode =
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'AGE_RESTRICTED'
  | 'PRIVATE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'BLOCKED_SOURCE'
  | 'INVALID_INPUT';

export class ResolverError extends Error {
  constructor(
    readonly code: ResolverErrorCode,
    message: string,
    readonly options: { source?: string; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ResolverError';
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /**
   * Whether retrying the same request could plausibly succeed.
   *
   * A private video stays private; a timeout might not time out twice.
   */
  get retryable(): boolean {
    return (
      this.code === 'TIMEOUT' || this.code === 'RATE_LIMITED' || this.code === 'PROVIDER_ERROR'
    );
  }

  /**
   * Whether this failure says the provider itself is unhealthy.
   *
   * Only these trip the circuit breaker — otherwise a run of unavailable tracks
   * would take a perfectly healthy provider offline.
   */
  get indicatesProviderFault(): boolean {
    return (
      this.code === 'TIMEOUT' || this.code === 'RATE_LIMITED' || this.code === 'PROVIDER_ERROR'
    );
  }
}

/** Short, actionable text for the user (spec §24, §35). */
export function describeResolverError(error: unknown): string {
  if (!(error instanceof ResolverError)) {
    return 'Could not load that track. Please try again.';
  }

  switch (error.code) {
    case 'NOT_FOUND':
      return 'No results for that. Try a different search or paste a link.';
    case 'UNAVAILABLE':
      return 'That track is unavailable. Skipping it.';
    case 'AGE_RESTRICTED':
      return 'That track is age-restricted and cannot be played here.';
    case 'PRIVATE':
      return 'That track is private.';
    case 'RATE_LIMITED': {
      const seconds = Math.ceil((error.options.retryAfterMs ?? 5_000) / 1000);
      return `The source is rate-limiting us. Try again in ${seconds}s.`;
    }
    case 'TIMEOUT':
      return 'The source took too long to answer. Please try again.';
    case 'BLOCKED_SOURCE':
      return 'That source is not on the allowlist for this server.';
    case 'INVALID_INPUT':
      return 'That does not look like a valid link or search. Check the format.';
    case 'PROVIDER_ERROR':
    default:
      return 'The music source returned an error. Please try again.';
  }
}
