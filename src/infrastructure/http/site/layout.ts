import { escapeHtml } from '../dashboard';

/** Which nav item is the page you are on. */
export type PageKey = 'home' | 'commands' | 'status';

export interface LayoutOptions {
  /** Where "Add to Discord" goes. */
  inviteUrl: string;
  sourceUrl?: string;
  supportUrl?: string;
  /** The bot's own name, so the site is not called something it is not. */
  botName: string;
}

export interface PageOptions extends LayoutOptions {
  key: PageKey;
  title: string;
  description: string;
  body: string;
  /** Extra markup before `</body>` — a page's own script, if it needs one. */
  script?: string;
}

const NAV: readonly { key: PageKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'commands', href: '/commands', label: 'Commands' },
  { key: 'status', href: '/status', label: 'Status' },
];

/**
 * The shell every page sits in.
 *
 * One layout rather than three copies of a header: the nav has to agree with
 * itself across pages, and the day a fourth page is added is the day three
 * hand-maintained copies start disagreeing. The CSS lives here for the same
 * reason — one palette, one set of components, no page with its own idea of
 * what a card looks like.
 */
export function page(options: PageOptions): string {
  const name = escapeHtml(options.botName);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeHtml(options.description)}">
<meta property="og:title" content="${escapeHtml(options.title)}">
<meta property="og:description" content="${escapeHtml(options.description)}">
<meta property="og:type" content="website">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="/">
    <span class="brand-mark" aria-hidden="true">♪</span>
    <span>${name}</span>
  </a>
  <nav>
    ${NAV.map(
      (item) =>
        `<a href="${item.href}"${item.key === options.key ? ' class="on" aria-current="page"' : ''}>${item.label}</a>`,
    ).join('')}
  </nav>
  <a class="btn btn-small" href="${escapeHtml(options.inviteUrl)}" rel="noopener">Add to Discord</a>
</header>

<main>
${options.body}
</main>

<footer>
  <div class="foot-links">
    ${[
      `<a href="${escapeHtml(options.inviteUrl)}" rel="noopener">Add to Discord</a>`,
      options.sourceUrl
        ? `<a href="${escapeHtml(options.sourceUrl)}" rel="noopener">Source</a>`
        : '',
      options.supportUrl
        ? `<a href="${escapeHtml(options.supportUrl)}" rel="noopener">Support</a>`
        : '',
    ]
      .filter(Boolean)
      .join('<span class="dotsep">·</span>')}
  </div>
  <p>${name} — a Discord music bot that draws its replies.</p>
</footer>
${options.script ?? ''}
</body>
</html>
`;
}

/**
 * One stylesheet, inline.
 *
 * A site that needs a build step is a site that rots: this one is served by the
 * bot process itself, from a string, with no pipeline that can be out of date
 * when somebody clones the repo.
 */
const CSS = `
:root {
  color-scheme: light dark;
  --bg: #fdf3f1; --panel: #fffafa; --border: #f6dfe6; --ink: #1a1517;
  --muted: #7d6a70; --pink: #ec5d84; --pink-deep: #d63c68; --pink-soft: #fce7ee;
  --good: #3f9d6d; --bad: #d2445c; --warn: #c88a2e;
  --radius: 18px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17141a; --panel: #201b23; --border: #322a35; --ink: #f4eef1;
    --muted: #a294a0; --pink: #f2769a; --pink-deep: #f2769a; --pink-soft: #2c1f28;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--pink); }

.top {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 18px;
  padding: 12px max(20px, calc(50vw - 560px));
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex; align-items: center; gap: 9px;
  font-weight: 800; font-size: 18px; color: var(--ink); text-decoration: none;
}
.brand-mark {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px;
  background: var(--pink-soft); color: var(--pink); font-size: 17px;
}
.top nav { display: flex; gap: 4px; margin-left: auto; }
.top nav a {
  color: var(--muted); text-decoration: none; font-size: 15px; font-weight: 600;
  padding: 7px 13px; border-radius: 999px;
}
.top nav a:hover { color: var(--ink); background: var(--panel); }
.top nav a.on { color: var(--pink); background: var(--pink-soft); }

.btn {
  display: inline-block; background: var(--pink); color: #fff; text-decoration: none;
  font-weight: 700; padding: 13px 28px; border-radius: 999px; font-size: 17px;
  border: 0; cursor: pointer;
}
.btn:hover { background: var(--pink-deep); }
.btn-small { padding: 8px 16px; font-size: 14px; }
.btn-ghost {
  background: var(--panel); color: var(--ink); border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--pink-soft); }

main { max-width: 1120px; margin: 0 auto; padding: 40px 20px 8px; }
h1 { font-size: clamp(32px, 5.4vw, 46px); margin: 0 0 12px; letter-spacing: -0.02em; }
h2 { font-size: 24px; margin: 0 0 8px; letter-spacing: -0.01em; }
h3 { font-size: 17px; margin: 0 0 6px; }
.lede { color: var(--muted); margin: 0 0 22px; font-size: 15.5px; }
section { margin-bottom: 52px; }

.panel {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 18px 20px;
}
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.stats { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.stat b { display: block; font-size: 27px; line-height: 1.2; }
.stat span { color: var(--muted); font-size: 13px; }

table { width: 100%; border-collapse: collapse; background: var(--panel);
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
  font-size: 14.5px; }
th, td { text-align: left; padding: 11px 16px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
tr:last-child td { border-bottom: 0; }
.wrap { overflow-x: auto; }

.up { color: var(--good); } .down { color: var(--bad); } .idle { color: var(--muted); }
.pill {
  display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
  font-weight: 600; background: var(--pink-soft); color: var(--pink);
}
.pill.grey { background: color-mix(in srgb, var(--muted) 15%, transparent); color: var(--muted); }
code, kbd {
  font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--pink-soft); color: var(--pink-deep);
  padding: 1.5px 7px; border-radius: 7px;
}
@media (prefers-color-scheme: dark) { code, kbd { color: var(--pink); } }

footer {
  max-width: 1120px; margin: 0 auto; padding: 28px 20px 48px;
  border-top: 1px solid var(--border); color: var(--muted);
  font-size: 13.5px; text-align: center;
}
footer p { margin: 10px 0 0; }
.foot-links { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.dotsep { color: var(--border); }

@media (max-width: 640px) {
  .top { gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
  .top nav { order: 3; width: 100%; margin-left: 0; justify-content: center; }
  .top nav a { padding: 6px 11px; font-size: 14px; }
  main { padding-top: 28px; }
}
`;
