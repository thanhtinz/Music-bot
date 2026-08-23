import {
  appendTrack,
  assertValidPlaylistName,
  createPlaylist,
  MAX_PLAYLISTS_PER_OWNER,
  playlistDurationMs,
  PlaylistError,
  removeTrackAt,
  setVisibility,
  toSavedTrack,
  toTrackInput,
  type Playlist,
  type PlaylistVisibility,
} from '../../domain/playlist';
import { createLogger } from '../../telemetry/logger';
import {
  PLAYLIST_SAKURA_PAGE_SIZE,
  renderSakuraPlaylistCard,
  type PlaylistCardEntry,
} from '../../ui/canvas';
import type { CommandContext } from '../commands';
import type { MusicService } from '../services/music.service';

import type { PlaylistRepository } from './playlist-repository';

const logger = createLogger('playlist-service');

export interface PlaylistServiceOptions {
  /** Guild prefix, shown in the card's hints. */
  prefix?: string;
  /** Resolves a display name for a user id. */
  displayName?: (userId: string) => string | undefined;
  /** Builds the button rows attached to a library card. */
  libraryComponents?: (page: number, totalPages: number) => unknown[];
}

/**
 * Saved playlists (spec §11).
 *
 * Every subcommand lands here, so the slash, prefix and button routes cannot
 * disagree about what `playlist add` means — the same rule the playback
 * commands follow.
 */
export class PlaylistService {
  constructor(
    private readonly repository: PlaylistRepository,
    private readonly music: MusicService,
    private readonly options: PlaylistServiceOptions = {},
  ) {}

  /** Renders one page of the caller's library. */
  async list(ctx: CommandContext, page = 1): Promise<void> {
    const playlists = await this.repository.listByOwner(ctx.guildId, ctx.userId);
    const totalPages = Math.max(1, Math.ceil(playlists.length / PLAYLIST_SAKURA_PAGE_SIZE));
    const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const start = (current - 1) * PLAYLIST_SAKURA_PAGE_SIZE;

    const entries: PlaylistCardEntry[] = playlists
      .slice(start, start + PLAYLIST_SAKURA_PAGE_SIZE)
      .map((playlist) => ({
        name: playlist.name,
        trackCount: playlist.tracks.length,
        totalDurationMs: playlistDurationMs(playlist),
        visibility: playlist.visibility,
      }));

    const card = await renderSakuraPlaylistCard({
      entries,
      ownerName: this.nameFor(ctx.userId),
      page: current,
      totalPages,
      totalCount: playlists.length,
      prefix: this.options.prefix,
    });

    await ctx.reply({
      attachments: [{ name: 'playlists.png', data: card }],
      components: this.options.libraryComponents?.(current, totalPages),
    });
  }

