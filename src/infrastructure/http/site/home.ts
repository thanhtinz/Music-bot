import { COMMAND_CATALOG, type CommandMeta } from '../../../commands/catalog';
import { escapeHtml, formatUptime } from '../dashboard';
import { DECLINED_PERMISSIONS } from '../invite';
import type { PublicStatus } from '../public-status';

import { page, type LayoutOptions } from './layout';
import { SHOT } from './shots';

/**
 * A capability worth a section of its own, and the picture that proves it.
 *
 * Every `shot` is a card this bot really rendered — the same PNGs the README
 * shows, served from the repo. A marketing page for a bot whose whole point is
 * what its replies look like should show the replies, not describe them.
 */
interface Feature {
  title: string;
  body: string;
  shot: keyof typeof SHOT;
  alt: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'Every reply is a picture',
    body: 'Now Playing is a rendered card, not a text embed: cover art, a source badge, timestamps, and a progress bar that keeps moving while the song plays.',
    shot: 'nowPlaying',
    alt: 'A Now Playing card with cover art and a progress bar',
  },
  {
    title: 'A queue you can read',
    body: 'The current track keeps the highlighted row and the rest page beneath it, with real positions — the same numbers `remove` and `jump` take.',
    shot: 'queue',
    alt: 'A queue card listing the current track and what is coming up',
  },
  {
    title: 'Lyrics that follow along',
    body: 'Where a timed transcript exists the card opens on the page the song has reached and lights up the line being sung. Verse breaks are skipped, so the highlight never lands on a blank row.',
    shot: 'lyrics',
    alt: 'A lyrics card with the line currently being sung highlighted',
  },
  {
    title: 'Playlists and favourites',
    body: 'Keep a playlist, save the whole queue after a good evening, or press the heart on the panel. Public or private, per person, per server.',
    shot: 'playlists',
    alt: 'A playlist library card',
  },
  {
    title: 'Drop in a file and it plays',
    body: 'Attach an audio file to the command and it plays like any other track — with a real length, a position and a progress bar, because a file is not a stream.',
    shot: 'upload',
    alt: 'A card confirming an uploaded file was added to the queue',
  },
  {
    title: 'The command list is a card too',
    body: 'Drawn from the same catalog the commands are built from, so the help can never list a command that does not exist — or miss one that does.',
    shot: 'help',
    alt: 'A help card listing commands by category',
  },
];

export interface HomeOptions extends LayoutOptions {
  status: PublicStatus;
}

