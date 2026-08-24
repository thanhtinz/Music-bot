import { describe, expect, it } from 'vitest';

import type { DashboardStatus } from '../../src/infrastructure/http/dashboard';
import {
  DECLINED_PERMISSIONS,
  inviteUrl,
  permissionBits,
  REQUIRED_PERMISSIONS,
} from '../../src/infrastructure/http/invite';
import { toPublicStatus, type ShardVitals } from '../../src/infrastructure/http/public-status';
import {
  commandSummary,
  formatBytes,
  renderCommands,
  renderHome,
  renderStatus,
} from '../../src/infrastructure/http/site';
import { COMMAND_CATALOG } from '../../src/commands/catalog';

/** One shard's internal status, private fields and all. */
function shardStatus(
  shardId: number,
  overrides: Partial<DashboardStatus & ShardVitals> = {},
): DashboardStatus & ShardVitals {
  return {
    shardId,
    cachedUsers: 44_011,
    memoryBytes: 446 * 1024 * 1024,
    updatedAt: 1_700_000_000_000,
    botName: 'Melody',
    ready: true,
    uptimeMs: 3_600_000,
    guilds: 40,
    gatewayLatencyMs: 61.4,
    players: [
      {
        guildId: '1',
        guildName: 'Bí Mật Của Chúng Tôi',
        channelName: 'phòng-nhạc',
        status: 'playing',
        title: 'Chăm Hoa',
        author: 'MONO',
        positionMs: 84_000,
        durationMs: 245_000,
        queueLength: 11,
        listeners: 6,
      },
    ],
    nodes: [{ name: 'main', connected: true, players: 1, cpu: 0.2, memory: 0.4 }],
    ...overrides,
  };
}

describe('the invite link', () => {
  it('carries the commands scope, or the slash commands appear for nobody', () => {
    const url = new URL(inviteUrl({ clientId: '123' }));

    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });

  it('asks for what it uses, and the bits add up to what it says', () => {
    const bits = permissionBits();

    for (const bit of Object.values(REQUIRED_PERMISSIONS)) {
      expect(bits & bit).toBe(bit);
    }
    expect(new URL(inviteUrl({ clientId: '123' })).searchParams.get('permissions')).toBe(
      String(bits),
    );
  });

  it('never asks for Administrator', () => {
    // A bot that asks for it should be refused, so this one must not.
    const administrator = 1n << 3n;

    expect(permissionBits() & administrator).toBe(0n);
    expect(DECLINED_PERMISSIONS.map((entry) => entry.name)).toContain('Administrator');
  });

  it('lets an operator narrow it', () => {
    const url = new URL(inviteUrl({ clientId: '123', permissions: 3072n }));

    expect(url.searchParams.get('permissions')).toBe('3072');
  });
});

