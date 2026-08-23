import { prefixFor, type Command, type CommandContext } from '../application/commands';
import type { PlaylistService } from '../application/playlist';
import type { LyricsService } from '../application/services/lyrics.service';
import type { SettingsService } from '../application/settings';
import type { SearchService } from '../application/search';
import type { StatsService } from '../application/stats';
import type { MusicService } from '../application/services/music.service';
import type { LoopMode } from '../domain/music';
import { isFilterPreset } from '../infrastructure/lavalink/filters';
import { parseTimeToSeconds } from '../resolvers';
import { cardFile, paginateHelp, renderSakuraHelpCard } from '../ui/canvas';

import { catalogByCategory, COMMAND_CATALOG, type CommandMeta } from './catalog';

export interface HandlerOptions {
  /** Prefix shown on the help card. */
  prefix: string;
  botName: string;
  /** Saved playlists; without it the playlist command stays unregistered. */
  playlists?: PlaylistService;
  /** Guild settings; without it `settings` and `247` stay unregistered. */
  settings?: SettingsService;
  /** Lyrics lookup; without it `lyrics` stays unregistered. */
  lyrics?: LyricsService;
  /** Listening stats; without it `stats` stays unregistered. */
  stats?: StatsService;
  /** Search-then-pick; without it `search` stays unregistered. */
  search?: SearchService;
  /** Builds the category buttons under a help card. */
  helpComponents?: (
    categories: string[],
    active: number,
    page: number,
    totalPages: number,
  ) => unknown[];
}

/**
 * Which help category was asked for, by name or by number.
 *
 * The sidebar lists every category, so a card that can only ever show the
 * first one is a menu with five items nobody can order.
 */
export function categoryIndex(
  grouped: ReadonlyArray<readonly [string, unknown]>,
  asked: string | undefined,
): number {
  const wanted = asked?.trim().toLowerCase();
  if (!wanted) return 0;

  const byNumber = Number(wanted);
  if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= grouped.length) {
    return byNumber - 1;
  }

  const byName = grouped.findIndex(
    ([category]) =>
      category === wanted || (CATEGORY_TITLES[category] ?? category).toLowerCase() === wanted,
  );

  return byName < 0 ? 0 : byName;
}

/**
 * Reads a queue position from an argument.
 *
 * `NaN` rather than a default, because a mistyped position must be refused by
 * the service's range check instead of silently editing track 1.
 */
export function positionOf(value: string | undefined): number {
  return Number(value?.trim() === '' ? NaN : value);
}

/** What `playlist` was asked to do, however it was invoked. */
export interface PlaylistRequest {
  action: string;
  name: string;
  position?: number;
}

/**
 * Reads a playlist invocation from either interface.
 *
 * Slash supplies named options. Prefix supplies positional tokens, where the
 * name runs to the end of the line — so for `remove` the position is taken from
 * the last token, which is why it is written `playlist remove Chill 3`.
 */
export function parsePlaylistRequest(
  args: readonly string[],
  option: (name: string) => string | undefined,
): PlaylistRequest {
  if (args.length === 0) {
    const position = Number(option('position'));

    return {
      action: (option('action') ?? 'list').toLowerCase(),
      name: option('name')?.trim() ?? '',
      ...(Number.isInteger(position) && position > 0 ? { position } : {}),
    };
  }

  const action = (args[0] ?? 'list').toLowerCase();
  const tokens = args.slice(1);

  if (action === 'remove' && tokens.length > 1) {
    const last = Number(tokens[tokens.length - 1]);
    if (Number.isInteger(last) && last > 0) {
      return { action, name: tokens.slice(0, -1).join(' ').trim(), position: last };
    }
  }

  return { action, name: tokens.join(' ').trim() };
}

/**
 * Which category and page a `help` invocation is asking for.
 *
 * Three ways in, and they have to agree: `/help category:player page:2`,
 * a typed `help player 2`, and a page button, whose id carries both in one
 * argument because that is all Discord hands back when it is pressed.
 */
export function helpRequest(ctx: {
  args: readonly string[];
  option: (name: string) => string | undefined;
}): { category: string | undefined; page: number } {
  const first = ctx.option('category') ?? ctx.args[0];
  const [category, packedPage] = (first ?? '').split(':');

  const page = Number(packedPage ?? ctx.option('page') ?? ctx.args[1] ?? 1);

  return {
    category: category === '' ? undefined : category,
    page: Number.isFinite(page) ? page : 1,
  };
}

/** How far `forward` and `rewind` go when nobody says. */
const DEFAULT_NUDGE_SECONDS = 10;

/** Human-facing names for the catalog's category keys. */
const CATEGORY_TITLES: Record<string, string> = {
  playback: 'Player',
  queue: 'Queue',
  playlist: 'Playlist',
  filters: 'Filters',
  settings: 'Settings',
  general: 'General',
};

/**
 * Binds the command catalog to the music service.
 *
 * The catalog owns each command's public surface; this owns what it does, so a
 * command's metadata cannot drift from its behaviour.
 */
