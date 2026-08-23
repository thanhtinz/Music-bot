import { createServer, type Server, type ServerResponse } from 'node:http';

import { createLogger } from '../../telemetry/logger';
import type { MetricsRegistry } from '../../telemetry/metrics';

const logger = createLogger('health-server');

export interface HealthReport {
  /** The process is alive and not wedged. */
  alive: boolean;
  /** It can actually do its job: gateway up, audio node reachable. */
  ready: boolean;
  /** Shown in the body, so a failing check says which one. */
  details: Record<string, boolean | number | string>;
}

export interface HealthServerOptions {
  port: number;
  /** Bind address; the default keeps it off the public internet. */
  host?: string;
  registry: MetricsRegistry;
  /** Read fresh on each request, so the answer is never a cached lie. */
  report: () => HealthReport;
  /** Called just before metrics are rendered, to refresh the gauges. */
  collect?: () => void;
}

/**
 * Liveness, readiness and metrics over plain HTTP.
 *
 * Separate endpoints because they answer different questions: an orchestrator
 * restarting a container on a failed liveness check must not do so merely
 * because Lavalink is down, which readiness is what reports.
 */
export function createHealthServer(options: HealthServerOptions): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  server: Server;
} {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    try {
      switch (path) {
        case '/healthz': {
          const report = options.report();
          send(response, report.alive ? 200 : 503, 'application/json', {
            status: report.alive ? 'ok' : 'unhealthy',
          });
          return;
        }

        case '/readyz': {
          const report = options.report();
          send(response, report.ready ? 200 : 503, 'application/json', {
            status: report.ready ? 'ready' : 'not-ready',
            ...report.details,
          });
          return;
        }

        case '/metrics': {
          options.collect?.();
          response
            .writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
            .end(options.registry.render());
          return;
        }

        default:
          send(response, 404, 'application/json', { error: 'not found' });
      }
    } catch (error) {
      // A metrics endpoint that throws must not be what takes the bot down.
      logger.error({ err: error, path }, 'health request failed');
      send(response, 500, 'application/json', { error: 'internal error' });
    }
  });

  return {
    server,

    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host ?? '127.0.0.1', () => {
          server.removeListener('error', reject);
          logger.info({ port: options.port }, 'health endpoint listening');
          resolve();
        });
      }),

    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function send(response: ServerResponse, status: number, contentType: string, body: unknown): void {
  response.writeHead(status, { 'content-type': contentType }).end(JSON.stringify(body));
}