describe('what the public status is allowed to say', () => {
  const shards = [shardStatus(0), shardStatus(1, { guilds: 26, ready: false })];

  it('adds the shards up', () => {
    const status = toPublicStatus(shards);

    expect(status.guilds).toBe(66);
    expect(status.players).toBe(2);
    expect(status.shards.map((shard) => shard.id)).toEqual([0, 1]);
    expect(status.shards[1]?.ready).toBe(false);
  });

  it('is online while any shard is', () => {
    expect(toPublicStatus(shards).online).toBe(true);
    expect(toPublicStatus([shardStatus(0, { ready: false })]).online).toBe(false);
  });

  it('merges a node that several shards can see', () => {
    const status = toPublicStatus(shards);

    expect(status.nodes).toHaveLength(1);
    expect(status.nodes[0]).toEqual({ name: 'main', connected: true, players: 2 });
  });

  it('counts a node as up when any shard can reach it', () => {
    const status = toPublicStatus([
      shardStatus(0, { nodes: [{ name: 'main', connected: false, players: 0 }] }),
      shardStatus(1, { nodes: [{ name: 'main', connected: true, players: 3 }] }),
    ]);

    expect(status.nodes[0]?.connected).toBe(true);
  });

  it('publishes no guild name, channel name or track title', () => {
    // The security boundary of the whole site. The internal dashboard lists all
    // three; this is a live record of what identifiable communities listen to,
    // and none of it belongs on the internet.
    const published = JSON.stringify(toPublicStatus(shards));

    expect(published).not.toContain('Bí Mật Của Chúng Tôi');
    expect(published).not.toContain('phòng-nhạc');
    expect(published).not.toContain('Chăm Hoa');
    expect(published).not.toContain('MONO');
    expect(published).not.toContain('listeners');
  });

  it('fills in a shard that answered nothing at all', () => {
    // A dead shard does not reply to the broadcast, so it is absent rather
    // than present and unhealthy — and a page counting only what replied would
    // say "1/1 up" while half the servers had no bot in them.
    const status = toPublicStatus([shardStatus(0)], { expectedShards: 3 });

    expect(status.shards.map((shard) => shard.id)).toEqual([0, 1, 2]);
    expect(status.shards.filter((shard) => shard.ready)).toHaveLength(1);
    expect(status.shards[2]).toEqual({
      id: 2,
      ready: false,
      guilds: 0,
      players: 0,
      latencyMs: 0,
      uptimeMs: 0,
      cachedUsers: 0,
      memoryBytes: 0,
      // Never answered, so there is no moment to claim.
      updatedAt: 0,
    });
  });

  it('never shrinks the list below what actually answered', () => {
    const status = toPublicStatus([shardStatus(0), shardStatus(1)], { expectedShards: 1 });

    expect(status.shards).toHaveLength(2);
  });

  it('carries each shard\u2019s own memory and cache, not shard zero\u2019s', () => {
    // Read inside each process during the broadcast: asking the asker would
    // report shard zero's memory once per shard.
    const status = toPublicStatus([
      shardStatus(0, { memoryBytes: 400 * 1024 * 1024, cachedUsers: 10 }),
      shardStatus(1, { memoryBytes: 460 * 1024 * 1024, cachedUsers: 20 }),
    ]);

    expect(status.shards.map((shard) => shard.memoryBytes)).toEqual([
      400 * 1024 * 1024,
      460 * 1024 * 1024,
    ]);
    expect(status.shards.map((shard) => shard.cachedUsers)).toEqual([10, 20]);
  });

  it('sends when each shard answered, rather than a sentence about it', () => {
    // The snapshot is gathered on a timer and the response is cached, so any
    // sentence rendered server-side is wrong by however long it sat in a cache.
    const html = renderStatus({
      ...LAYOUT,
      status: toPublicStatus([shardStatus(0, { updatedAt: 1_700_000_000_000 })]),
    });

    expect(html).toContain('data-at="1700000000000"');
  });

  it('shows memory the way a person reads it', () => {
    expect(formatBytes(446 * 1024 * 1024)).toBe('446 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    expect(formatBytes(0)).toBe('\u2014');
  });

  it('does not call a partial outage "all systems playing"', () => {
    // The one page that must not overclaim: whoever is reading it is on exactly
    // one shard, and it may be the broken one.
    const partial = renderStatus({
      ...LAYOUT,
      status: toPublicStatus([shardStatus(0), shardStatus(1, { ready: false })]),
    });

    expect(partial).toContain('Partial outage');
    expect(partial).not.toContain('All systems playing');
  });

  it('says all systems only when every shard is up', () => {
    const healthy = renderStatus({
      ...LAYOUT,
      status: toPublicStatus([shardStatus(0), shardStatus(1)]),
    });

    expect(healthy).toContain('All systems playing');
  });

  it('counts one shard as a shard', () => {
    const one = renderStatus({ ...LAYOUT, status: toPublicStatus([shardStatus(0)]) });

    expect(one).toContain('1 shard up');
    expect(one).not.toContain('1 shards up');
  });

  it('is offline when nothing answered', () => {
    const dark = renderStatus({ ...LAYOUT, status: toPublicStatus([]) });

    expect(dark).toContain('Offline');
    expect(dark).not.toContain('Partial outage');
  });

  it('says a silent shard is not reporting, rather than serving nothing', () => {
    const html = renderStatus({
      ...LAYOUT,
      status: toPublicStatus([shardStatus(0)], { expectedShards: 2 }),
    });

    expect(html).toContain('not reporting');
    // Dashes, not zeroes: it is not saying, which is not the same as none.
    expect(html).toContain('1/2');
  });

  it('has an answer when no shard has reported yet', () => {
    const status = toPublicStatus([]);

    expect(status.online).toBe(false);
    expect(status.guilds).toBe(0);
    expect(status.shards).toEqual([]);
  });
});

const LAYOUT = {
  botName: 'Melody',
  inviteUrl: 'https://discord.com/oauth2/authorize?client_id=123',
  sourceUrl: 'https://github.com/thanhtinz/Music-bot',
};

describe('the pages', () => {
  const status = toPublicStatus([shardStatus(0), shardStatus(1)]);
  const html = renderHome({ ...LAYOUT, status });
  const statusHtml = renderStatus({ ...LAYOUT, status });
  const commandsHtml = renderCommands({ ...LAYOUT, prefix: '!' });

  it('leads with the invite', () => {
    expect(html).toContain('https://discord.com/oauth2/authorize?client_id=123');
    expect(html).toContain('Add to Discord');
  });

  it('puts the shards and the cluster on the status page', () => {
    expect(statusHtml).toContain('Shards');
    expect(statusHtml).toContain('Audio cluster');
    expect(statusHtml).toContain('2/2');
  });

  it('gives every page the same header and nav', () => {
    for (const rendered of [html, statusHtml, commandsHtml]) {
      expect(rendered).toContain('href="/commands"');
      expect(rendered).toContain('href="/status"');
      expect(rendered).toContain('Add to Discord');
    }
  });

  it('marks the page you are on in the nav, and only that one', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(statusHtml).toContain('href="/status" class="on" aria-current="page"');
    expect(commandsHtml).toContain('href="/commands" class="on" aria-current="page"');
  });

  it('shows a screenshot of the cards it is describing', () => {
    // The bot's whole point is what its replies look like; a page about it
    // that only describes them is the wrong page.
    expect(html).toContain('/shots/now-playing.png');
    expect(html).toContain('/shots/lyrics.png');
  });

  it('lists every command on the commands page', () => {
    for (const meta of COMMAND_CATALOG) {
      expect(commandsHtml).toContain(`!${meta.name}`);
    }
  });

  it('says who may run a restricted command', () => {
    expect(commandsHtml).toContain('Manage Server');
    expect(commandsHtml).toContain('DJ');
  });

  it('says nothing private, the same as the payload', () => {
    for (const rendered of [html, statusHtml]) {
      expect(rendered).not.toContain('Bí Mật Của Chúng Tôi');
      expect(rendered).not.toContain('phòng-nhạc');
      expect(rendered).not.toContain('Chăm Hoa');
    }
  });

  it('escapes a bot name somebody could have chosen badly', () => {
    const nasty = renderHome({
      ...LAYOUT,
      botName: '<script>alert(1)</script>',
      status: toPublicStatus([shardStatus(0, { botName: '<script>alert(1)</script>' })]),
    });

    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });

  it('counts the commands from the catalog rather than from a sentence', () => {
    // A number typed into marketing copy is a number that goes stale.
    expect(commandSummary()).toContain(`${COMMAND_CATALOG.length} commands`);
    expect(html).toContain(`${COMMAND_CATALOG.length} commands`);
  });

  it('leaves out a footer link the operator did not configure', () => {
    expect(html).toContain('Source');
    expect(html).not.toContain('Support');
  });
});
