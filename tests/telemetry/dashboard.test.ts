import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  formatUptime,
  renderDashboard,
  type DashboardStatus,
} from '../../src/infrastructure/http/dashboard';

function status(overrides: Partial<DashboardStatus> = {}): DashboardStatus {
  return {
    botName: 'Melody',
    ready: true,
    uptimeMs: 3_725_000,
    guilds: 3,
    gatewayLatencyMs: 42,
    players: [
      {
        guildId: 'g1',
        guildName: 'Test Server',
        channelName: 'music-room',
        status: 'playing',
        title: 'Chăm Hoa',
        author: 'MONO',
        positionMs: 84_000,
        durationMs: 211_000,
        queueLength: 4,
        listeners: 3,
      },
    ],
    nodes: [{ name: 'main', connected: true, players: 1, cpu: 0.21, memory: 0.55 }],
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes everything that could break out of the markup', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });
});

describe('formatUptime', () => {
  it('reads as a person would say it', () => {
    expect(formatUptime(45_000)).toBe('0m');
    expect(formatUptime(3_725_000)).toBe('1h 2m');
    expect(formatUptime(90_000_000)).toBe('1d 1h');
  });

  it('does not go negative', () => {
    expect(formatUptime(-500)).toBe('0m');
  });
});

describe('renderDashboard', () => {
  it('renders a page with what is playing', () => {
    const html = renderDashboard(status());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Melody');
    expect(html).toContain('Chăm Hoa');
    expect(html).toContain('MONO');
    expect(html).toContain('music-room');
  });

  it('shows the position against the length', () => {
    expect(renderDashboard(status())).toContain('1:24 / 3:31');
  });

  it('says live rather than 0:00 for a stream', () => {
    const html = renderDashboard(
      status({
        players: [{ ...status().players[0]!, durationMs: 0 }],
      }),
    );

    expect(html).toContain('live');
  });

  it('escapes names written by other people', () => {
    // A server called `<script>` must not become one.
    const html = renderDashboard(
      status({
        players: [{ ...status().players[0]!, guildName: '<script>alert(1)</script>' }],
      }),
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('says so when nothing is playing', () => {
    const html = renderDashboard(status({ players: [] }));

    expect(html).toContain('Nothing playing right now.');
  });

  it('says so when no node is configured', () => {
    expect(renderDashboard(status({ nodes: [] }))).toContain('No nodes configured.');
  });

  it('marks a node that is down', () => {
    const html = renderDashboard(
      status({ nodes: [{ name: 'main', connected: false, players: 0 }] }),
    );

    expect(html).toContain('down');
    expect(html).toContain('0/1');
  });

  it('shows readiness', () => {
    expect(renderDashboard(status({ ready: false }))).toContain('Not ready');
    expect(renderDashboard(status({ ready: true }))).toContain('Ready');
  });

  it('auto-refreshes unless told not to', () => {
    expect(renderDashboard(status())).toContain('http-equiv="refresh"');
    expect(renderDashboard(status({ refreshSeconds: 0 }))).not.toContain('http-equiv="refresh"');
  });

  it('says it is read-only, so nobody looks for controls', () => {
    expect(renderDashboard(status())).toContain('Read-only');
  });

  it('renders a player with no track without printing undefined', () => {
    const html = renderDashboard(
      status({
        players: [
          {
            guildId: 'g1',
            status: 'ready',
            positionMs: 0,
            durationMs: 0,
            queueLength: 0,
          },
        ],
      }),
    );

    expect(html).not.toContain('undefined');
    expect(html).toContain('g1');
  });
});