  async create(ctx: CommandContext, name: string): Promise<void> {
    try {
      const cleaned = assertValidPlaylistName(name);
      const existing = await this.repository.findByName(ctx.guildId, ctx.userId, cleaned);

      if (existing) {
        throw new PlaylistError(
          'duplicate-name',
          `You already have a playlist called **${cleaned}**.`,
        );
      }

      const owned = await this.repository.listByOwner(ctx.guildId, ctx.userId);
      if (owned.length >= MAX_PLAYLISTS_PER_OWNER) {
        throw new PlaylistError(
          'playlist-limit',
          `You are at the limit of ${MAX_PLAYLISTS_PER_OWNER} playlists. Delete one first.`,
        );
      }

      const playlist = createPlaylist({ guildId: ctx.guildId, ownerId: ctx.userId, name: cleaned });
      await this.repository.save(playlist);

      await ctx.reply({
        content: `Created **${playlist.name}**. Add the current track with \`${this.prefix}playlist add ${playlist.name}\`.`,
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'create');
    }
  }

  async delete(ctx: CommandContext, name: string): Promise<void> {
    try {
      const playlist = await this.mine(ctx, name);
      await this.repository.delete(playlist.id);

      await ctx.reply({
        content: `Deleted **${playlist.name}** and its ${playlist.tracks.length} track(s).`,
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'delete');
    }
  }

  /** Adds whatever is playing to a playlist, creating it if it is new. */
  async addCurrent(ctx: CommandContext, name: string): Promise<void> {
    try {
      const current = this.music.currentTrack(ctx.guildId);

      if (!current) {
        await ctx.reply({ content: 'Nothing is playing to add.', ephemeral: true });
        return;
      }

      const cleaned = assertValidPlaylistName(name);
      const existing = await this.repository.findByName(ctx.guildId, ctx.userId, cleaned);
      const playlist =
        existing ?? createPlaylist({ guildId: ctx.guildId, ownerId: ctx.userId, name: cleaned });

      const updated = appendTrack(playlist, toSavedTrack(current));
      await this.repository.save(updated);

      const note = existing ? '' : ' (new playlist)';
      await ctx.reply({
        content: `Added **${current.title}** to **${updated.name}**${note} — ${updated.tracks.length} track(s).`,
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'add');
    }
  }

  /** Removes one track by its 1-based position. */
  async removeTrack(ctx: CommandContext, name: string, position: number): Promise<void> {
    try {
      const playlist = await this.mine(ctx, name);
      const { playlist: updated, removed } = removeTrackAt(playlist, position);
      await this.repository.save(updated);

      await ctx.reply({
        content: `Removed **${removed.title}** from **${updated.name}** — ${updated.tracks.length} left.`,
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'remove');
    }
  }

  /** Queues every track in a playlist. */
  async play(ctx: CommandContext, name: string): Promise<void> {
    try {
      const playlist = await this.mine(ctx, name);

      if (playlist.tracks.length === 0) {
        await ctx.reply({ content: `**${playlist.name}** is empty.`, ephemeral: true });
        return;
      }

      const inputs = playlist.tracks.map((track) => toTrackInput(track, ctx.userId));
      await this.music.enqueueResolved(ctx, inputs, playlist.name);

      logger.info(
        { guildId: ctx.guildId, playlist: playlist.id, tracks: inputs.length },
        'queued a saved playlist',
      );
    } catch (error) {
      await this.replyWithError(ctx, error, 'play');
    }
  }

  async setVisibility(
    ctx: CommandContext,
    name: string,
    visibility: PlaylistVisibility,
  ): Promise<void> {
    try {
      const playlist = await this.mine(ctx, name);
      await this.repository.save(setVisibility(playlist, visibility));

      await ctx.reply({ content: `**${playlist.name}** is now **${visibility}**.` });
    } catch (error) {
      await this.replyWithError(ctx, error, 'visibility');
    }
  }

  /** Looks up one of the caller's own playlists, or explains why it cannot. */
  private async mine(ctx: CommandContext, name: string): Promise<Playlist> {
    const cleaned = assertValidPlaylistName(name);
    const playlist = await this.repository.findByName(ctx.guildId, ctx.userId, cleaned);

    if (!playlist) {
      throw new PlaylistError(
        'not-found',
        `You have no playlist called **${cleaned}**. See them with \`${this.prefix}playlist list\`.`,
      );
    }

    return playlist;
  }

  private get prefix(): string {
    return this.options.prefix ?? '/';
  }

  private nameFor(userId: string): string {
    return this.options.displayName?.(userId) ?? 'you';
  }

  private async replyWithError(ctx: CommandContext, error: unknown, action: string): Promise<void> {
    if (error instanceof PlaylistError) {
      await ctx.reply({ content: error.message, ephemeral: true });
      return;
    }

    logger.error({ err: error, guildId: ctx.guildId, action }, 'playlist command failed');
    await ctx.reply({ content: `Could not ${action} that playlist. Try again.`, ephemeral: true });
  }
}