export function renderHome(options: HomeOptions): string {
  const { status } = options;
  const name = escapeHtml(options.botName);

  const body = `
  <section class="hero">
    <div class="live">
      <span class="dot${status.online ? ' on' : ''}"></span>
      ${
        status.online
          ? `Online · up ${escapeHtml(formatUptime(status.uptimeMs))} · ${status.guilds.toLocaleString('en')} servers`
          : 'Offline'
      }
    </div>
    <h1>Music in Discord,<br>drawn rather than typed</h1>
    <p class="hero-sub">${name} answers with rendered cards instead of text embeds — cover art, a progress bar that moves, lyrics that follow the song, and a queue you can actually read.</p>
    <div class="hero-cta">
      <a class="btn" href="${escapeHtml(options.inviteUrl)}" rel="noopener">Add to Discord</a>
      <a class="btn btn-ghost" href="/commands">Browse commands</a>
    </div>
    <p class="hero-note">${escapeHtml(commandSummary())}</p>
  </section>

  <section class="shot-hero">
    <img src="${SHOT.nowPlaying}" alt="A Now Playing card" loading="eager" width="1000" height="420">
  </section>

  <section>
    <h2>What it does</h2>
    <p class="lede">Every picture below is a card the bot really rendered.</p>
    ${FEATURES.map(featureRow).join('')}
  </section>

  <section>
    <h2>Built to stay up</h2>
    <p class="lede">Not a weekend project pretending otherwise.</p>
    <div class="grid">
      ${[
        [
          'Sharded',
          'Runs across several processes as it grows, each holding a slice of the servers. <a href="/status">Live status</a>.',
        ],
        [
          'A cluster of audio nodes',
          'If a node goes away its guilds move to another and the track carries on from the position it had reached.',
        ],
        [
          'Survives a restart',
          'The queue, the position and the pause are written down, so a deploy mid-set costs seconds rather than the evening.',
        ],
        [
          'Asks for little',
          'Eight permissions, each one used. No Administrator, no Manage Messages, no Mention Everyone.',
        ],
      ]
        .map(
          ([title, text]) => `<div class="panel">
        <h3>${escapeHtml(title!)}</h3>
        <p class="muted">${text}</p>
      </div>`,
        )
        .join('')}
    </div>
  </section>

  <section>
    <h2>What it asks for</h2>
    <p class="lede">The invite requests only what it uses. It deliberately does not ask for:</p>
    <div class="wrap">
      <table>
        <tr><th>Not requested</th><th>Why not</th></tr>
        ${DECLINED_PERMISSIONS.map(
          (declined) =>
            `<tr><td><strong>${escapeHtml(declined.name)}</strong></td><td>${escapeHtml(declined.why)}</td></tr>`,
        ).join('')}
      </table>
    </div>
  </section>

  <section class="closing panel">
    <h2>Add ${name} to your server</h2>
    <p class="lede">Free, and it takes about ten seconds.</p>
    <a class="btn" href="${escapeHtml(options.inviteUrl)}" rel="noopener">Add to Discord</a>
  </section>

  <style>
    .hero { text-align: center; padding: 26px 0 8px; margin-bottom: 22px; }
    .hero h1 { line-height: 1.15; }
    .hero-sub { color: var(--muted); font-size: 18px; max-width: 36em; margin: 0 auto 26px; }
    .hero-cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .hero-note { color: var(--muted); font-size: 13.5px; margin-top: 14px; }
    .live {
      display: inline-flex; align-items: center; gap: 8px; margin-bottom: 22px;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 999px; padding: 6px 15px; font-size: 14px; color: var(--muted);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); }
    .dot.on { background: var(--good); }
    .shot-hero { margin-bottom: 56px; }
    .shot-hero img {
      width: 100%; height: auto; border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    .feature {
      display: grid; gap: 26px; align-items: center; margin-bottom: 34px;
      grid-template-columns: 1fr 1.15fr;
    }
    /* Alternating sides. The columns swap with the order, or the picture would
       land in the narrower one every other row and the page would look like it
       had lost its rhythm. */
    .feature:nth-child(even) { grid-template-columns: 1.15fr 1fr; }
    .feature:nth-child(even) .feature-text { order: 2; }
    .feature img {
      width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--border);
      display: block;
    }
    .feature p { color: var(--muted); margin: 0; font-size: 15.5px; }
    .muted { color: var(--muted); margin: 0; font-size: 14.5px; }
    .closing { text-align: center; padding: 34px 20px; }
    .closing h2 { margin-bottom: 4px; }
    @media (max-width: 760px) {
      .feature { grid-template-columns: 1fr; gap: 14px; }
      .feature:nth-child(even) .feature-text { order: 0; }
    }
  </style>`;

  return page({
    ...options,
    key: 'home',
    title: `${options.botName} — a Discord music bot that draws its replies`,
    description: `${options.botName} plays music in Discord and answers with rendered cards instead of text embeds.`,
    body,
  });
}

function featureRow(feature: Feature): string {
  return `<div class="feature">
    <div class="feature-text">
      <h3>${escapeHtml(feature.title)}</h3>
      <p>${feature.body}</p>
    </div>
    <img src="${SHOT[feature.shot]}" alt="${escapeHtml(feature.alt)}" loading="lazy">
  </div>`;
}

/** `38 commands across 6 groups`, counted rather than typed. */
export function commandSummary(catalog: readonly CommandMeta[] = COMMAND_CATALOG): string {
  const groups = new Set(catalog.map((meta) => meta.category)).size;
  return `${catalog.length} commands across ${groups} groups · slash, prefix or @mention`;
}