export function buildCommands(service: MusicService, options: HandlerOptions): Command[] {
  /**
   * `forward` and `rewind`, which differ only in which way they go.
   *
   * Ten seconds by default: the common case is having missed a line, and
   * somebody who wants a specific distance can still name one.
   */
  const nudge = async (ctx: CommandContext, direction: 1 | -1): Promise<void> => {
    const raw = ctx.option('seconds') ?? ctx.rest.trim();
    const seconds = raw === '' ? DEFAULT_NUDGE_SECONDS : parseTimeToSeconds(raw);

    if (seconds <= 0) {
      await ctx.reply({
        content: 'Give me a distance like `30`, `1:00` or `1m30s`.',
        title: direction === 1 ? 'Forward' : 'Rewind',
        icon: 'clock',
        ephemeral: true,
      });
      return;
    }

    await service.nudge(ctx, direction * seconds * 1000);
  };

  const executors: Record<string, Command['execute']> = {
    play: async (ctx) => service.play(ctx, ctx.option('query') ?? ctx.rest),
    playnext: async (ctx) => service.playNext(ctx, ctx.option('query') ?? ctx.rest),
    pause: async (ctx) => service.pause(ctx),
    resume: async (ctx) => service.resume(ctx),
    skip: async (ctx) => service.skip(ctx),
    previous: async (ctx) => service.previous(ctx),
    stop: async (ctx) => service.stop(ctx),
    clear: async (ctx) => service.clear(ctx),
    shuffle: async (ctx) => service.shuffle(ctx),
    nowplaying: async (ctx) => service.nowPlaying(ctx),
    join: async (ctx) => service.join(ctx),
    leave: async (ctx) => service.leave(ctx),

    seek: async (ctx) => {
      const raw = ctx.option('position') ?? '';
      const seconds = parseTimeToSeconds(raw);

      if (seconds <= 0) {
        await ctx.reply({
          content: 'Give me a position like `90`, `1:30` or `1m30s`.',
          title: 'Seek',
          icon: 'clock',
          ephemeral: true,
        });
        return;
      }

      await service.seek(ctx, seconds * 1000);
    },

    replay: async (ctx) => service.replay(ctx),
    forward: async (ctx) => nudge(ctx, 1),
    rewind: async (ctx) => nudge(ctx, -1),

    volume: async (ctx) => {
      const raw = ctx.option('level');
      if (raw === undefined) {
        await service.nowPlaying(ctx);
        return;
      }

      const level = Number(raw);
      if (!Number.isFinite(level)) {
        await ctx.reply({
          content: 'Volume has to be a number, 0-200.',
          title: 'Volume',
          icon: 'volume',
          ephemeral: true,
        });
        return;
      }

      await service.setVolume(ctx, level);
    },

    loop: async (ctx) => {
      const raw = ctx.option('mode')?.toLowerCase();
      const mode = toLoopMode(raw);

      if (raw && !mode) {
        await ctx.reply({
          content: 'Loop mode is `off`, `track` or `queue`.',
          title: 'Loop',
          icon: 'loop',
          ephemeral: true,
        });
        return;
      }

      await service.setLoop(ctx, mode);
    },

    autoplay: async (ctx) => service.setAutoplay(ctx),

    remove: async (ctx) => service.remove(ctx, positionOf(ctx.option('position'))),
    removemine: async (ctx) => service.removeMine(ctx),
    history: async (ctx) => service.history(ctx),
    move: async (ctx) =>
      service.move(ctx, positionOf(ctx.option('from')), positionOf(ctx.option('to'))),
    jump: async (ctx) => service.jump(ctx, positionOf(ctx.option('position'))),

    queue: async (ctx) => {
      const page = positionOf(ctx.option('page') ?? ctx.args[0]);
      await service.queue(ctx, Number.isFinite(page) && page > 0 ? page : 1);
    },

    filter: async (ctx) => {
      const preset = ctx.option('preset')?.toLowerCase();

      if (preset && !isFilterPreset(preset)) {
        await ctx.reply({
          content: 'Unknown filter. Try `bass`, `nightcore`, `vaporwave`, `chill` or `party`.',
          title: 'Filters',
          icon: 'sliders',
          ephemeral: true,
        });
        return;
      }

      await service.setFilter(ctx, preset);
    },

    ...(options.stats ? { stats: async (ctx) => options.stats!.show(ctx) } : {}),

    ...(options.search
      ? { search: async (ctx) => options.search!.search(ctx, ctx.option('query') ?? ctx.rest) }
      : {}),

    ...(options.lyrics
      ? { lyrics: async (ctx) => options.lyrics!.show(ctx, ctx.option('query') ?? ctx.rest) }
      : {}),

    ...(options.settings
      ? {
          settings: async (ctx) => {
            const key = ctx.option('key');
            if (!key) return options.settings!.show(ctx);
            return options.settings!.set(ctx, key, ctx.option('value') ?? '');
          },
          247: async (ctx) => {
            const raw = ctx.option('state')?.trim().toLowerCase();
            const enabled = raw === undefined ? undefined : ['on', 'true', 'yes'].includes(raw);
            return options.settings!.toggleStayConnected(ctx, enabled);
          },
        }
      : {}),

    ...(options.playlists
      ? {
          playlist: playlistExecutor(options.playlists, options),
          favorite: async (ctx) => options.playlists!.toggleFavorite(ctx),
        }
      : {}),

    help: async (ctx) => {
      const grouped = [...catalogByCategory()];
      const asked = helpRequest(ctx);
      const active = categoryIndex(grouped, asked.category);
      const slice = paginateHelp(grouped[active]?.[1] ?? [], asked.page);

      const card = await renderSakuraHelpCard({
        // Written the way this person reached the bot, with the guild's own
        // prefix rather than the environment's.
        prefix: prefixFor(ctx, {
          prefix: (await options.settings?.forGuild(ctx.guildId))?.prefix ?? options.prefix,
          botName: options.botName,
        }),
        activeCategory: active,
        categories: grouped.map(([category, commands]) => ({
          title: CATEGORY_TITLES[category] ?? category,
          count: commands.length,
          icon: category,
        })),
        commands: slice.items.map(toHelpRow),
        page: slice.page,
        totalPages: slice.totalPages,
      });

      await ctx.reply({
        attachments: [{ name: cardFile('help'), data: card }],
        ...(options.helpComponents
          ? {
              components: options.helpComponents(
                grouped.map(([category]) => category),
                active,
                slice.page,
                slice.totalPages,
              ),
            }
          : {}),
      });
    },
  };

  return COMMAND_CATALOG.filter((meta) => executors[meta.name]).map((meta) => ({
    ...meta,
    execute: executors[meta.name] as Command['execute'],
  }));
}

