import { escapeHtml, formatUptime } from '../dashboard';
import type { PublicShard, PublicStatus } from '../public-status';

import { page, type LayoutOptions } from './layout';

export interface StatusPageOptions extends LayoutOptions {
  status: PublicStatus;
  /** Seconds between reloads; 0 leaves the page still. */
  refreshSeconds?: number;
}

/**
 * Where the bot is, and whether the part serving *you* is up.
 *
 * A page of its own rather than a strip on the home page: somebody reading this
 * has a problem, and the only question they want answered is whether it is the
 * bot's fault. The shard lookup is the whole point — a bot spread across
 * processes can be down for one server and fine for every other, and "is it
 * just me" is otherwise unanswerable from the outside.
 */
export function renderStatus(options: StatusPageOptions): string {
  const { status } = options;
  const refresh = options.refreshSeconds ?? 30;
  const ready = status.shards.filter((shard) => shard.ready).length;

  const body = `
  <section class="head">
    <h1>Status</h1>
    <p class="lede">
      Counts only — this page never says which servers, which channels, or what anybody
      is listening to.
    </p>
    ${banner(status, ready)}
  </section>

  <section>
    <div class="stats">
      <div class="panel stat"><b>${status.guilds.toLocaleString('en')}</b><span>servers</span></div>
      <div class="panel stat"><b>${status.players.toLocaleString('en')}</b><span>playing now</span></div>
      <div class="panel stat"><b>${ready}/${status.shards.length}</b><span>shards up</span></div>
      <div class="panel stat"><b>${status.nodes.filter((node) => node.connected).length}/${status.nodes.length}</b><span>audio nodes</span></div>
    </div>
  </section>

  <section>
    <h2>Find your shard</h2>
    <p class="lede">
      Paste a server ID and this works out which shard holds it, so you can see whether
      the part of the bot serving you is the part that is down.
    </p>
    <div class="panel finder">
      <input id="guild" inputmode="numeric" autocomplete="off" spellcheck="false"
             placeholder="server ID, e.g. 123456789012345678" aria-label="Server ID">
      <button class="btn btn-small" id="find" type="button">Find</button>
      <p id="answer" class="finder-answer" role="status"></p>
    </div>
  </section>

  <section>
    <h2>Shards</h2>
    <p class="lede">
      The bot runs across several processes; each holds a slice of the servers and
      talks to Discord on its own connection.
    </p>
    ${
      status.shards.length === 0
        ? '<p class="lede">No shard is reporting in.</p>'
        : `<div class="grid shard-grid">${status.shards.map(shardCard).join('')}</div>`
    }
  </section>

  <section>
    <h2>Audio cluster</h2>
    <p class="lede">
      Playback runs on Lavalink nodes. If one goes away, the guilds on it move to
      another and the track carries on from the position it had reached.
    </p>
    ${
      status.nodes.length === 0
        ? '<p class="lede">No nodes configured.</p>'
        : `<div class="wrap"><table>
            <tr><th>Node</th><th>State</th><th>Players</th></tr>
            ${status.nodes
              .map(
                (node) => `<tr>
              <td><strong>${escapeHtml(node.name)}</strong></td>
              <td class="${node.connected ? 'up' : 'down'}">${node.connected ? 'connected' : 'unreachable'}</td>
              <td>${node.players}</td>
            </tr>`,
              )
              .join('')}
          </table></div>`
    }
  </section>

  ${refresh > 0 ? `<p class="refresh-note">This page refreshes every ${refresh} seconds.</p>` : ''}

  <style>
    .head { margin-bottom: 28px; }
    .banner {
      display: flex; align-items: center; gap: 11px; flex-wrap: wrap;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 14px 18px; margin-top: 18px;
    }
    .banner.ok { border-color: color-mix(in srgb, var(--good) 40%, var(--border)); }
    .banner.warn { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
    .banner.bad { border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); }
    .banner-note { color: var(--muted); font-size: 14px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--bad); }
    .dot.on { background: var(--good); }
    .dot.part { background: var(--warn); }
    .shard-grid { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
    .shard { padding: 16px 18px; }
    .shard-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .shard-top b { font-size: 17px; }
    .shard dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;
      font-size: 14px; }
    .shard dt { color: var(--muted); }
    .shard dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .finder { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .finder input {
      flex: 1 1 280px; min-width: 0; font: inherit; font-size: 15px;
      padding: 10px 14px; border-radius: 12px;
      border: 1px solid var(--border); background: var(--bg); color: var(--ink);
    }
    .finder input:focus { outline: 2px solid var(--pink); outline-offset: 1px; }
    .finder-answer { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 14.5px; }
    .finder-answer:empty { display: none; }
    .ago { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; }
    .refresh-note { color: var(--muted); font-size: 13px; text-align: center; }
  </style>`;

  return page({
    ...options,
    key: 'status',
    title: `Status — ${options.botName}`,
    description: `Whether ${options.botName} is up, shard by shard.`,
    body,
    script: finderScript(status.shards.length, refresh),
  });
}

/**
 * The one line at the top, and the only one most visitors read.
 *
 * Three states rather than two. A bot spread across shards can be perfectly
 * fine for most servers and completely absent from the rest, and "online"
 * covering both is the overclaim a status page exists to avoid — the person
 * reading it is on exactly one shard, and it may be the broken one.
 */
