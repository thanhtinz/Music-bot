import {
  appendTrack,
  appendTracks,
  assertValidPlaylistName,
  createPlaylist,
  FAVORITES_NAME,
  indexOfTrack,
  MAX_PLAYLISTS_PER_OWNER,
  MAX_TRACKS_PER_PLAYLIST,
  playlistDurationMs,
  PlaylistError,
  removeTrackAt,
  setVisibility,
  toSavedTrack,
  toTrackInput,
  type AppendedTracks,
  type Playlist,
  type PlaylistVisibility,
} from '../../domain/playlist';
import { createLogger } from '../../telemetry/logger';
import {
  cardFile,
  PLAYLIST_SAKURA_PAGE_SIZE,
  type PlaylistCardEntry,
  renderSakuraPlaylistCard,
} from '../../ui/canvas';
import { invocationPrefix, type CommandContext } from '../commands';
import type { MusicService } from '../services/music.service';

import type { PlaylistRepository } from './playlist-repository';

const logger = createLogger('playlist-service');

/** `1 track` / `2 tracks`, so a reply does not have to say "track(s)". */
function tracks(count: number): string {
  return count === 1 ? '1 track' : `${count} tracks`;
}

/**
 * What saving a queue actually did, in the two lines a notice card holds.
 *
 * Every outcome is worth saying: a save that skipped everything as duplicates
 * and a save that wrote nothing because the playlist is full look identical
 * from the outside, and "saved" would be a lie in both.
 */
function describeSave(result: AppendedTracks, existed: boolean): string {
  const { playlist, added, duplicates, dropped } = result;

  if (added === 0) {
    if (dropped > 0) {
      return `**${playlist.name}** is full at ${MAX_TRACKS_PER_PLAYLIST} tracks — nothing was added.`;
    }
    return `**${playlist.name}** already had all ${tracks(duplicates)}.`;
  }

  const notes: string[] = [];
  if (duplicates > 0) notes.push(`${duplicates} already there`);
  if (dropped > 0) notes.push(`${dropped} did not fit`);

  const tail = existed ? ` — ${tracks(playlist.tracks.length)} in it now` : ' — a new playlist';
  const skipped = notes.length > 0 ? ` (${notes.join(', ')})` : '';

  return `Saved ${tracks(added)} to **${playlist.name}**${tail}${skipped}.`;
}

