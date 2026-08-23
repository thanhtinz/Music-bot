/**
 * A read-only status page.
 *
 * Read-only on purpose: controls would need authentication, and an
 * unauthenticated page that can stop playback in every guild is worse than no
 * page at all. This says what the bot is doing; the commands remain the way to
 * change it.
 */
export interface DashboardPlayer {
  guildId: string;
  guildName?: string;
  channelName?: string;
  status: string;
  title?: string;
  author?: string;
  positionMs: number;
  durationMs: number;
  queueLength: number;
  listeners?: number;
}

export interface DashboardNode {
  name: string;
  connected: boolean;
  players: number;
  cpu?: number;
  memory?: number;
}

export interface DashboardStatus {
  botName: string;
  ready: boolean;
  uptimeMs: number;
  guilds: number;
  gatewayLatencyMs: number;
  players: DashboardPlayer[];
  nodes: DashboardNode[];
  /** Seconds between reloads; 0 leaves the page static. */
  refreshSeconds?: number;
}

/** The whole page, inline — a dashboard that needs a build step is a liability. */
export function renderDashboard(status: DashboardStatus): string {
  const refresh = status.refreshSeconds ?? 10;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${escapeHtml(status.botName)} — status</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fdf3f1; --panel: #fffafa; --border: #f5dde4;
    --ink: #1a1517; --muted: #7d6a70; --pink: #ec5d84; --good: #3f9d6d; --bad: #d2445c;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17141a; --panel: #201b23; --border: #322a35; --ink: #f4eef1; --muted: #a294a0; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px; background: var(--bg); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; font-size: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .stat {
    flex: 1 1 150px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; padding: 14px 16px;
  }
  .stat b { display: block; font-size: 22px; }
  .stat span { color: var(--muted); font-size: 13px; }
  h2 { font-size: 17px; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel);
    border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 13px; }
  tr:last-child td { border-bottom: 0; }
  .empty { color: var(--muted); padding: 14px 0; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px;
    background: color-mix(in srgb, var(--pink) 14%, transparent); color: var(--pink); }
  .up { color: var(--good); } .down { color: var(--bad); }
  footer { color: var(--muted); font-size: 12px; margin-top: 28px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(status.botName)}</h1>
  <p class="sub">
    <span class="${status.ready ? 'up' : 'down'}">${status.ready ? 'Ready' : 'Not ready'}</span>
    · up ${escapeHtml(formatUptime(status.uptimeMs))}
    · gateway ${Math.round(status.gatewayLatencyMs)}ms
  </p>

  <div class="row">
    <div class="stat"><b>${status.guilds}</b><span>guilds</span></div>
    <div class="stat"><b>${status.players.length}</b><span>playing</span></div>
    <div class="stat"><b>${status.nodes.filter((node) => node.connected).length}/${status.nodes.length}</b><span>audio nodes</span></div>
  </div>

  <h2>Players</h2>
  ${status.players.length === 0 ? '<p class="empty">Nothing playing right now.</p>' : playerTable(status.players)}

  <h2>Audio nodes</h2>
  ${status.nodes.length === 0 ? '<p class="empty">No nodes configured.</p>' : nodeTable(status.nodes)}

  <footer>Read-only. Use the bot's commands to change anything.${
    refresh > 0 ? ` Refreshes every ${refresh}s.` : ''
  }</footer>
</main>
</body>
</html>
`;
}

function playerTable(players: DashboardPlayer[]): string {
  const rows = players
    .map(
      (player) => `<tr>
      <td>${escapeHtml(player.guildName ?? player.guildId)}${
        player.channelName ? `<br><span class="sub">#${escapeHtml(player.channelName)}</span>` : ''
      }</td>
      <td>${
        player.title
          ? `${escapeHtml(player.title)}<br><span class="sub">${escapeHtml(player.author ?? '')}</span>`
          : '<span class="sub">—</span>'
      }</td>
      <td>${escapeHtml(formatClock(player.positionMs))} / ${escapeHtml(
        player.durationMs > 0 ? formatClock(player.durationMs) : 'live',
      )}</td>
      <td>${player.queueLength}</td>
      <td>${player.listeners ?? '—'}</td>
      <td><span class="pill">${escapeHtml(player.status)}</span></td>
    </tr>`,
    )
    .join('');

  return `<table>
    <tr><th>Guild</th><th>Track</th><th>Position</th><th>Queue</th><th>Listeners</th><th></th></tr>
    ${rows}
  </table>`;
}

function nodeTable(nodes: DashboardNode[]): string {
  const rows = nodes
    .map(
      (node) => `<tr>
      <td>${escapeHtml(node.name)}</td>
      <td class="${node.connected ? 'up' : 'down'}">${node.connected ? 'connected' : 'down'}</td>
      <td>${node.players}</td>
      <td>${node.cpu === undefined ? '—' : `${Math.round(node.cpu * 100)}%`}</td>
      <td>${node.memory === undefined ? '—' : `${Math.round(node.memory * 100)}%`}</td>
    </tr>`,
    )
    .join('');

  return `<table>
    <tr><th>Node</th><th>State</th><th>Players</th><th>CPU</th><th>Memory</th></tr>
    ${rows}
  </table>`;
}

export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Escapes text going into the page.
 *
 * Guild names, channel names and track titles are written by other people; a
 * server called `<script>` must not become one.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