/**
 * The `playlist` subcommand router.
 *
 * Every branch needs a name except `list`, so the check is made once here
 * rather than repeated — and an unknown action says what the options are
 * instead of failing silently.
 */
function playlistExecutor(playlists: PlaylistService, options: HandlerOptions): Command['execute'] {
  return async (ctx) => {
    const request = parsePlaylistRequest(ctx.args, (name) => ctx.option(name));

    if (request.action === 'list' || request.action === 'library') {
      const page = Number(request.name);
      await playlists.list(ctx, Number.isInteger(page) && page > 0 ? page : 1);
      return;
    }

    if (!request.name) {
      await ctx.reply({
        content: `Which playlist? Try \`${prefixFor(ctx, {
          prefix: options.prefix,
          botName: options.botName,
        })}playlist ${request.action} <name>\`.`,
        title: 'Playlist',
        icon: 'playlist',
        ephemeral: true,
      });
      return;
    }

    switch (request.action) {
      case 'create':
      case 'new':
        return playlists.create(ctx, request.name);
      case 'delete':
      case 'destroy':
        return playlists.delete(ctx, request.name);
      case 'add':
      case 'save':
        return playlists.addCurrent(ctx, request.name);
      case 'play':
      case 'load':
        return playlists.play(ctx, request.name);
      case 'public':
        return playlists.setVisibility(ctx, request.name, 'public');
      case 'private':
        return playlists.setVisibility(ctx, request.name, 'private');
      case 'remove':
      case 'rm': {
        if (request.position === undefined) {
          await ctx.reply({
            content: 'Which track? Give its number, e.g. `playlist remove Chill 3`.',
            title: 'Playlist',
            icon: 'playlist',
            ephemeral: true,
          });
          return;
        }
        return playlists.removeTrack(ctx, request.name, request.position);
      }
      default:
        await ctx.reply({
          content:
            'Playlist actions: `list`, `create`, `play`, `add`, `remove`, `delete`, `public`, `private`.',
          title: 'Playlist',
          icon: 'playlist',
          ephemeral: true,
        });
    }
  };
}

/** Commands in the catalog that have no implementation yet. */
export function unimplementedCommands(): CommandMeta[] {
  const implemented = new Set(buildCommands(FAKE_SERVICE, FAKE_OPTIONS).map((cmd) => cmd.name));
  return COMMAND_CATALOG.filter((meta) => !implemented.has(meta.name));
}

function toHelpRow(meta: CommandMeta) {
  const first = meta.options?.[0];
  return {
    name: meta.name,
    args: first?.required ? `<${first.name}>` : undefined,
    description: meta.description,
  };
}

function toLoopMode(raw: string | undefined): LoopMode | undefined {
  switch (raw) {
    case 'off':
      return 'off';
    case 'track':
    case 'song':
      return 'song';
    case 'queue':
      return 'queue';
    default:
      return undefined;
  }
}

/**
 * Stand-ins used only by {@link unimplementedCommands}.
 *
 * Building the command list is the single source of truth for what is wired up;
 * asking it with a dummy service avoids maintaining a second list by hand.
 */
const FAKE_SERVICE = {} as MusicService;
const FAKE_OPTIONS: HandlerOptions = {
  prefix: '!',
  botName: 'bot',
  playlists: {} as PlaylistService,
  settings: {} as SettingsService,
  lyrics: {} as LyricsService,
  stats: {} as StatsService,
  search: {} as SearchService,
};
