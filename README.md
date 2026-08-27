# Music Bot

A production-grade Discord music bot — TypeScript + discord.js + Lavalink 4 — with a **Canvas UI** that renders the Now Playing panel as an image; every other reply (queue, history, help, lyrics, playlists, search, stats, settings, and every notice) answers with a real Discord embed instead of plain text.

> Status: built phase by phase. See the [Roadmap](#roadmap).

## Two card styles

> The renderers below (queue, help, playlist, search, stats, settings) still exist and are still tested, but the live bot only ever attaches one of them to a reply — the Now Playing panel. Every other command that used to draw one of these now answers with a [Discord embed](#every-reply-is-an-embed) built from the same data instead.

The `sakura` variant composites live player state onto an illustrated pastel template — only the cover, title, artist, source badge, progress, timestamps and the transport glyph are repainted, so the artwork keeps its hand-made look:

| Playing                             | Paused                                     |
| ----------------------------------- | ------------------------------------------ |
| ![](preview/now-playing-sakura.png) | ![](preview/now-playing-sakura-paused.png) |

### The controls under a Now Playing panel

Four buttons and a dropdown, and nothing else: **previous**, **play/pause**, **skip**, **mute**, and a volume picker.

| Component    | What it does                                                                            |
| ------------ | --------------------------------------------------------------------------------------- |
| ⏮️ / ⏭️      | Steps through history and queue; disabled when there is nothing either way              |
| ⏸️ / ▶️      | Pauses or resumes, and swaps its own glyph                                              |
| 🔊 / 🔇      | Mutes, and brings the volume back to the level it left rather than to a default         |
| `Volume: n%` | Sets one of 10 / 25 / 50 / 75 / 100 / 150 / 200 — finer levels are what `volume` is for |

Everything else — shuffle, loop, autoplay, stop, favourite — stays a command, so the panel keeps one row of controls instead of two rows of buttons nobody presses. Both a mute and a pick redraw the panel: the level lives in the picker's placeholder, so leaving it stale would have the menu claim a volume the player is no longer at.

The queue has a template too. Its five rows are filled from the live queue — cover art, titles, real positions, and durations — and any rows the page does not fill are cleared:

![](preview/queue-sakura.png)

Long queues page through it. The current track keeps the highlighted first row on every page and the other four rows advance, so a button handler re-renders the image for the new page:

```ts
const slice = paginateSakuraQueue(queue.tracks, page); // 4 upcoming per page
await renderQueueCard({
  current,
  tracks: slice.items.map((track, i) => ({ position: slice.firstPosition + i, ...track })),
  page: slice.page,
  totalPages: slice.totalPages,
  variant: 'sakura',
});
```

![](preview/queue-sakura-page3.png)

The command list too. Its sidebar, highlight, rows and every icon come from the catalog — the icons are drawn, not taken from the artwork, so `/shuffle` never inherits a pause symbol:

![](preview/help-sakura.png)

The playlist library is drawn entirely in code — no template behind it — with its own pastel stickers, so it sits alongside the template-backed cards without one:

![](preview/playlist-sakura.png)

```ts
await renderNowPlayingCard({ ...playerState, variant: 'sakura' });
await renderQueueCard({ ...queueState, variant: 'sakura' });
await renderSakuraHelpCard({ categories, activeCategory, commands, prefix });
await renderSakuraPlaylistCard({ entries, ownerName, page, totalPages, prefix });
```

The cover fills the picture area of its frame, which took measuring the template rather than guessing at it:

![](preview/artwork-fit.png)

The frame is a **double** outline — an outer line, a pale gap, then an inner one — and the photo the template ships sits just inside the inner line, at 94–538 by 164–627 with a 34px radius. The original box stopped partway across that gap, so the picture looked too small for its frame; filling further covers the inner line and flattens the frame into a single stroke. Only the picture area itself leaves the frame looking like the artwork drew it.

Two tests hold it. One walks the inside of every edge and fails on a strip of pale ground between the inner line and the cover. The other compares the four corners against the template's own pixels, because outside the arc the card has to be exactly what the artwork drew — it goes red at any radius that squares the cover off.

Swapping either template means re-measuring the region coordinates in `src/ui/canvas/cards/now-playing-sakura.card.ts` and `queue-sakura.card.ts`; they are pixel measurements of those specific images. Note the two queue variants page differently — the classic list fits 10 rows, the illustrated one 5.

## The classic variant: a canvas-rendered UI

Every panel the user sees is rendered server-side with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) and sent to Discord as an image:

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

Help is generated straight from the command catalog, and every category is reachable — `help filters`, `help 2`, or the buttons under the card:

![](preview/reply-help-queue.png)

Every card names commands the way the person reached the bot: `/play` for a slash command, `?play` for a typed one, `@Melody play` for a mention. A card is an image, so each command it mentions has to be spelled out — and somebody who typed `@Melody help` has no prefix in their head, while a slash user may not know the guild has one at all.

| Slash                             | Mention                             |
| --------------------------------- | ----------------------------------- |
| ![](preview/reply-help-slash.png) | ![](preview/reply-help-mention.png) |

One rule (`invocationPrefix`) decides it for the help card, the settings sheet, the playlist card and the router's usage hints, so they cannot disagree. The bot's name is read late, at reply time — the commands are built before the client logs in, so reading it any earlier freezes the fallback into every card.

The card has always taken an `activeCategory`; the handler pinned it to 0, so the sidebar listed six groups and could show one. A button press is dispatched back through the router as a `help` command rather than calling the renderer directly, so it goes through the same permission checks and prefix lookup a typed one does.

The template has room for eight rows, and the sidebar prints each category's real count — so once the player category passed eight commands the card said **16** and showed eight, with the rest reachable from nowhere. Categories now page, with `◀ 2/2 ▶` under the card and a `Page 2/2` marker on it:

![](preview/reply-help-page2.png)

The page rides in the button's id alongside the category (`mb:help:1:2`), because a press hands back nothing else and the card that raised it is a picture. `help player 2` and `/help category:player page:2` reach the same place. A test walks every category and checks that its pages add up to the number the sidebar prints, so the card cannot promise commands no page can show.

Icons come from [Lucide](https://lucide.dev) (ISC), rasterised from their own SVGs at the size each tile draws them, so a 34px row icon and a 46px one are separate renders and neither is soft. `npm run sync:icons` copies the ones the cards use into `assets/icons`, named for the glyph rather than for the Lucide file — the bot reads committed artwork rather than reaching into `node_modules`, the same way it does for fonts and templates.

![](preview/glyph-sheet.png)

What this file owns is the **mapping**: which command, category or reply tone draws which icon. That is where the bugs were, and they were all found by looking at cards: `remove`, `removemine` and `clear` all drew the rounded square that means **stop**, which says nothing about taking something away; `removedupes` and `leavecleanup` drew it too; `leave` is a departure rather than a stop; `stats` is counts rather than a list; and `history` and the `warning` tone on a refusal each drew a **question mark**, having never been given a glyph at all. A test now walks every command, every alias, and every `icon:` a reply asks for, and fails when one of them would fall through to that question mark — though it cannot catch two rows sharing one icon, which is what `djrole` and `settings` did until the picture showed it.

Two things the picture caught: `<position>` ran straight into the description after it, because the hint was drawn from the end of the name while the description starts at a fixed column — it is clamped now. And `remove`, `move`, `jump` and `removemine` all drew a question mark, having never been given glyphs.

Below, the classic help card:

![](preview/help.png)

## Running the bot

You need a Discord application and a Lavalink 4 node. `docker compose` brings up the node for you.

```bash
npm install
cp .env.example .env       # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID

docker compose up -d lavalink   # audio node on 127.0.0.1:2333
npm run dev                     # bot, with reload
```

Or run both in Docker:

```bash
docker compose up -d --build
```

In the [Discord developer portal](https://discord.com/developers/applications) the bot needs:

- the **Message Content** privileged intent — without it only slash commands and `@Bot` mentions arrive
- the **Connect** and **Speak** permissions in the voice channels it should join

Set `DISCORD_DEV_GUILD_ID` while developing: guild commands appear immediately, global ones can take an hour.

### Reviewing the UI without a bot

```bash
npm run preview:canvas    # render every card into preview/
npm test                  # unit tests
npm run typecheck
```

`npm run preview:canvas` needs no Discord token and no Lavalink node — it exists so the UI can be reviewed while iterating on the design.

## Layout

```
src/
├── application/
│   ├── commands/    # command engine: parser, registry, router, cooldowns
│   ├── player/      # per-guild Player and the PlayerManager that serialises it
│   └── services/    # MusicService — what every interface actually calls
├── commands/        # catalog (the shared matrix) and its handlers
├── config/          # environment loading and validation (zod)
├── domain/music/    # Track and Queue — no Discord or Lavalink types
├── resolvers/       # URL parsing, source resolvers, circuit breaker, registry
├── infrastructure/
│   ├── audio/       # AudioBackend seam — the audio engine behind an interface
│   ├── discord/     # client, contexts, buttons, permissions, slash registration
│   └── lavalink/    # Lavalink backend, filter presets, node balancing
├── telemetry/       # JSON logger with secret redaction
└── ui/canvas/       # canvas UI engine
    ├── theme.ts        # color tokens and themes
    ├── fonts.ts        # font registration (bundled → system)
    ├── primitives.ts   # rounded rects, gradients, text truncation/wrapping, durations
    ├── artwork.ts      # artwork loading (host allowlist) + generated placeholder
    ├── glyphs.ts       # line-art command icons drawn from paths
    ├── stickers.ts     # pastel decorations for the code-drawn cards
    └── cards/          # one module per card
scripts/             # dev tooling (canvas preview)
tests/               # unit tests
```

## Autoplay

`autoplay` keeps the music going when the queue runs dry. It had been a switch wired to nothing — the player has always asked for a suggestion at the end of a queue, and until now nobody answered.

There is no recommendation API behind it. It searches for the seed track's artist and takes the best result that is not something the room just heard — a weaker suggestion than a real "related tracks" feed, needing no key, no account and no second provider, which is the trade the lyrics provider makes too.

What it will not hand you:

- the seed itself, anything still queued, or anything in the history
- anything it suggested in this guild's last 40 picks, so it does not circle back
- live streams, and anything over 15 minutes — an hour-long mix is a fine thing to ask for and a poor thing to be given
- the literal words "Unknown artist": a track with no artist falls back to searching its title, since `createTrack` fills a blank field with a placeholder

An autoplayed track is credited to nobody rather than to whoever queued the seed — they did not ask for it. The queue row says so, and the listening stats leave it out: counting it would credit a person who queued nothing and pad the server's totals with whatever played into an empty room.

![](preview/reply-queue-autoplay.png)

## Editing the queue

| Command            | What it does                                      | Who       |
| ------------------ | ------------------------------------------------- | --------- |
| `remove <n>`       | Takes one track out                               | See below |
| `move <from> <to>` | Moves a track, shifting the rest along            | DJ        |
| `jump <n>`         | Plays that track now, skipping past what is ahead | DJ        |

![](preview/reply-remove.png)

`remove` is the one with a split rule: **anyone may take out a track they queued themselves**, because withdrawing your own request is not a moderation act, while taking out somebody else's is a DJ's call.

![](preview/reply-remove-not-yours.png)

Positions count from 1 and mean the **upcoming** queue — position 1 is the next track up, never the one playing. A position that is not a whole number in range is refused with the range named, and refused before anything moves:

![](preview/reply-remove-out-of-range.png)

`removemine` takes out only your own tracks and needs no permission: the point is leaving without stranding the room with forty songs nobody else picked, and clearing everyone's is what `clear` is for. `playnext` is the other side of that — jumping the line is a DJ's privilege, so the only difference from `play` is where the track lands. Both were already in the domain (`removeByRequester`, `addNext`) with nothing calling them.

A missing argument reads as `NaN` rather than defaulting to 1, so a mistyped position is refused instead of quietly editing the first track. What `jump` skips over goes into the history rather than being dropped, so `previous` can still reach a track somebody jumped past.

The card said otherwise for a long time. It added one to every row whenever something was playing, so the track beside **2** was the one `remove 1` deleted — the numbers on the picture and the numbers the commands took were a song apart, and no test could see it because the numbers are pixels. The card is compared against one drawn with the queue's own positions now, and that test goes red on the old arithmetic.

### Finding a track in a long queue

`remove`, `move` and `jump` all want a number, and in a queue of eighty the only way to find one was to page through the card until the track went by. `queue <text>` searches instead:

![](preview/reply-queue-find.png)

The rows carry their real positions — `remove 2`, `jump 5` — so the answer to "where is that song" is also the argument for the command that acts on it.

Diacritics are folded, because nobody types `Chăm Hoa` into a chat box with the tone marks on: `cham hoa` finds it, and so does `hoa mono`. Words match in any order and as substrings, since half-remembered is the normal state — `lac` reaches `Lạc Trôi`. `đ` is folded by hand; it survives Unicode decomposition, being its own letter rather than a `d` with a mark.

One argument, two meanings, told apart by shape: `queue 3` is a page, `queue mono` is a search. Nobody has a track called "3", and a second command for finding one would be a second thing to remember.

![](preview/reply-queue-find-none.png)

That picture caught a second thing. The template's top band is highlighted whatever sits in it, and the renderer read that as "this row is the track playing" — so it drew an equaliser where the number goes. On a search result that meant the best match came back with no position on it, which is the one number the row exists to give. The number now follows the _current track_, not the row index, and the patch that clears the equaliser is sized for it rather than for a digit.

## Playing a file somebody uploaded

Somebody who has the song on their phone should be able to drop it into the channel rather than go looking for it on YouTube first. `/play file:<upload>` takes it, and so does a typed `!play` with the file attached to the message:

![](preview/reply-play-upload.png)

An upload is a **file**, not a stream: it has an end, a length and a position, so `seek`, `forward` and the progress bar all work on it. That is the difference from a radio URL, which the other resolver keeps — a station never ends and has nothing to seek to. The two are told apart by the file extension and by the host, so a station can never be dragged in here and drawn with a progress bar that never fills.

The audio node is asked what the file actually is, because an MP3 carries its own title, artist and length in its tags and those beat anything guessable from a URL. A file with no tags falls back to its own name — `Chăm_Hoa_MONO_demo.mp3` reads as **Chăm Hoa MONO demo**, which is usually what somebody already typed once. Lavalink fills a missing tag with `Unknown title` rather than leaving it blank, and that on a card looks like a bug, so it is treated as no title at all.

Hosts are on an allowlist, as radio URLs are: playing an arbitrary URL makes the bot fetch whatever a user names, which is a request-forgery primitive. Discord's own CDN is on it by default, because that is where an upload attached to a command lands — the URL comes from Discord rather than from whoever typed the command. `FileResolver` takes `allowedHosts` for anyone serving their own library.

Both interfaces hand the command the same thing. A slash attachment option carries Discord's id for the upload in its `value`, which nothing downstream can play, so the adapter reads the URL off it; a typed command carries the file on the message instead, and it lands under the same option name the command declared. `play` and `playnext` therefore read an upload identically whichever way it arrived, and prefer it over any words typed alongside — attaching is the more deliberate act, and the one the person can see they did.

Making the text optional cost the router its "you forgot the query" check, so `play` makes it itself:

![](preview/reply-play-nothing.png)

## Spotify, Apple Music and Deezer links

Paste a track, album or playlist link from any of the three and it plays, badged with the service it came from:

| Spotify                             | Apple Music                             | Deezer                             |
| ----------------------------------- | --------------------------------------- | ---------------------------------- |
| ![](preview/reply-play-spotify.png) | ![](preview/reply-play-apple-music.png) | ![](preview/reply-play-deezer.png) |

The reading is done by the **audio node**, not the bot. Lavalink's LavaSrc plugin already holds each service's credentials and token cache and hands back playable tracks carrying that service's own title, artist and artwork; a second copy of that in the bot would be a second set of credentials and a second thing to keep current. So `LavaSrcResolver` only decides what a link means and passes it on.

Apple Music's links need one piece of care: `/us/album/name/123?i=456` is a **song**, not an album — the page is the album, and `i` says which track on it was shared. Missing that turns one shared song into a whole album queued behind it. Deezer's carry an optional locale (`/fr/track/…`), which is normalised away.

Credentials go to the node, in `docker/lavalink/application.yml`, supplied by compose from `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, `APPLE_MUSIC_TOKEN` and `DEEZER_DECRYPTION_KEY`. Leave any of them blank and everything else still works — those links come back as unsupported, and the message names the service, because a node is usually set up for one of them and not the others:

![](preview/reply-play-spotify-disabled.png)

That message matters more than it looks. The load comes back empty whether a track was deleted or the plugin was never installed, and the second is an operator's problem; answering "that track is unavailable" would send whoever reads it looking at the wrong thing. A resolver can now mark a message as already fit for the user, and that one is.

Each service gets its own badge mark and brand colour, from one table both the Now Playing panel and the search card read — two copies drift the moment a source is added, which is exactly what these two would have done. `APPLE MUSIC` is spelled the way Apple spells it rather than as the `applemusic` the code calls it.

## What already played

`history` (also `played`, `recent`) shows what the room has been through, newest first:

![](preview/reply-history.png)

Row 1 is what just finished, because that is what somebody asking "what was that song" means — the domain keeps the list oldest-first for `previous` to walk back through, and the card reverses it. It shows who queued each track, so an autoplayed one reads as **Autoplay** rather than as somebody's request.

The card is as tall as the history is long. A fixed height left a room that had played two songs staring at four empty rows, and the first attempt at shrinking it put the mascot on top of the last row's duration — there is a band under the final row now that the footer and the mascot share.

## Search, then pick

`play` takes the first result, which is right when you know what you want and wrong when the first hit is a cover, an hour-long mix, or the wrong language. `search` (also `find`, `sr`) shows what was found and lets the asker choose:

![](preview/reply-search.png)

Five results, because that is what fits on one row of Discord buttons — a row on the card that no button can pick would be a lie about what is on offer, so the card draws five whatever came back. Pressing a number queues that track through exactly the same path as `play`: same connect, same guild lock, same Now Playing panel.

A pending choice belongs to one person in one guild, so two people searching at once do not pick from each other's lists, and pressing a number on somebody else's card queues nothing. Choices expire after two minutes, and a used one is spent — one search queues one track. Everything that can go wrong (the wrong person, a stale card, a number off the end, not being in a voice channel) is answered privately, so a mis-press does not put a notice in front of the channel; a number off the end or a missing voice channel keeps the list, because losing a whole search to a typo is the harsher answer.

One thing to know about the failure case: the resolver registry catches a provider's own failure and drops its results so one dead source cannot empty the whole list, which leaves nothing here to tell an outage apart from a query that matches nothing. Both read as **No results**.

## Cards are sent as WebP

Encoding is the whole cost of a card. Compositing the template and drawing the live state takes ~0 ms; encoding the 1536×1024 result is what takes the time:

| Encoding                             | Time    | Size      |
| ------------------------------------ | ------- | --------- |
| PNG                                  | ~660 ms | 947 KB    |
| WebP q90 (default)                   | ~140 ms | **56 KB** |
| WebP q100 (lossless in this encoder) | ~380 ms | 826 KB    |

The same region of the same card, zoomed 3× — PNG on top, WebP q90 below:

![](preview/webp-vs-png-zoom.png)

Quality 90 rather than the 70 that also looks fine: the difference is 26 KB against a 947 KB baseline, which is not worth saving on a card somebody might zoom into. Compared side by side at 2× zoom — title, Vietnamese diacritics, the source badge, the timestamps — q90 and the PNG are the same picture. Lossless WebP saves only 13% over PNG and takes three times as long, so it earns nothing.

`CARD_FORMAT=png` puts it back if a client ever refuses WebP, and attachment names follow the format (`now-playing.webp`), because Discord reads the extension to decide whether a file is an image worth showing inline. The committed preview images stay PNG so GitHub can draw them.

## A progress bar that moves

The card is a PNG, so the bar drawn inside it is frozen at the moment it was rendered. The live bar is the line of text above it:

```
▬▬▬▬▬▬▬▬🔘▬▬▬▬▬▬▬▬▬ `2:00 / 4:05`
[ the Now Playing card ]
```

Every five seconds the ticker rewrites **only the message text**. Editing text leaves the attachment alone — discord.js omits `attachments` when no files are passed, and Discord keeps what it already has — so the image is neither re-uploaded nor re-fetched, and the panel does not blink.

The alternative was redrawing the card each tick, and the measurements ruled it out. Encoding is the whole cost of a card: compositing the template takes ~0 ms, encoding the 1536×1024 PNG takes ~660 ms and produces 947 KB. A four-minute song at a five-second cadence is 48 renders — **45 MB and 32 seconds of CPU per song per guild**, before a second guild plays anything. The text line costs one edit of a couple of hundred bytes and no encoding at all.

Details that matter more than they look:

- The knob replaces a block rather than sitting between two, so the bar is the same width at 0:00 and at 4:05 and the line never reflows under the card.
- A paused player's line says `· paused`, then stops changing — a bar that quietly stopped moving looks identical to one that broke.
- A live stream gets `🔘 **LIVE**` and no ticker at all: there is no position to follow.
- An unchanged line is not sent. `setContent` returning `false` — a deleted panel, or an interaction token past its fifteen minutes — stops the ticker rather than retrying.
- One panel per guild. A second `nowplaying` adopts the new panel and drops the old one, so two tickers never spend two requests saying the same thing.

## Stepping through a track

`seek` needs a position; `forward`, `rewind` and `replay` need nothing at all. Missing a line is the common case, so `forward` and `rewind` move ten seconds unless told otherwise (`forward 30`, `rewind 1:00`), and `replay` goes back to the top.

![](preview/reply-forward.png)

Each one redraws the panel, because the panel is the answer — the progress bar is where the jump landed. The distance is relative on purpose: somebody who wants the last ten seconds again should not have to read the clock, do the subtraction and type the result. Jumping past either end lands on that end rather than off it.

A live stream has no position to jump to. The player quietly ignores the attempt, so all three say so instead of redrawing an unchanged panel:

![](preview/reply-forward-stream.png)

## A sleep timer

People fall asleep to this bot. The alternative to a timer is a room playing to nobody until the idle monitor notices — which never happens while a long queue keeps feeding it tracks. `sleep 45` stops the music and leaves in three quarters of an hour:

![](preview/reply-sleep-set.png)

A bare number means **minutes** here, unlike everywhere else in the bot: nobody sets a sleep timer for thirty seconds, and `sleep 30` meaning half a minute would be a trap rather than a shorthand. Lengths work too — `sleep 1h30m`, `sleep 90m`. The floor is ten seconds and the ceiling is twelve hours; below the floor it points at `stop`, which is what that person actually wants.

`sleep track` lets the current song finish and stops after it:

![](preview/reply-sleep-track.png)

That one is a flag rather than a timer on the track's remaining time. A seek, a pause or a skip would each leave such a timer pointing at a moment that no longer means anything, so the flag is spent by the track _actually_ ending, whenever that turns out to be — and only in the guild that set it.

A bare `sleep` asks what is set, and `sleep off` calls it off. Both answer privately, since neither changes what the room hears:

![](preview/reply-sleep-status.png)

![](preview/reply-sleep-off.png)

Anything else is read back rather than guessed at:

![](preview/reply-sleep-invalid.png)

A timer belongs to the player that was running when it was set. `leave`, `stop` and an idle disconnect all take it with them — without that, a timer set before somebody left would come back an hour later and tear down whatever the guild was playing by then.

## Announcing each track

A track that starts on its own — the next in the queue, or an autoplay pick — has no command waiting on it, so until now a room only ever saw the song it had asked for. Each one now posts its own panel, with the same controls and the same moving progress line:

![](preview/reply-announce.png)

The ticker adopts the new panel, because that is the one on screen. Guilds that would rather have a quiet channel turn it off with `settings announce off`; it is on by default, since a room that cannot see what is playing has to ask.

![](preview/reply-settings.png)

Two things that picture caught. The sheet was fixed at five rows, so adding this setting pushed **24/7** off the bottom and said nothing about it — the card is drawn in code, so it grows with the list now, and a test compares a card built without its last row to prove the renderer is not stopping early. And the new row drew a **question mark**: `announce` had no glyph. It gets a bell. On the same card, `djrole` was drawing the same gear as **Settings** itself — two rows, one icon, neither of them saying anything — so the role that runs the music gets a note.

## Saving what is playing

`grab` (also `save`, `yoink`) sends the current track to your own messages — the Now Playing card so the song is recognisable at a glance in a DM full of them, and the link as text, because a link drawn into an image is a link nobody can follow.

![](preview/reply-grab.png)

Both replies are private: a room does not need to watch somebody save a song. Closed DMs are the ordinary case rather than an error — plenty of people have messages from server members turned off — so the send comes back as a `false` the command explains, instead of an exception thrown at the reply:

![](preview/reply-grab-closed.png)

Sending the message is a port (`directMessage`), so the service stays free of discord.js and a test can watch what would have been sent.

## Cleaning up a queue

Two commands for a queue that has drifted from what the room wants:

| Command        | What it drops                                            |
| -------------- | -------------------------------------------------------- |
| `removedupes`  | Repeats, keeping the earliest copy of each               |
| `leavecleanup` | Tracks queued by people who have left the channel        |
| `removemine`   | Everything you queued — yours only, no permission needed |

![](preview/reply-remove-dupes.png)

`removedupes` matches a track by source and identifier rather than by queue entry: the same song added twice is two entries with two ids, so matching by entry would find nothing. What is playing counts as already queued, because a long playlist looping back onto the current track is the usual way a queue fills with repeats.

`leavecleanup` needs the voice channel to be readable, and refuses when it is not — an unknown room and an empty one mean very different things, and guessing would throw away the queue of everybody present. It never withdraws the track already playing: that one is already sounding in the channel.

![](preview/reply-leave-cleanup.png)

One reader answers "who is listening" for both the skip vote and the cleanup, so the two cannot disagree about who is in the room.

## Voting to skip

`skip` (also `voteskip`, `vs`) is open to everyone now, and gated by a vote:

![](preview/reply-vote-skip.png)

Three ways it skips without a vote — a DJ asked, whoever queued the track asked (it is theirs to withdraw), or nobody else is listening. Otherwise it takes a simple majority of the room.

The tally is counted against the room **as it is now**, not as it was when the vote opened: three listeners becoming one should not leave a vote stuck needing two. A vote belongs to the track it was opened on, so the next song starts over — carrying it forward would let people skip a track they never heard. Voting twice does not count twice.

If the listener count cannot be read, the vote falls back to asking one person. Refusing to skip on missing information would be worse than skipping too easily.

## Lyrics

`lyrics` looks up the current track, or whatever you name. Long songs page with buttons:

![](preview/reply-lyrics.png)

Words come from [LRCLIB](https://lrclib.net), chosen because it needs no key and no account — running this bot stays a matter of a token and a Lavalink node. The provider is behind a port, so a second source is a new implementation rather than a change to the command.

It gets the same treatment as the track resolvers: a 6-second timeout and a circuit breaker, because a lyrics service having a bad day must not hold a command open until Discord expires the interaction. Video-title decorations (`(Official MV)`, `[Lyrics]`, `| Official Audio`) are stripped before searching, and only the primary artist is sent — the difference between a hit and nothing at all.

The lookup is remembered per guild so a page button turns the page instead of spending another request.

### Following along

LRCLIB often has a **timed** transcript, and the bot was throwing the timings away — stripping `[00:24.00]` off each line and drawing the words. It keeps them now, so a card for the song that is playing opens on the page the music is on and lights up the line being sung:

![](preview/reply-lyrics-synced.png)

The words are built from the timings rather than from the raw file, so what the card pages through and what it highlights cannot fall out of step. Wrapping splits one sung line into two drawn ones; the stamp goes on the first fragment only, so "the line being sung" can never land halfway through one.

Three things have to hold before anything lights up: the transcript is timed, it is the words to what is playing, and that is still the track it was looked up for. `lyrics Lạc Trôi` while something else plays is a card about a different song and gets no highlight; a queue that has moved on loses it too. Paging away leaves the highlight behind rather than dragging it along — turning the page is a deliberate act, and a card that argues with the person turning it is worse than one that stays put.

The picture caught the one case no test had: a verse break carries a stamp of its own and draws nothing, so half a minute into the song the highlight landed on a blank row and the card looked broken. A break is skipped now, and the last line actually sung stays lit through the gap.

## More than one audio node

`LAVALINK_NODES` takes extra nodes as `name@host:port:password` (comma separated, `:secure` for TLS). The single-node variables stay the first node, so an existing deployment keeps working untouched. An entry that will not parse is skipped with a warning — one typo in a list of three should cost that node, not the whole bot — and a repeated name _or_ address is dropped, because either would have Shoukaku connect to the same node twice.

When a node goes away, the guilds that were on it are named in a `nodeLost` event and each one is re-established on another node: the track starts again from the position it had reached, keeping the queue, the history and a pause. A node dying costs seconds rather than the session.

The failover runs under the same per-guild lock as everything else, so a command arriving mid-failover cannot interleave with the reconnect, and a reconnect that fails is reported rather than thrown at the event loop.

## Health and metrics

Set `METRICS_PORT` and the bot serves three endpoints (on loopback by default, so it is not exposed by accident):

| Path       | Answers                                                     |
| ---------- | ----------------------------------------------------------- |
| `/healthz` | Is the process alive?                                       |
| `/readyz`  | Can it actually play — gateway up, at least one audio node? |
| `/metrics` | Prometheus text format                                      |

Liveness and readiness are separate on purpose: an orchestrator restarting the container on a failed liveness check must not do so merely because Lavalink is down, which is what readiness reports. `/readyz` names the failing check in its body rather than just saying no.

Metrics cover commands (by name and outcome, with a duration histogram), active players, guilds, gateway latency, and each audio node's state and player count. Gauges are refreshed at scrape time, so a scrape never reports whatever happened to be true when the last command ran.

![](preview/dashboard.png)

The page is **read-only on purpose**. Controls would need authentication, and an unauthenticated page that can stop playback in every guild is worse than no page at all — it says what the bot is doing, and the commands stay the way to change it. Everything written by other people (guild names, channel names, track titles) is escaped, so a server called `<script>` does not become one.

The registry is hand-rolled — the bot needs four metric shapes and the text format is a dozen lines to emit, so a dependency here would be more code to keep current than the thing it replaces.

## Surviving a restart

A deploy in the middle of a set should cost the listeners a few seconds, not their queue. Each guild's session — voice channel, queue, history, loop, autoplay, filter, and where the current track had got to — is written to `SESSION_STORE_PATH` and picked back up when the bot returns.

Writes are debounced: filling a queue fires an event per track, and saving each one would turn one command into a hundred file writes for a state that is stale a millisecond later. On shutdown every player is flushed **before** the players are torn down — destroying them first would save the state of a queue that has already been cleared.

Coming back:

- playback resumes at the saved position rather than from the top, and comes back paused if it was paused
- each guild is restored independently, so one guild whose voice channel has since been deleted does not stop the others
- a session is cleared whether or not it restored, because one that failed now will not restore any better next time
- sessions older than `SESSION_MAX_AGE_MS` (15 minutes by default) are dropped. Coming back after a short deploy is a courtesy; coming back after a day and playing into a room that emptied hours ago is a nuisance

## Guild settings

`settings` with no arguments renders the sheet; with a name and value it changes one:

![](preview/reply-settings.png)

| Key           | What it does                          |
| ------------- | ------------------------------------- |
| `prefix`      | What message commands start with      |
| `volume`      | Volume a new player starts at         |
| `djrole`      | Role allowed to run DJ commands       |
| `idletimeout` | How long to wait alone before leaving |
| `247`         | Stay in voice when the queue runs out |

![](preview/reply-settings-prefix.png)

![](preview/reply-help-guild-prefix.png)

`volume` is the third setting that was written and never read: a new player took the environment's volume whatever the guild had configured. Every path that can create a player now goes through one place that asks for the guild's, so it cannot apply on `play` and not on `join`. It is what a player _starts_ at — changing it does not reach into a session already running, which is what the `volume` command is for.

Each guild's prefix is read **before its messages are parsed**, so `settings prefix ?` actually changes what the bot answers to — as does its DJ role, which is applied wherever a tier is decided (message, slash command, button). Both were configurable and then ignored until now: the handler parsed with the environment's prefix and judged tiers by the environment's role, which made those two settings switches wired to nothing. The help and playlist cards print the guild's prefix too — a hint telling people to type `!play` on a server using `?` is wrong twice. A settings read that fails falls back to the environment's values rather than dropping the command.

Settings are declared once, as data (`SETTING_DESCRIPTORS`), and the command, the card and the validation all read from that list — a setting cannot be half-added. Reading a guild's settings fills in the environment defaults without writing them back, so a guild nobody has configured behaves like one set to the defaults rather than one with holes in it.

Storage is the same port-and-JSON-file arrangement the playlists use; both now share one `JsonStore` with the atomic-rename write, rather than two near-identical copies.

## Listening stats

`stats` (also `activity` or `top`) answers about **you**: your own top tracks and artists, how much of the server's listening is yours, and where you come among its listeners — with your row picked out of the list.

![](preview/reply-stats-me.png)

| Command          | Who it reports on |
| ---------------- | ----------------- |
| `stats`          | You               |
| `stats @someone` | That person       |
| `stats server`   | The whole server  |

Your own numbers are what you usually want, so they are what a bare `stats` gives; the server is a word away. `guild`, `all` and `everyone` are taken the same as `server`, because those are the words people reach for.

![](preview/reply-stats.png)

The per-person view needs per-user track counts, so each person's own list is kept alongside the guild's, capped tighter at 50 tracks each: three hundred songs across three hundred people is a file nobody wants, and the guild list is the one that keeps the long tail. A record written before per-user tracks existed starts collecting them rather than failing to load.

A play is counted when a track **ends**, not when it starts, and with the time it was up for — queueing forty songs and skipping thirty-nine of them should not read as forty songs listened to. The measure is wall time between start and end, capped at the track's own length; that counts a pause as listening, which overstates a little, and the cap is what stops it overstating a lot. A live stream has no length to cap against, so wall time is all there is.

What is kept is aggregated rather than a log of every play: a busy server would otherwise grow an unbounded file, and nothing here asks "what happened at 14:32" — only "what gets played". Tracks are keyed by `source:identifier`, so the same song found through two different searches counts once, and the newest title wins over whatever it was first called. Per guild, the 300 most-played tracks and people are kept and the rest pruned, dropping the least-played first.

The card falls back to _Someone_ for a person whose display name is not cached: a raw snowflake is unreadable, and it is somebody's account id — neither belongs in a picture posted to a channel. A guild with nothing played yet gets a sentence rather than an empty chart, which just looks broken.

Counts live in `STATS_STORE_PATH`, on the same `JsonStore` as playlists, settings and sessions. Blank it and the numbers are kept in memory and start over on every restart.

## Seeing what the bot replies

```bash
npm run preview:replies
```

Runs the real services through the real reply pipeline with a fake audio backend and writes each answer to `preview/`. The Now Playing panel is still written as a `.png`; everything else is now an embed, so its title, text and fields are written to a `.txt` file instead — because the reply comes from the command path rather than from hand-written sample data, a preview cannot drift from what a user would see.

## Joining and leaving

| Command | Aliases             | What it does                                              |
| ------- | ------------------- | --------------------------------------------------------- |
| `join`  | `summon`, `connect` | Joins your voice channel without queueing anything        |
| `leave` | `disconnect`, `dc`  | Leaves and clears the queue, saying how much went with it |

`join` is also how the bot is moved. `play` never moves it — an existing session keeps its channel, because moving should be something someone asked for rather than a side effect of a person in another channel running a command.

A move is a real reconnect, not a field change: Lavalink destroys its player when the bot leaves a channel, so the current track is started again from the position it had reached, and stays paused if it was paused.

## Every reply is an embed

Only the Now Playing panel is still a drawn image — everything else (`join`/`leave`, `volume`, `queue`, `history`, `help`, `lyrics`, `playlist`, `search`, `stats`, `settings`, and every other one-line notice) answers with a real Discord embed instead:

Four tones — success, info, warning, error — change the accent colour, never the layout: a warning that redesigned the reply would stop looking like the same bot.

The conversion happens once, in `toMessageOptions` (`src/infrastructure/discord/context.ts`), which builds the embed from whatever a command already writes: a sentence in `content`, an optional `title`/`icon`/`tone`, and `fields`/`footer` for anything with a list to show. A command that also attaches a file — only the Now Playing panel does — is sent as plain text plus that image instead, no embed wrapped around it.

## Saved playlists

`playlist` works over slash, prefix and the library card's page buttons:

| Action                            | What it does                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `playlist list`                   | Renders your library as a card, paged by its buttons        |
| `playlist create <name>`          | Creates an empty playlist                                   |
| `playlist add <name>`             | Adds the current track, creating the playlist if new        |
| `playlist savequeue <name>`       | Saves the whole queue — what is playing and what is waiting |
| `playlist play <name>`            | Queues every track in it                                    |
| `playlist remove <name> <n>`      | Removes track `n`, counting from 1                          |
| `playlist delete <name>`          | Deletes the playlist                                        |
| `playlist public\|private <name>` | Changes who can see it                                      |

### Saving a whole evening

`add` keeps one song; `savequeue` keeps the session. A room that has spent an hour building a queue should not have to save it a track at a time — the alternative people reach for otherwise is leaving the bot connected so the queue survives.

![](preview/reply-playlist-savequeue.png)

It saves what is playing and everything waiting, in the order a listener would hear them. History is left out; a playlist of what has already been played is a different thing, and `history` is where that lives.

Saving into a playlist that already exists appends rather than replaces, and tracks already in it are skipped — so saving the same queue twice leaves one copy, and says so instead of claiming a save it did not make:

![](preview/reply-playlist-savequeue-again.png)

The batch append is its own domain function rather than a loop over the single-track one, which throws at the 500-track cap: that is right for one track and wrong for forty. A long queue going into a nearly full playlist keeps what fits and is told what did not, instead of losing the lot to an error on track thirty-one.

`playlist saveall` and `playlist snapshot` reach the same place.

`favorite` (or the heart on the Now Playing panel) toggles the current track in a playlist called **Favorites** — pressing it again takes the song back out. Favorites are a playlist rather than a second store, so they show up in the library and behave like any other one, and there is only one implementation to keep right. A song is matched by source and identifier, not by queue entry, so favoriting the same track twice cannot leave two copies.

Names are matched case- and whitespace-insensitively, so `chill vibes` finds `Chill  Vibes`. Limits are 25 playlists per person per guild and 500 tracks each.

A playlist stores what it takes to rebuild a track, not the track object — the per-enqueue id and the original requester do not survive being saved, so a replayed track is attributed to whoever played it.

Storage is behind a port (`PlaylistRepository`), so where a library lives is not the command layer's business — see [Keeping things in Postgres](#keeping-things-in-postgres). `PLAYLIST_STORE_PATH` writes a JSON file — whole-file writes, moved into place with a rename, so a crash cannot leave half a library. Blank the variable to keep playlists in memory instead and lose them on restart.

## The read that happens on every message

Every message in every guild goes through a settings read _before_ the bot knows whether it is a command — the guild's own prefix is what decides that, and a prefix that can be configured and then ignored would make the setting a switch wired to nothing.

That read was free against the JSON store, which holds its records in memory after the first load. Moving to Postgres in F8 quietly turned it into a network round trip per message: a busy server spends a hundred queries a minute discovering that none of them started with `!`. Measured against a real database on the same machine, 500 messages' worth:

| Guild                 | Straight to Postgres | Cached        |
| --------------------- | -------------------- | ------------- |
| has changed a setting | 94 ms, 500 queries   | 2 ms, 1 query |
| has never changed one | 85 ms, 500 queries   | 0 ms, 1 query |

The second row is the important one. Most guilds never touch a setting, so `find` returning **nothing** is the common case — and a cache that only remembers hits would query forever for exactly the guilds it should be cheapest for. Misses are cached too.

Writes go through the cache, so it cannot be stale for anything the bot itself did; the five-minute TTL is there for the operator who edits a row by hand. It is a real LRU — a hit moves the entry to the back — because the alternative evicts the guild that is read constantly for having been _loaded_ long ago, which is a different thing wearing the same name. A test proved that difference before the comment did.

### Why this is not Redis

The spec puts shared state in Redis (§21), and the roadmap says so. Having built the sharding it was supposed to serve, the honest answer is that it has no job here:

- **A guild lives on exactly one shard.** Its settings are read and written by exactly one process, so there is no second reader to share a cache with. Redis would add a network hop to solve what a `Map` already solves — and the numbers above are against a database on the same machine; a cache that had to cross the network to answer would be closer to the 94 ms column than the 2 ms one.
- **Durability is Postgres's job**, and sessions are already there.
- **Cross-shard questions** — "how many players are there in total" — are what discord.js's own `broadcastEval` is for.

So it is not built. Adding a dependency, a container and a failure mode to tick a roadmap box would make the bot worse, and the roadmap is a plan rather than a promise. If a deployment ever spreads one guild across processes, this file is the seam it plugs into: `CachedSettingsRepository` implements the same `SettingsRepository` port everything else does.

## The website

`PUBLIC_PORT` serves a small site: what the bot is, every command, and whether it is up.

| Route         | What it is                                                   |
| ------------- | ------------------------------------------------------------ |
| `/`           | Home — the pitch, with a screenshot of each feature          |
| `/commands`   | All 38 commands, grouped, with aliases and who may run them  |
| `/status`     | Shards, the audio cluster, and a "find your shard" lookup    |
| `/invite`     | A 302 to Discord's OAuth screen, short enough to paste       |
| `/api/status` | The same counts as JSON, CORS-open, for anyone's uptime page |
| `/shots/*`    | The screenshots the pages use                                |

Header and nav are one layout shared by all three pages, so the day a fourth is added there is one place to add it rather than three copies to keep agreeing with each other.

### Home

![](preview/web-home.png)

Every picture on it is a card the bot really rendered — the same PNGs the README shows. A page selling a bot whose whole point is what its replies look like should show the replies rather than describe them.

### Commands

![](preview/web-commands.png)

Generated from the same catalog the commands are built from, through the same `usage()` the router and the help card use. A hand-kept command list on a website is a list that quietly stops matching the bot, and a reader has no way to tell which of the two is lying.

### Status

![](preview/web-status.png)

**Find your shard** is the point of the page. A bot spread across processes can be perfectly fine for most servers and completely absent from the rest, and "is it just me" is otherwise unanswerable from outside. Paste a server ID and it applies Discord's own rule — `(guild_id >> 22) % shard_count` — in your browser, with `BigInt`, because a snowflake past 2^53 rounded to a float gives a confidently wrong answer for exactly the newest servers. It runs client-side because it needs nothing the server has, and there is no reason to log which server somebody asked about.

Two things the pictures caught:

- The banner read **All systems playing** while two of four shards were down. On the one page that must not overclaim — whoever is reading it is on exactly one shard, and it may be the broken one. Three states now: all up, **partial outage** with the count, or offline.
- A shard that is dead does not answer the broadcast at all, so it was absent from the list rather than present and unhealthy — three shards with one dead read "2/2 up". The expected count comes from the sharding manager now, and a shard that said nothing is drawn as **not reporting** with dashes rather than zeroes: it is not serving no servers, it is not saying.

### Public means public

It is a second server on a second port, and that is the point. The metrics port binds loopback and serves guild names, channel names and what people are listening to. This one binds every interface. Two audiences, two ports, and no route that can be confused for the other's — the day somebody puts a reverse proxy in front of the wrong port, that separation is what stops it being a leak.

The boundary is one function, `toPublicStatus`, and it works by construction: it reads named fields off the internal status and never spreads it, because a spread would publish the next field added to the dashboard on the day it was added, by nobody's decision. A test feeds it a guild called _Bí Mật Của Chúng Tôi_ playing _Chăm Hoa_ and asserts that none of those words survive into the JSON or into any page.

The screenshots are looked up in a map rather than resolved from the URL: a route that turns part of a URL into a filename has to be defended against `..`, against symlinks, against encodings that normalise to either, and against every future reader who assumes somebody already did. A map cannot be traversed.

### The pictures are WebP

Six cards is **2.9 MB** of PNG, which is a landing page that takes a moment to arrive on a phone for no reason. They are re-encoded once, cached in memory and served as WebP: **341 KB**, 8.6× smaller, at the same quality 90 the bot already sends cards to Discord at.

The `accept` header is honoured rather than assumed, with `vary: accept` on the response. Every browser released this decade takes WebP, but "every browser" is not "every client" — a link preview fetcher or a scraper may not, and serving them bytes they cannot decode to save a few hundred kilobytes is a bad trade.

### The invite

Eight permissions, each written as its own named bit so it has to justify itself, and the home page lists what the bot deliberately does **not** ask for — including Administrator, which no bot needs and which one should be refused for requesting. The `applications.commands` scope is in there too; without it the slash commands register and then appear for nobody.

## The status page

`METRICS_PORT` also serves a read-only dashboard at `/`, alongside `/healthz`, `/readyz` and `/metrics`:

![](preview/dashboard.png)

Read-only on purpose. Controls would need authentication, and an unauthenticated page that can stop playback in every guild is worse than no page at all — this says what the bot is doing, and the commands remain the way to change it. It binds to `METRICS_HOST`, which defaults to loopback; put it behind a reverse proxy with auth before letting anyone else near it.

The whole page is one inline string — no build step, no CDN, no asset pipeline. A dashboard that needs its own build is a liability on the day you most want to look at it. Guild names, channel names and track titles are escaped on the way in, because a server called `<script>` must not become one.

With shards, each process serves its own page on its own port (`METRICS_PORT` plus the shard id), showing the guilds that shard holds.

## Running across several processes

Discord makes a bot past roughly 2,500 guilds split its gateway connection into shards, and one process stops being comfortable well before that. `npm run start:sharded` spawns `main.js` once per shard and lets discord.js hand each process its slice:

```
SHARD_COUNT=auto npm run start:sharded

  shard starting            shard=0
  running as a shard        shard=0 of=2
  health endpoint listening port=9700
```

Nothing inside the bot changes, because a shard is just a client that sees fewer guilds — `shardIdFor` was already reading `guild.shardId`, and it finally means something. Three things do differ, and each is one small decision in `src/config/sharding.ts`:

- **A lone process is shard 0 of 1.** Not a special case with its own branch — the same code path, so the single-process bot most people run is the one that gets exercised every day rather than a second path nobody tests.
- **Each shard's health port is the base plus its id**, so shard 3 of a bot on 9100 is on 9103. They are separate processes on one machine; they cannot all bind the same port, and a bot that dies because its metrics endpoint collided is a bot that dies for no reason.
- **Only shard 0 publishes the slash commands.** Registration is global to the application, not to a shard; every shard sending the same payload on every boot would be N identical writes for one result.

**Sharding refuses to run on JSON files.** The file stores read a whole file, change it and write it back — two processes doing that do not merge, the last writer wins, and the shard that lost has no way to know it lost anything. So it is refused rather than left to corrupt quietly, twice: once by the manager before it spawns anything, and once by each shard in case somebody starts one by hand.

```
Sharding needs DATABASE_URL. 4 processes writing the same JSON files would
overwrite each other, and the loser would lose its playlists with nothing logged.
```

Spawning two shards for real found a bug in the manager itself: when `spawn()` rejects because a shard died on the way up, exiting there leaves the shards that _did_ start as orphans — still running, still respawning, with nothing supervising them. It kills them now before it goes.

Below a few thousand guilds this is the wrong entry point. `npm start` is one process, simpler to reason about and to watch; use the sharded one when one process is genuinely not enough, not before.

## Running it against a real node

Everything else in this repo runs against a fake audio backend, which is right for a unit test and proves nothing about the wire. `npm run smoke:lavalink` asks an **actual** Lavalink node to load **actual** audio and draws the card from what comes back:

```
LAVALINK_HOST=127.0.0.1 SMOKE_AUDIO_URL=http://127.0.0.1:8099/song.wav npm run smoke:lavalink

  ok    node — connected to 127.0.0.1:2333
  ok    load a file — "Chăm Hoa MONO" · 6s
  ok    draw the card — now-playing.png · 959.3 KB
  ok    spotify without the plugin — Spotify links are not working on the audio node. Ask an admin.
```

That card is drawn from what the node actually returned — the six seconds on it are the length Lavalink read out of the file, not a fixture:

![](preview/smoke-now-playing.png)

It plays nothing into a voice channel: that needs Discord, a token and somebody in a channel. What it covers is everything up to that point — the websocket handshake, node selection, `loadtracks`, the load types, the resolver that claims the URL, and the card at the end of it.

**It found a bug on its first run.** A node with no LavaSrc plugin does not answer "nothing found" for a Spotify link — it has no source manager that recognises the URL, so it _fails_ the load, and Lavaplayer's own words for that are "Something went wrong while looking up the track." The resolver only handled the empty case, so the one message written specifically to send an operator to the right place never fired; what reached the card was a sentence that tells nobody anything. Load failures on a plugin source now say the same thing as an empty one, with the node's own words kept in the log. Rate limits and timeouts are left alone — those clear on their own, and calling them "not working" would be wrong the moment they did.

A fake had been answering `empty`, which was the one case already covered. Nothing but a real node was going to show it.

## Keeping things in Postgres

Playlists, guild settings, listening stats and live sessions are each behind a port, and there are now two implementations of every one: JSON files and Postgres. Set `DATABASE_URL` and all four move:

```
DATABASE_URL=postgresql://musicbot:musicbot@127.0.0.1:5432/musicbot
```

Leave it blank and nothing changes — the JSON files stay, which is the right default for one bot on one machine. `docker compose --profile postgres up -d` starts a database for anyone who wants one; the service sits behind a profile so `docker compose up` without it does not wait for a container nobody started.

**All four move together, or none do.** One decision in one place rather than four `? :` in the boot path: four independent choices is four chances for a deploy to keep its playlists in Postgres and its settings in a file nobody mounted. A test asserts the four stores are always the same kind.

The schema is created at boot with `CREATE TABLE IF NOT EXISTS`, before the first read — a bot pointed at an empty database should work, not fail somebody's first `playlist list` with a missing table and leave them to find out why from the logs. That is a real migration story's worth of ceremony avoided while the shape is this small; when a column has to be backfilled or a type has to change, `schema.ts` is where a migration table goes, and the boot path already calls it in the right place.

Settings, stats and sessions are a `guild_id` and a JSONB document each. None of them is ever queried by a field inside — nothing asks "which guilds have 24/7 on" — so a column per setting would make every new setting a migration, where a document makes it a change to the domain type and nothing else. Playlists get real columns because they _are_ queried: by owner, and by name. Their tracks stay a JSONB document for the same reason as the rest, since no query asks which playlists contain a given song.

Two details the database forced:

- **The folded name is a column**, written by `normalizePlaylistName` before the insert rather than computed by an expression in SQL. Names are matched case- and whitespace-insensitively, and having two implementations of that rule is having two rules. Renaming a playlist moves the folded name with it, or the old name would still find it — which is what one of the tests checks.
- **`BIGINT` comes back as a string.** Postgres integers are wider than a JavaScript number, so the driver refuses to guess and hands over the digits. Timestamps are milliseconds since the epoch, comfortably inside `Number.MAX_SAFE_INTEGER`, so they are converted at the edge; without that a playlist's `createdAt` sorts and compares as text everywhere downstream.

These adapters are tested against a **real** PostgreSQL 16, not a fake. A store is the one thing a double cannot vouch for: a typo in a statement, a parameter in the wrong position and a column that does not exist all look fine to a recording double and fail on the first real write. CI starts a Postgres service so the suite runs them on every push; locally, `DATABASE_URL=… npm test` does the same, and without a database those tests skip rather than fail.

Redis is not here yet, and is not being pretended into existence. The spec puts sessions in it (§21), but nothing in the bot currently needs a cache shared between processes: sessions are durable in Postgres now, and the one thing Redis would add — several bot processes sharing live state — needs the sharding work in F9 to exist first.

## Customising the look

- **Fonts:** drop a `.ttf`/`.otf` into `assets/fonts/` — no code change needed.
- **Colors:** add a theme in `src/ui/canvas/theme.ts`.
- **Artwork:** only fetched from the host allowlist in `src/ui/canvas/artwork.ts` (SSRF guard). Unknown hosts and failed downloads fall back to a gradient cover generated from the track name.

## Roadmap

| Phase | Scope                                                                                   | Status  |
| ----- | --------------------------------------------------------------------------------------- | ------- |
| F1    | Project skeleton, config, logger, **canvas UI + Now Playing card**                      | ✅ done |
| F2    | Domain: track and queue (loop, shuffle, history, snapshots) + queue card                | ✅ done |
| F3    | Unified command engine (slash + prefix + @mention) + help card                          | ✅ done |
| F4    | Player, player manager, audio-backend seam, node balancing                              | ✅ done |
| F5    | Resolvers: URL parsing, YouTube / Spotify metadata / radio, breaker                     | ✅ done |
| F6    | **Discord + Lavalink wiring**: live commands, buttons, filters, Docker                  | ✅ done |
| F7    | **Saved playlists**, **favorites**, **lyrics**, **vote-skip**                           | ✅ done |
| F8    | **24/7, state recovery**, **PostgreSQL**; Redis — see [why not](#why-this-is-not-redis) | ✅ done |
| F9    | **Metrics and health**, **cluster, failover, sharding**, **dashboard**                  | ✅ done |

## License

MIT © thanhtinz
