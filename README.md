# Music Bot

A production-grade Discord music bot — TypeScript + discord.js + Lavalink 4 — with a **Canvas UI** that renders the Now Playing / Queue panels as images instead of plain text embeds.

> Status: built phase by phase. See the [Roadmap](#roadmap).

## Two card styles

The `sakura` variant composites live player state onto an illustrated pastel template — only the cover, title, artist, source badge, progress, timestamps and the transport glyph are repainted, so the artwork keeps its hand-made look:

| Playing                             | Paused                                     |
| ----------------------------------- | ------------------------------------------ |
| ![](preview/now-playing-sakura.png) | ![](preview/now-playing-sakura-paused.png) |

The queue has a template too. Its five rows are filled from the live queue — cover art, titles, real positions (so page 2 shows 6–10, not the template's baked 2–5), and durations — and any rows the page does not fill are cleared:

![](preview/queue-sakura.png)

The command list too. Its sidebar, highlight, rows and every icon come from the catalog — the icons are drawn, not taken from the artwork, so `/shuffle` never inherits a pause symbol:

![](preview/help-sakura.png)

```ts
await renderNowPlayingCard({ ...playerState, variant: 'sakura' });
await renderQueueCard({ ...queueState, variant: 'sakura' });
await renderSakuraHelpCard({ categories, activeCategory, commands, prefix });
```

Swapping either template means re-measuring the region coordinates in `src/ui/canvas/cards/now-playing-sakura.card.ts` and `queue-sakura.card.ts`; they are pixel measurements of those specific images. Note the two queue variants page differently — the classic list fits 10 rows, the illustrated one 5.

## The classic variant: a canvas-rendered UI

Every panel the user sees is rendered server-side with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) and sent to Discord as a PNG:

- Rounded cover art over an ambient background blurred from that same artwork
- A deterministic waveform per track — the same track always renders the same silhouette
- Gradient progress bar, source badge, and a state bar (requester / volume / loop / queue / filter)
- Three themes: `midnight`, `sunset`, `forest`
- Full Unicode text support, including Vietnamese diacritics

| Playing                              | Paused                              | Radio / live stream                |
| ------------------------------------ | ----------------------------------- | ---------------------------------- |
| ![](preview/now-playing-default.png) | ![](preview/now-playing-paused.png) | ![](preview/now-playing-radio.png) |

The queue is rendered the same way — a paginated list card that grows with the page:

![](preview/queue.png)

Cards render straight from a live `player.snapshot()`, so what you see is real player state:

![](preview/now-playing-live-player.png)

Help is generated straight from the command catalog:

![](preview/help.png)

## Getting started

```bash
npm install
cp .env.example .env      # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm run preview:canvas    # render sample cards into preview/
npm test                  # unit tests
npm run typecheck
```

`npm run preview:canvas` needs no Discord token and no Lavalink node — it exists so the UI can be reviewed while iterating on the design.

## Layout

```
src/
├── application/
│   ├── commands/    # command engine: parser, registry, router, cooldowns
│   └── player/      # per-guild Player and the PlayerManager that serialises it
├── commands/        # command catalog — the matrix all three interfaces share
├── config/          # environment loading and validation (zod)
├── domain/music/    # Track and Queue — no Discord or Lavalink types
├── infrastructure/
│   ├── audio/       # AudioBackend seam — the audio engine behind an interface
│   └── lavalink/    # node pool, load-balancing score, reconnect backoff
├── telemetry/       # JSON logger with secret redaction
└── ui/canvas/       # canvas UI engine
    ├── theme.ts        # color tokens and themes
    ├── fonts.ts        # font registration (bundled → system)
    ├── primitives.ts   # rounded rects, gradients, text truncation/wrapping, durations
    ├── artwork.ts      # artwork loading (host allowlist) + generated placeholder
    └── cards/          # one module per card
scripts/             # dev tooling (canvas preview)
tests/               # unit tests
```

## Customising the look

- **Fonts:** drop a `.ttf`/`.otf` into `assets/fonts/` — no code change needed.
- **Colors:** add a theme in `src/ui/canvas/theme.ts`.
- **Artwork:** only fetched from the host allowlist in `src/ui/canvas/artwork.ts` (SSRF guard). Unknown hosts and failed downloads fall back to a gradient cover generated from the track name.

## Roadmap

| Phase | Scope                                                                    | Status  |
| ----- | ------------------------------------------------------------------------ | ------- |
| F1    | Project skeleton, config, logger, **canvas UI + Now Playing card**       | ✅ done |
| F2    | Domain: track and queue (loop, shuffle, history, snapshots) + queue card | ✅ done |
| F3    | Unified command engine (slash + prefix + @mention) + help card           | ✅ done |
| F4    | Player, player manager, audio-backend seam, node balancing               | ✅ done |
| F5    | Resolvers: YouTube / Spotify metadata / radio                            | ⏳      |
| F6    | Queue / filter / stats cards, DJ permissions, playlists                  | ⏳      |
| F7    | PostgreSQL + Redis, 24/7, autoplay, state recovery                       | ⏳      |
| F8    | Lavalink cluster, failover, metrics, dashboard                           | ⏳      |

## License

MIT © thanhtinz