function banner(status: PublicStatus, ready: number): string {
  const total = status.shards.length;
  const all = total > 0 && ready === total;
  const uptime = escapeHtml(formatUptime(status.uptimeMs));

  const shards = (count: number): string => `${count} ${count === 1 ? 'shard' : 'shards'}`;

  const [tone, dot, title, note] = all
    ? ['ok', ' on', 'All systems playing', `${shards(total)} up · up ${uptime}`]
    : ready > 0
      ? [
          'warn',
          ' part',
          'Partial outage',
          `${ready} of ${shards(total)} up — servers on the rest cannot reach the bot`,
        ]
      : ['bad', '', 'Offline', 'No shard is reporting in.'];

  return `<div class="banner ${tone}">
      <span class="dot${dot}"></span>
      <strong>${title}</strong>
      <span class="banner-note">${note}</span>
    </div>`;
}

/** `446 MB`, the way a person reads a process's memory. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / 1024 / 1024;

  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

function shardCard(shard: PublicShard): string {
  const silent = !shard.ready && shard.uptimeMs === 0 && shard.guilds === 0;
  const state = shard.ready ? 'up' : silent ? 'idle' : 'down';
  const label = shard.ready ? 'ready' : silent ? 'not reporting' : 'down';
  const dash = (value: string): string => (silent ? '—' : value);

  return `<div class="panel shard">
    <div class="shard-top">
      <span class="dot${shard.ready ? ' on' : ''}"></span>
      <b>shard ${shard.id}</b>
      <span class="${state}" style="margin-left:auto;font-size:13px">${label}</span>
    </div>
    <dl>
      <dt>servers</dt><dd>${dash(shard.guilds.toLocaleString('en'))}</dd>
      <dt>playing</dt><dd>${dash(String(shard.players))}</dd>
      <dt>cached users</dt><dd>${dash(shard.cachedUsers.toLocaleString('en'))}</dd>
      <dt>latency</dt><dd>${dash(`${shard.latencyMs} ms`)}</dd>
      <dt>memory</dt><dd>${dash(formatBytes(shard.memoryBytes))}</dd>
      <dt>uptime</dt><dd>${dash(escapeHtml(formatUptime(shard.uptimeMs)))}</dd>
    </dl>
    <p class="ago" data-at="${shard.updatedAt}">${
      shard.updatedAt === 0 ? 'never reported' : 'last updated just now'
    }</p>
  </div>`;
}

/**
 * Works out which shard a server is on, in the visitor's browser.
 *
 * Discord's own rule: `(guild_id >> 22) % shard_count`. It needs 64-bit
 * arithmetic, which is why it is `BigInt` and not a number — a snowflake past
 * 2^53 would otherwise be rounded before the shift and give a confidently wrong
 * answer for exactly the newest servers.
 *
 * Done here rather than on the server because it needs nothing the server has:
 * no lookup, no permission, and no reason to log which server somebody asked
 * about.
 */
function finderScript(shardCount: number, refresh: number): string {
  return `<script>
(function () {
  // How old each shard's numbers are, worked out in the browser.
  //
  // The snapshot is gathered on a timer and the response is cached, so a page
  // that said "updated just now" server-side would be wrong by however long it
  // sat in a cache — and the reader has no way to tell. The timestamp is the
  // honest thing to send; the sentence is built from it here.
  function tick() {
    var now = Date.now();
    document.querySelectorAll('.ago').forEach(function (node) {
      var at = Number(node.getAttribute('data-at'));
      if (!at) { node.textContent = 'never reported'; return; }

      var seconds = Math.max(0, Math.round((now - at) / 1000));
      node.textContent =
        seconds < 5 ? 'last updated just now'
        : seconds < 90 ? 'last updated ' + seconds + ' seconds ago'
        : 'last updated ' + Math.round(seconds / 60) + ' minutes ago';
    });
  }
  tick();
  setInterval(tick, 5000);
})();
</script>
<script>
(function () {
  var count = ${shardCount};
  var input = document.getElementById('guild');
  var answer = document.getElementById('answer');
  var button = document.getElementById('find');
  if (!input || !answer || !button) return;

  function find() {
    var raw = (input.value || '').trim();
    if (!raw) { answer.textContent = ''; return; }
    if (!/^[0-9]{15,20}$/.test(raw)) {
      answer.textContent = 'That does not look like a server ID — they are 17 to 19 digits.';
      return;
    }
    if (count < 1) { answer.textContent = 'No shard is reporting in, so there is nothing to match it to.'; return; }

    var shard = Number((BigInt(raw) >> 22n) % BigInt(count));
    var card = document.querySelectorAll('.shard')[shard];
    var state = card ? card.querySelector('.shard-top span:last-child').textContent : 'unknown';
    answer.textContent = 'That server is on shard ' + shard + ' of ' + count + ' — currently ' + state + '.';
    if (card) card.scrollIntoView({ block: 'center' });
  }

  button.addEventListener('click', find);
  input.addEventListener('keydown', function (event) { if (event.key === 'Enter') find(); });
})();
</script>${
    refresh > 0
      ? `\n<script>setTimeout(function () { location.reload(); }, ${refresh * 1000});</script>`
      : ''
  }`;
}
