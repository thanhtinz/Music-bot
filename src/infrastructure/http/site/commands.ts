import { catalogByCategory, COMMAND_CATALOG, type CommandMeta } from '../../../commands/catalog';
import { usage } from '../../../application/commands';
import { escapeHtml } from '../dashboard';

import { page, type LayoutOptions } from './layout';

/** Human names for the catalog's category keys, as the help card uses. */
const CATEGORY_TITLES: Record<string, string> = {
  playback: 'Player',
  queue: 'Queue',
  playlist: 'Playlist',
  filters: 'Filters',
  settings: 'Settings',
  general: 'General',
};

const CATEGORY_BLURBS: Record<string, string> = {
  playback: 'Getting music playing, and moving around inside a track.',
  queue: 'What is coming up, and editing it.',
  playlist: 'Saving things to come back to.',
  filters: 'Changing how it sounds.',
  settings: 'Per-server configuration. Needs Manage Server.',
  general: 'Everything else.',
};

/** Who may run a command, when it is not simply everybody. */
const TIER_LABELS: Record<string, string> = {
  dj: 'DJ',
  moderator: 'Manage Server',
  owner: 'Bot owner',
};

export interface CommandsPageOptions extends LayoutOptions {
  /** The prefix shown in the examples; a guild can set its own. */
  prefix: string;
}

/**
 * Every command, from the catalog that defines them.
 *
 * Generated rather than written, for the same reason the help card is: a
 * hand-kept list on a website is a list that quietly stops matching the bot,
 * and the reader has no way to tell which of the two is lying.
 */
export function renderCommands(options: CommandsPageOptions): string {
  const grouped = [...catalogByCategory()];

  const body = `
  <section class="head">
    <h1>Commands</h1>
    <p class="lede">
      ${COMMAND_CATALOG.length} of them. Every one works three ways —
      <code>/play</code> as a slash command, <code>${escapeHtml(options.prefix)}play</code> typed,
      or <code>@${escapeHtml(options.botName)} play</code> — and they all reach the same code,
      so none of the three can drift from the others.
    </p>
    <div class="jump">
      ${grouped
        .map(
          ([category, list]) =>
            `<a href="#${category}">${escapeHtml(CATEGORY_TITLES[category] ?? category)} <span class="pill grey">${list.length}</span></a>`,
        )
        .join('')}
    </div>
  </section>

  ${grouped.map(([category, list]) => group(category, list, options)).join('')}

  <section class="panel note">
    <h3>Arguments</h3>
    <p class="muted">
      <code>&lt;required&gt;</code> has to be given; <code>[optional]</code> does not.
      A file is attached to the message rather than typed, so it never appears in a usage line.
    </p>
  </section>

  <style>
    .head { margin-bottom: 30px; }
    .jump { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .jump a {
      display: inline-flex; align-items: center; gap: 7px;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 999px; padding: 6px 14px; font-size: 14px;
      text-decoration: none; color: var(--ink); font-weight: 600;
    }
    .jump a:hover { background: var(--pink-soft); }
    .cmd-name { font-weight: 700; white-space: nowrap; }
    .cmd-args { color: var(--pink); font-weight: 600; }
    .aliases { color: var(--muted); font-size: 13px; }
    .muted { color: var(--muted); margin: 0; font-size: 14.5px; }
    .note { margin-top: 6px; }
    td.tier { white-space: nowrap; }
    h2 .pill { vertical-align: middle; margin-left: 8px; }
  </style>`;

  return page({
    ...options,
    key: 'commands',
    title: `Commands — ${options.botName}`,
    description: `All ${COMMAND_CATALOG.length} commands, as slash commands, typed commands or mentions.`,
    body,
  });
}

function group(category: string, list: CommandMeta[], options: CommandsPageOptions): string {
  return `<section id="${category}">
    <h2>${escapeHtml(CATEGORY_TITLES[category] ?? category)} <span class="pill grey">${list.length}</span></h2>
    <p class="lede">${escapeHtml(CATEGORY_BLURBS[category] ?? '')}</p>
    <div class="wrap">
      <table>
        <tr><th>Command</th><th>What it does</th><th>Who</th></tr>
        ${list.map((meta) => row(meta, options)).join('')}
      </table>
    </div>
  </section>`;
}

function row(meta: CommandMeta, options: CommandsPageOptions): string {
  // Built by the same function the router and the help card use, so the page
  // cannot invent a shape the bot would not accept.
  const line = usage({ ...meta, execute: async () => undefined }, options.prefix);
  const [, ...args] = line.split(' ');

  return `<tr>
    <td>
      <div class="cmd-name">
        <code>${escapeHtml(options.prefix + meta.name)}</code>
        ${args.length > 0 ? `<span class="cmd-args">${escapeHtml(args.join(' '))}</span>` : ''}
      </div>
      ${
        meta.aliases && meta.aliases.length > 0
          ? `<div class="aliases">also ${meta.aliases.map((alias) => escapeHtml(options.prefix + alias)).join(', ')}</div>`
          : ''
      }
    </td>
    <td>${escapeHtml(meta.description)}</td>
    <td class="tier">${
      meta.tier && TIER_LABELS[meta.tier]
        ? `<span class="pill">${escapeHtml(TIER_LABELS[meta.tier]!)}</span>`
        : '<span class="idle">everyone</span>'
    }</td>
  </tr>`;
}
