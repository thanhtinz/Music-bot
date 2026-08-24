import { createServer, type Server, type ServerResponse } from 'node:http';

import { createLogger } from '../../telemetry/logger';

import type { PublicStatus } from './public-status';
import { loadShot, renderCommands, renderHome, renderStatus } from './site';
import type { LayoutOptions } from './site';

const logger = createLogger('public-site');

export interface PublicServerOptions extends LayoutOptions {
  port: number;
  /**
   * Bind address. Unlike the metrics server this one defaults to every
   * interface, because a page nobody outside can reach is not a public site —
   * but it is still spelled out here so it is a choice rather than an accident.
   */
  host?: string;
  /** The prefix shown in the command examples. */
  prefix: string;
  /** Read per request; the caller decides how fresh that is. */
  status: () => PublicStatus;
  /** Seconds between status-page reloads. */
  refreshSeconds?: number;
}

/**
 * The public face of the bot: what it is, what it does, and how to add it.
 *
 * A second server rather than more routes on the health one, and that is the
 * whole point. The health server binds loopback and serves guild names, channel
 * names and what people are listening to; this one is meant to be reachable
 * from the internet. Two audiences, two ports, and no route that can be
 * confused for the other's — the day somebody puts a reverse proxy in front of
 * the wrong port, the difference is what stops it being a leak.
 */
export function createPublicServer(options: PublicServerOptions): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  server: Server;
} {
  const layout: LayoutOptions = {
    botName: options.botName,
    inviteUrl: options.inviteUrl,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.supportUrl ? { supportUrl: options.supportUrl } : {}),
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    const accept = String(request.headers.accept ?? '');

    void handle(path, accept, response, options, layout).catch((error: unknown) => {
      logger.error({ err: error, path }, 'public site request failed');
      if (!response.headersSent) json(response, 500, { error: 'internal error' });
    });
  });

  return {
    server,

    start: () =>
      new Promise<void>((resolve_, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host ?? '0.0.0.0', () => {
          server.removeListener('error', reject);
          logger.info({ port: options.port }, 'public site listening');
          resolve_();
        });
      }),

    stop: () =>
      new Promise<void>((resolve_) => {
        server.close(() => resolve_());
      }),
  };
}

async function handle(
  path: string,
  accept: string,
  response: ServerResponse,
  options: PublicServerOptions,
  layout: LayoutOptions,
): Promise<void> {
  // A screenshot the pages reference. Looked up in a map rather than resolved
  // from the URL, so there is no path to traverse in the first place.
  const shot = await loadShot(path, accept);
  if (shot) {
    response
      .writeHead(200, {
        'content-type': shot.contentType,
        // The cards change only when the bot is redeployed.
        'cache-control': 'public, max-age=86400',
        // The same URL answers PNG or WebP depending on the request.
        vary: 'accept',
      })
      .end(shot.body);
    return;
  }

  switch (path) {
    case '/':
      html(
        response,
        renderHome({ ...layout, status: options.status() }),
        // Nothing here is per-visitor, and a page a minute stale is fine; a
        // page hammered by a link in a big server is not.
        60,
      );
      return;

    case '/commands':
      html(response, renderCommands({ ...layout, prefix: options.prefix }), 300);
      return;

    case '/status':
      html(
        response,
        renderStatus({
          ...layout,
          status: options.status(),
          ...(options.refreshSeconds === undefined
            ? {}
            : { refreshSeconds: options.refreshSeconds }),
        }),
        15,
      );
      return;

    case '/invite':
      // A short link worth putting in a message, and one place to change if the
      // permission set ever does.
      response.writeHead(302, { location: options.inviteUrl }).end();
      return;

    case '/api/status':
      json(response, 200, options.status());
      return;

    default:
      json(response, 404, { error: 'not found' });
  }
}

function html(response: ServerResponse, body: string, maxAge: number): void {
  response
    .writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
    })
    .end(body);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, {
      'content-type': 'application/json',
      // A status page is public data; letting a dashboard elsewhere read it is
      // the point of publishing it as JSON at all.
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=15',
    })
    .end(JSON.stringify(body));
}
