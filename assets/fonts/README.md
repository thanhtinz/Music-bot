# Fonts

[Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans), Regular and
Bold, under the SIL Open Font License 1.1 — see LICENSE.

`registerFonts()` maps everything in this folder to the `MusicBotUI` family the
cards ask for, so nothing here is referenced by name in code. Replacing these
two files rebrands every card without a code change.

## CJK

Noto Sans covers Latin and Vietnamese but carries no Han, kana or Hangul, so a
`夜に駆ける` or `봄날` title would draw as a row of empty boxes. The full CJK
family is tens of megabytes, which is too much to commit, so it is not vendored
here: `registerFonts()` instead chains whatever the host provides (Noto CJK on
Linux — the Dockerfile installs it — MS YaHei, Meiryo and Malgun Gothic on
Windows, PingFang on macOS) behind `MusicBotUI`.

Dropping a font into a `cjk/` subfolder here puts it at the front of that
chain, which is the way to pin CJK rendering the same way the Latin faces are
pinned. Unlike this folder, several files there are kept rather than merged: no
single free font covers Japanese, Korean and Chinese well, and fallback only
happens between families.

They are committed rather than fetched at build time because a card's layout is
its font's metrics: how much of a message fits on a line, where a title is
truncated, how wide a pill is drawn. Falling back to whatever the host happens
to have installed makes the same bot draw different cards on different machines
— Arial is some 8% narrower than DejaVu Sans, which is enough to move where a
notice is cut. A test that pinned that truncation passed on Linux and failed on
Windows, which is how this was found.

Noto Sans rather than DejaVu because this bot is used for Vietnamese music, and
Noto carries the full set of stacked diacritics — `ế`, `ượ`, `ỹ` — without
falling back to a second family mid-word.
