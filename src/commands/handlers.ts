import type { Command } from '../application/commands';
import type { MusicService } from '../application/services/music.service';
import type { LoopMode } from '../domain/music';
import { isFilterPreset } from '../infrastructure/lavalink/filters';
import { parseTimeToSeconds } from '../resolvers';
import { renderSakuraHelpCard } from '../ui/canvas';

import { catalogByCategory, COMMAND_CATALOG, type CommandMeta } from './catalog';

export interface HandlerOptions {
  /** Prefix shown on the help card. */
  prefix: string;
  botName: string;
}

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
  const executors: Record<string, Command['execute']> = {
    play: async (ctx) => service.play(ctx, ctx.option('query') ?? ctx.rest),
    pause: async (ctx) => service.pause(ctx),
    resume: async (ctx) => service.resume(ctx),
    skip: async (ctx) => service.skip(ctx),
    previous: async (ctx) => service.previous(ctx),
    stop: async (ctx) => service.stop(ctx),
    clear: async (ctx) => service.clear(ctx),
    shuffle: async (ctx) => service.shuffle(ctx),
    nowplaying: async (ctx) => service.nowPlaying(ctx),

    seek: async (ctx) => {
      const raw = ctx.option('position') ?? '';
      const seconds = parseTimeToSeconds(raw);

      if (seconds <= 0) {
        await ctx.reply({
          content: 'Give me a position like `90`, `1:30` or `1m30s`.',
          ephemeral: true,
        });
        return;
      }

      await service.seek(ctx, seconds * 1000);
    },

    volume: async (ctx) => {
      const raw = ctx.option('level');
      if (raw === undefined) {
        await service.nowPlaying(ctx);
        return;
      }

      const level = Number(raw);
      if (!Number.isFinite(level)) {
        await ctx.reply({ content: 'Volume has to be a number, 0-200.', ephemeral: true });
        return;
      }

      await service.setVolume(ctx, level);
    },

    loop: async (ctx) => {
      const raw = ctx.option('mode')?.toLowerCase();
      const mode = toLoopMode(raw);

      if (raw && !mode) {
        await ctx.reply({ content: 'Loop mode is `off`, `track` or `queue`.', ephemeral: true });
        return;
      }

      await service.setLoop(ctx, mode);
    },

    autoplay: async (ctx) => service.setAutoplay(ctx),

    queue: async (ctx) => {
      const action = ctx.option('action');
      const page = Number(action);
      await service.queue(ctx, Number.isFinite(page) && page > 0 ? page : 1);
    },

    filter: async (ctx) => {
      const preset = ctx.option('preset')?.toLowerCase();

      if (preset && !isFilterPreset(preset)) {
        await ctx.reply({
          content: 'Unknown filter. Try `bass`, `nightcore`, `vaporwave`, `chill` or `party`.',
          ephemeral: true,
        });
        return;
      }

      await service.setFilter(ctx, preset);
    },

    help: async (ctx) => {
      const grouped = [...catalogByCategory()];
      const card = await renderSakuraHelpCard({
        prefix: ctx.sourceType === 'slash' ? '/' : options.prefix,
        activeCategory: 0,
        categories: grouped.map(([category, commands]) => ({
          title: CATEGORY_TITLES[category] ?? category,
          count: commands.length,
          icon: category,
        })),
        commands: (grouped[0]?.[1] ?? []).map(toHelpRow),
      });

      await ctx.reply({ attachments: [{ name: 'help.png', data: card }] });
    },
  };

  return COMMAND_CATALOG.filter((meta) => executors[meta.name]).map((meta) => ({
    ...meta,
    execute: executors[meta.name] as Command['execute'],
  }));
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
const FAKE_OPTIONS: HandlerOptions = { prefix: '!', botName: 'bot' };
