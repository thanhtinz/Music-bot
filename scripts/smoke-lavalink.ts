import { Connectors, Shoukaku, type NodeOption } from 'shoukaku';

import { LavalinkBackend } from '../src/infrastructure/lavalink/lavalink-backend';
import { FileResolver, RadioResolver, ResolverRegistry, LavaSrcResolver } from '../src/resolvers';
import { renderNowPlayingCard, cardFile, configureCardEncoding } from '../src/ui/canvas';
import { createTrack } from '../src/domain/music';

/**
 * Talks to a real Lavalink node.
 *
 * Every other check in this repo runs against a fake backend, which is right
 * for a unit test and proves nothing about the wire: a wrong field name, a load
 * type nobody handles and a URL the node refuses all look fine to a double and
 * fail on the first real play. This one asks an actual node to load actual
 * audio and draws the card from what comes back.
 *
 * It needs a node and a URL it can reach:
 *
 *   LAVALINK_HOST=127.0.0.1 LAVALINK_PORT=2333 \
 *   SMOKE_AUDIO_URL=http://127.0.0.1:8099/song.wav npm run smoke:lavalink
 *
 * It plays nothing into a voice channel — that needs Discord, a token and
 * somebody in a channel. What it covers is everything up to that point.
 */

const HOST = process.env.LAVALINK_HOST ?? '127.0.0.1';
const PORT = Number(process.env.LAVALINK_PORT ?? 2333);
const PASSWORD = process.env.LAVALINK_PASSWORD ?? 'youshallnotpass';
const AUDIO_URL = process.env.SMOKE_AUDIO_URL ?? '';
/** Lavalink wants a snowflake in the handshake; any well-formed one will do. */
const SMOKE_USER_ID = '100000000000000000';

/**
 * Enough of a Discord client for Shoukaku to open its websocket.
 *
 * Shoukaku wants a gateway so it can forward voice state; the REST side it uses
 * to load tracks wants only a user id. Nothing here is stubbed *below* this
 * point — the node, the connection, `LavalinkBackend` and the resolvers are all
 * the real ones.
 */
class HeadlessConnector extends Connectors.DiscordJS {
  constructor() {
    super({ ws: { on: () => undefined }, user: { id: SMOKE_USER_ID } });
  }

  override getId(): string {
    return SMOKE_USER_ID;
  }

  override sendPacket(): void {
    // No voice connection is opened, so nothing is ever sent.
  }

  override listen(nodes: NodeOption[]): void {
    // Normally waits for the gateway to say it is ready; there is no gateway.
    this.ready(nodes);
  }
}

function ok(label: string, detail: string): void {
  console.log(`  ok    ${label} — ${detail}`);
}

function bad(label: string, detail: string): never {
  console.error(`  FAIL  ${label} — ${detail}`);
  process.exitCode = 1;
  throw new Error(`${label}: ${detail}`);
}

async function main(): Promise<void> {
  configureCardEncoding({ format: 'png' });

  const shoukaku = new Shoukaku(
    new HeadlessConnector(),
    [{ name: 'smoke', url: `${HOST}:${PORT}`, auth: PASSWORD }],
    { resume: false, reconnectTries: 1 },
  );

  shoukaku.on('error', (name, error) => console.error(`  node ${name}:`, error.message));

  const ready = new Promise<void>((resolve, reject) => {
    shoukaku.on('ready', () => resolve());
    setTimeout(() => reject(new Error(`no node at ${HOST}:${PORT} after 15s`)), 15_000);
  });

  console.log(`\nLavalink smoke test against ${HOST}:${PORT}\n`);
  await ready;
  ok('node', `connected to ${HOST}:${PORT}`);

  const backend = new LavalinkBackend(shoukaku, { shardIdFor: () => 0 });

  // The upload allowlist is host-based; this run serves its own file, so the
  // host it is served from is what it is told to allow.
  const audioHost = AUDIO_URL ? new URL(AUDIO_URL).hostname : '127.0.0.1';
  const resolvers = new ResolverRegistry();
  resolvers.registerAll([
    new FileResolver(backend, { allowedHosts: [audioHost] }),
    new RadioResolver(),
    new LavaSrcResolver(backend),
  ]);

  if (AUDIO_URL) {
    const result = await resolvers.resolve(AUDIO_URL);
    if (result.kind !== 'track') bad('load a file', `expected a track, got ${result.kind}`);

    const candidate = result.track;
    if (!candidate.durationMs) {
      bad('load a file', 'the node reported no duration, so nothing was really read');
    }
    if (candidate.isStream) bad('load a file', 'an uploaded file came back marked as a stream');

    ok('load a file', `"${candidate.title}" · ${Math.round(candidate.durationMs / 1000)}s`);

    // Drawn from what the node actually returned, not from a fixture: the card
    // is the last link in the chain and the one nobody can unit-test into
    // correctness.
    const track = createTrack({ ...candidate, requesterId: 'smoke' });
    const card = await renderNowPlayingCard({
      title: track.title,
      author: track.author,
      ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}),
      durationMs: track.durationMs,
      positionMs: Math.floor(track.durationMs / 3),
      isStream: track.isStream,
      requesterName: 'smoke test',
      volume: 70,
      loop: 'off',
      queueLength: 0,
      source: track.source,
      variant: 'sakura',
    });

    const { writeFileSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const out = resolvePath(__dirname, '../preview/smoke-now-playing.png');
    writeFileSync(out, card);
    ok('draw the card', `${cardFile('now-playing')} · ${(card.byteLength / 1024).toFixed(1)} KB`);
  } else {
    console.log('  skip  load a file — set SMOKE_AUDIO_URL to a reachable audio file');
  }

  // A node with no LavaSrc plugin must say the service is off rather than
  // "no results": the difference matters to whoever has to fix it.
  try {
    await resolvers.resolve('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    console.log('  note  Spotify resolved — this node has LavaSrc configured');
  } catch (error) {
    ok('spotify without the plugin', (error as Error).message);
  }

  await shoukaku.connections.forEach(() => undefined);
  console.log('\nall checks passed\n');
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error('\nsmoke test failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
