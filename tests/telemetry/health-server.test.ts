import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHealthServer, type HealthReport } from '../../src/infrastructure/http/health-server';
import { MetricsRegistry } from '../../src/telemetry/metrics';

describe('health server', () => {
  let registry: MetricsRegistry;
  let report: HealthReport;
  let collected: number;
  let server: ReturnType<typeof createHealthServer>;
  let base: string;

  beforeEach(async () => {
    registry = new MetricsRegistry();
    registry.counter('bot_things_total', 'Things.').increment();
    report = { alive: true, ready: true, details: { gateway: true, nodes: 1 } };
    collected = 0;

    server = createHealthServer({
      // Port 0 lets the OS pick a free one, so the suite cannot collide with
      // whatever else is running.
      port: 0,
      registry,
      report: () => report,
      collect: () => {
        collected += 1;
      },
    });

    await server.start();
    const address = server.server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('reports liveness', async () => {
    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('stays alive even when it is not ready', async () => {
    report = { alive: true, ready: false, details: { gateway: false, nodes: 0 } };

    // An orchestrator must not restart the container just because Lavalink is
    // down; that is what readiness is for.
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
  });

  it('says which check failed', async () => {
    report = { alive: true, ready: false, details: { gateway: true, nodes: 0 } };

    expect(await (await fetch(`${base}/readyz`)).json()).toEqual({
      status: 'not-ready',
      gateway: true,
      nodes: 0,
    });
  });

  it('fails liveness when the process reports itself wedged', async () => {
    report = { alive: false, ready: false, details: {} };

    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it('serves metrics in the Prometheus format', async () => {
    const response = await fetch(`${base}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('bot_things_total 1');
  });

  it('refreshes the gauges before rendering', async () => {
    await fetch(`${base}/metrics`);
    await fetch(`${base}/metrics`);

    // Otherwise a scrape reports whatever was true when the last command ran.
    expect(collected).toBe(2);
  });

  it('404s an unknown path', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('refuses a method it does not serve', async () => {
    const response = await fetch(`${base}/metrics`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers 500 rather than dying when a check throws', async () => {
    const broken = createHealthServer({
      port: 0,
      registry,
      report: () => {
        throw new Error('cannot tell');
      },
    });
    await broken.start();
    const address = broken.server.address() as AddressInfo;

    try {
      // A health endpoint that throws must not be what takes the bot down.
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
      expect(response.status).toBe(500);
    } finally {
      await broken.stop();
    }
  });
});
