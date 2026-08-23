import { describe, expect, it, vi } from 'vitest';

import { CircuitBreaker, ResolverError, retry, withTimeout } from '../../src/resolvers';

function breaker(now: () => number) {
  return new CircuitBreaker('test', {
    failureThreshold: 3,
    openMs: 1_000,
    successThreshold: 2,
    now,
  });
}

describe('CircuitBreaker', () => {
  it('starts closed and stays closed while calls succeed', async () => {
    const cb = breaker(() => 0);

    await expect(cb.run(async () => 'ok')).resolves.toBe('ok');
    expect(cb.status).toBe('closed');
  });

  it('opens after enough provider faults', async () => {
    const cb = breaker(() => 0);
    const boom = () => Promise.reject(new ResolverError('PROVIDER_ERROR', 'down'));

    for (let i = 0; i < 3; i += 1) await expect(cb.run(boom)).rejects.toThrow();

    expect(cb.status).toBe('open');
    expect(cb.allowsRequest).toBe(false);
    await expect(cb.run(async () => 'ok')).rejects.toThrow(/temporarily unavailable/);
  });

  it('does not open on failures that are the input’s fault', async () => {
    // A track that does not exist says nothing about the provider's health.
    const cb = breaker(() => 0);
    const missing = () => Promise.reject(new ResolverError('NOT_FOUND', 'nope'));

    for (let i = 0; i < 6; i += 1) await expect(cb.run(missing)).rejects.toThrow();

    expect(cb.status).toBe('closed');
  });

  it('half-opens after the window and closes on repeated success', async () => {
    let now = 0;
    const cb = breaker(() => now);
    const boom = () => Promise.reject(new ResolverError('TIMEOUT', 'slow'));

    for (let i = 0; i < 3; i += 1) await expect(cb.run(boom)).rejects.toThrow();
    expect(cb.status).toBe('open');

    now = 1_000;
    expect(cb.status).toBe('half-open');

    await cb.run(async () => 'ok');
    expect(cb.status).toBe('half-open');
    await cb.run(async () => 'ok');
    expect(cb.status).toBe('closed');
  });

  it('re-opens immediately when the probe fails', async () => {
    let now = 0;
    const cb = breaker(() => now);
    const boom = () => Promise.reject(new ResolverError('TIMEOUT', 'slow'));

    for (let i = 0; i < 3; i += 1) await expect(cb.run(boom)).rejects.toThrow();
    now = 1_000;
    expect(cb.status).toBe('half-open');

    await expect(cb.run(boom)).rejects.toThrow();
    expect(cb.status).toBe('open');
  });

  it('counts non-resolver errors as provider faults', async () => {
    const cb = breaker(() => 0);
    const boom = () => Promise.reject(new Error('socket hang up'));

    for (let i = 0; i < 3; i += 1) await expect(cb.run(boom)).rejects.toThrow();
    expect(cb.status).toBe('open');
  });

  it('resets on demand', async () => {
    const cb = breaker(() => 0);
    for (let i = 0; i < 3; i += 1) {
      await expect(cb.run(() => Promise.reject(new Error('x')))).rejects.toThrow();
    }

    cb.reset();
    expect(cb.status).toBe('closed');
  });
});

describe('withTimeout', () => {
  it('passes a result straight through', async () => {
    await expect(withTimeout(async () => 'ok', 1_000, 'test')).resolves.toBe('ok');
  });

  it('classifies an overrun as a timeout', async () => {
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(withTimeout(slow, 10, 'youtube')).rejects.toMatchObject({
      code: 'TIMEOUT',
      name: 'ResolverError',
    });
  });

  it('leaves an unrelated failure classified as it was', async () => {
    const failing = async () => {
      throw new ResolverError('NOT_FOUND', 'nope');
    };

    await expect(withTimeout(failing, 1_000, 'test')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('retry', () => {
  const noSleep = async () => undefined;

  it('returns the first success without retrying', async () => {
    const work = vi.fn(async () => 'ok');
    await expect(retry(work, { sleep: noSleep })).resolves.toBe('ok');
    expect(work).toHaveBeenCalledOnce();
  });

  it('retries a retryable failure and succeeds', async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
      if (calls === 1) throw new ResolverError('TIMEOUT', 'slow');
      return 'ok';
    };

    await expect(retry(work, { sleep: noSleep })).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up immediately on a failure retrying cannot fix', async () => {
    const work = vi.fn(async () => {
      throw new ResolverError('PRIVATE', 'private video');
    });

    await expect(retry(work, { attempts: 5, sleep: noSleep })).rejects.toMatchObject({
      code: 'PRIVATE',
    });
    expect(work).toHaveBeenCalledOnce();
  });

  it('stops at the attempt limit and rethrows the last error', async () => {
    const work = vi.fn(async () => {
      throw new ResolverError('TIMEOUT', 'slow');
    });

    await expect(retry(work, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('backs off further on each attempt', async () => {
    const delays: number[] = [];
    const work = async () => {
      throw new ResolverError('TIMEOUT', 'slow');
    };

    await expect(
      retry(work, {
        attempts: 3,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200]);
  });
});