export interface PlaylistServiceOptions {
  /** Guild prefix, shown in the card's hints. */
  prefix?: string;
  /**
   * That guild's own prefix, when it has set one.
   *
   * A hint telling people to type `!playlist` on a server using `?` is wrong
   * twice, so the card asks rather than assuming the environment's.
   */
  prefixFor?: (guildId: string) => Promise<string | undefined>;
  /** The bot's display name, for a card answering an `@Bot` invocation. */
  botName?: string;
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
      prefix: await this.prefixFor(ctx),
    });

    await ctx.reply({
      attachments: [{ name: cardFile('playlists'), data: card }],
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
        content: `Created **${playlist.name}**.`,
        title: 'Playlist created',
        icon: 'playlist',
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
        title: 'Playlist deleted',
        icon: 'playlist',
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
        await ctx.reply({
          content: 'Nothing is playing to add.',
          title: 'Nothing playing',
          icon: 'note',
          ephemeral: true,
        });
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
        title: 'Saved',
        icon: 'plus',
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'add');
    }
  }

  /**
   * Saves the whole queue — what is playing and everything waiting.
   *
   * `add` keeps one song; this keeps the evening. A room that has spent an hour
   * building a queue should not have to save it a track at a time, and the
   * alternative people reach for otherwise is leaving the bot connected so the
   * queue survives.
   */
  async saveQueue(ctx: CommandContext, name: string): Promise<void> {
    try {
      const tracks = this.music.sessionTracks(ctx.guildId);

      if (tracks.length === 0) {
        await ctx.reply({
          content: 'The queue is empty, so there is nothing to save.',
          title: 'Nothing queued',
          icon: 'note',
          ephemeral: true,
        });
        return;
      }

      const cleaned = assertValidPlaylistName(name);
      const existing = await this.repository.findByName(ctx.guildId, ctx.userId, cleaned);

      if (!existing) {
        const owned = await this.repository.listByOwner(ctx.guildId, ctx.userId);
        if (owned.length >= MAX_PLAYLISTS_PER_OWNER) {
          throw new PlaylistError(
            'playlist-limit',
            `You are at the limit of ${MAX_PLAYLISTS_PER_OWNER} playlists. Delete one first.`,
          );
        }
      }

      const playlist =
        existing ?? createPlaylist({ guildId: ctx.guildId, ownerId: ctx.userId, name: cleaned });

      const result = appendTracks(playlist, tracks.map(toSavedTrack));
      await this.repository.save(result.playlist);

      await ctx.reply({
        content: describeSave(result, existing !== undefined),
        title: result.added > 0 ? 'Queue saved' : 'Nothing to save',
        icon: 'playlist',
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'save the queue');
    }
  }

  /**
   * Adds the current track to Favorites, or takes it out if it is already in.
   *
   * A toggle rather than an add, because that is what a heart button means —
   * and the same method backs the button and the command, so the two cannot
   * disagree about what pressing it does.
   */
  async toggleFavorite(ctx: CommandContext): Promise<void> {
    try {
      const current = this.music.currentTrack(ctx.guildId);

      if (!current) {
        await ctx.reply({
          content: 'Nothing is playing to save.',
          title: 'Nothing playing',
          icon: 'note',
          ephemeral: true,
        });
        return;
      }

      const saved = toSavedTrack(current);
      const existing = await this.repository.findByName(ctx.guildId, ctx.userId, FAVORITES_NAME);
      const at = existing ? indexOfTrack(existing, saved) : -1;

      if (existing && at >= 0) {
        const { playlist } = removeTrackAt(existing, at + 1);
        await this.repository.save(playlist);

        await ctx.reply({
          content: `Took **${current.title}** out of your favorites — ${playlist.tracks.length} left.`,
          title: 'Unfavorited',
          icon: 'heart',
          tone: 'info',
        });
        return;
      }

      const playlist = appendTrack(
        existing ??
          createPlaylist({ guildId: ctx.guildId, ownerId: ctx.userId, name: FAVORITES_NAME }),
        saved,
      );
      await this.repository.save(playlist);

      await ctx.reply({
        content: `Saved **${current.title}** to your favorites — ${playlist.tracks.length} track(s).`,
        title: 'Favorited',
        icon: 'heart',
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'favorite');
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
        title: 'Removed',
        icon: 'playlist',
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
        await ctx.reply({
          content: `**${playlist.name}** is empty.`,
          title: 'Nothing to queue',
          icon: 'playlist',
          ephemeral: true,
        });
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

      await ctx.reply({
        content: `**${playlist.name}** is now **${visibility}**.`,
        title: 'Visibility',
        icon: 'gear',
      });
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
        `You have no playlist called **${cleaned}**. See them with \`${await this.prefixFor(ctx)}playlist list\`.`,
      );
    }

    return playlist;
  }

  /**
   * How to spell a command back to whoever ran it.
   *
   * The guild's own prefix when they typed one, `/` for a slash command, and
   * `@Bot ` for a mention: a hint they cannot type is not a hint.
   */
  private async prefixFor(ctx: CommandContext): Promise<string> {
    const guild = await this.options.prefixFor?.(ctx.guildId).catch(() => undefined);

    return invocationPrefix(ctx.sourceType, {
      prefix: guild ?? this.options.prefix ?? '!',
      ...(this.options.botName === undefined ? {} : { botName: this.options.botName }),
    });
  }

  private nameFor(userId: string): string {
    return this.options.displayName?.(userId) ?? 'you';
  }

  private async replyWithError(ctx: CommandContext, error: unknown, action: string): Promise<void> {
    if (error instanceof PlaylistError) {
      await ctx.reply({
        content: error.message,
        title: 'Playlist',
        icon: 'playlist',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

    logger.error({ err: error, guildId: ctx.guildId, action }, 'playlist command failed');
    await ctx.reply({
      content: `Could not ${action} that playlist. Try again.`,
      title: 'That did not work',
      tone: 'error',
      ephemeral: true,
    });
  }
}
