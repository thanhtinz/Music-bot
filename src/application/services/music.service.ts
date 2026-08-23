import {
  AUTOPLAY_REQUESTER_ID,
  createTrack,
  type LoopMode,
  type Track,
  type TrackInput,
} from '../../domain/music';
import { addVoter, startVote, tally, type SkipVote } from '../../domain/vote';
import {
  describeResolverError,
  ResolverError,
  type ResolverRegistry,
  type TrackCandidate,
} from '../../resolvers';
import { createLogger } from '../../telemetry/logger';
import {
  paginateSakuraQueue,
  renderNowPlayingCard,
  renderQueueCard,
  type NowPlayingCardData,
} from '../../ui/canvas';
import { satisfiesTier, type CommandContext } from '../commands';
import type { Player, PlayerManager } from '../player';

const logger = createLogger('music-service');

export interface MusicServiceOptions {
  /** Card style used for every panel. */
  variant?: 'classic' | 'sakura';
  /** Theme name for the classic variant. */
  theme?: string;
  defaultVolume?: number;
  maxQueueSize?: number;
  /** Builds the button rows attached to a Now Playing panel. */
  nowPlayingComponents?: (player: Player) => unknown[];
  /** Builds the button rows attached to a queue panel. */
  queueComponents?: (page: number, totalPages: number) => unknown[];
  /**
   * The volume a guild's players should start at.
   *
   * Without it every guild starts at the environment's default, which would
   * make the `volume` setting a value nothing reads.
   */
  startingVolumeFor?: (guildId: string) => Promise<number | undefined>;
  /** Resolves a display name for a requester id. */
  displayName?: (userId: string) => string | undefined;
  /**
   * How many people are listening in the guild's voice channel.
   *
   * Undefined means the count is unknown — the vote then falls back to asking
   * one person, because refusing to skip on missing information would be worse
   * than skipping too easily.
   */
  listenerCount?: (guildId: string) => number | undefined;
  /**
   * Resolves a channel's name.
   *
   * Replies are drawn as images, where Discord's `<#id>` mention is only ever
   * literal text, so a card has to name the channel itself.
   */
  channelName?: (channelId: string) => string | undefined;
}

/**
 * The one place playback commands are implemented (spec §4.1).
 *
 * Slash, prefix, mention and button handlers all call these methods, so the
 * three interfaces cannot drift apart in behaviour — only in how they were
 * invoked.
 */
export class MusicService {
  /** In-flight skip votes, one per guild. */
  private readonly skipVotes = new Map<string, SkipVote>();

  constructor(
    private readonly players: PlayerManager,
    private readonly resolvers: ResolverRegistry,
    private readonly options: MusicServiceOptions = {},
  ) {}

  /**
   * Resolves input and starts or queues it.
   *
   * Runs under the guild lock so two people hitting play at once cannot
   * interleave a connect with an enqueue (spec §30).
   */
  async play(ctx: CommandContext, query: string): Promise<void> {
    await this.resolveAndQueue(ctx, query, 'end');
  }

  /**
   * The same, but at the front of the queue.
   *
   * Jumping the line is a DJ's privilege rather than a second way to play, so
   * the only difference here is where the track lands.
   */
  async playNext(ctx: CommandContext, query: string): Promise<void> {
    await this.resolveAndQueue(ctx, query, 'next');
  }

  private async resolveAndQueue(
    ctx: CommandContext,
    query: string,
    position: 'end' | 'next',
  ): Promise<void> {
    const player = await this.playerFor(ctx);

    try {
      const result = await this.resolvers.resolve(query, {
        maxPlaylistSize: this.options.maxQueueSize,
      });

      if (result.kind === 'empty') {
        await ctx.reply({
          content: 'No results for that.',
          title: 'No results',
          icon: 'search',
          ephemeral: true,
        });
        return;
      }

      if (result.kind === 'playlist') {
        const tracks = result.playlist.tracks.map((candidate) =>
          this.toTrack(candidate, ctx.userId),
        );
        const { started, added } = await this.players.withLock(ctx.guildId, () =>
          position === 'next' ? player.enqueueNext(tracks) : player.enqueue(tracks),
        );

        const suffix = result.playlist.truncated
          ? ` (capped at ${added} of ${result.playlist.totalCount})`
          : '';
        await ctx.reply({
          content: `Queued **${added}** tracks from **${result.playlist.name}**${suffix}${
            position === 'next' ? ', up next' : ''
          }.`,
          title: 'Playlist queued',
          icon: 'playlist',
        });

        if (started) await this.sendNowPlaying(ctx, player);
        return;
      }

      await this.enqueueCandidate(ctx, player, result.track, position);
    } catch (error) {
      await this.replyWithError(ctx, error, 'play');
    }
  }

  /**
   * Queues a track the caller has already picked out.
   *
   * The search command resolves its own candidates, but what happens to the
   * chosen one — connect, lock, enqueue, announce — must be what `play` does,
   * so it is this same path rather than a second copy of it.
   */
  async playCandidate(ctx: CommandContext, candidate: TrackCandidate): Promise<void> {
    try {
      const player = await this.playerFor(ctx);

      await this.enqueueCandidate(ctx, player, candidate);
    } catch (error) {
      await this.replyWithError(ctx, error, 'play');
    }
  }

  private async enqueueCandidate(
    ctx: CommandContext,
    player: Player,
    candidate: TrackCandidate,
    position: 'end' | 'next' = 'end',
  ): Promise<void> {
    const track = this.toTrack(candidate, ctx.userId);
    const { started } = await this.players.withLock(ctx.guildId, () =>
      position === 'next' ? player.enqueueNext(track) : player.enqueue(track),
    );

    if (started) {
      await this.sendNowPlaying(ctx, player);
    } else {
      await ctx.reply({
        content:
          position === 'next'
            ? `**${track.title}** is up next.`
            : `Added **${track.title}** to the queue.`,
        title: position === 'next' ? 'Up next' : 'Added to queue',
        icon: 'plus',
      });
    }
  }

  /**
   * Connects to the caller's voice channel without queueing anything.
   *
   * Also the way to move the bot: `getOrCreate` deliberately keeps an existing
   * session in its channel, because moving is an explicit act rather than a
   * side effect of someone in another channel running `play`.
   */
  async join(ctx: CommandContext): Promise<void> {
    if (!ctx.voiceChannelId) {
      await ctx.reply({
        content: 'Join a voice channel first, then ask me again.',
        title: 'Which channel?',
        icon: 'info',
        ephemeral: true,
      });
      return;
    }

    const existing = this.players.get(ctx.guildId);

    try {
      if (existing && existing.voiceChannelId !== ctx.voiceChannelId) {
        const from = existing.voiceChannelId;
        await this.players.withLock(ctx.guildId, () => existing.move(ctx.voiceChannelId!));
        existing.textChannelId = ctx.channelId;

        await ctx.reply({
          content: `Moved over to **${this.channelLabel(ctx.voiceChannelId)}**.`,
          title: 'Moved',
          icon: 'play',
        });
        logger.info({ guildId: ctx.guildId, from, to: ctx.voiceChannelId }, 'moved voice channel');
        return;
      }

      if (existing) {
        await ctx.reply({
          content: `Already in **${this.channelLabel(existing.voiceChannelId)}**.`,
          title: 'Already here',
          icon: 'info',
          tone: 'info',
          ephemeral: true,
        });
        return;
      }

      await this.playerFor(ctx, ctx.voiceChannelId);

      await ctx.reply({
        content: `Joined **${this.channelLabel(ctx.voiceChannelId)}**. Queue something with \`play\`.`,
        title: 'Joined',
        icon: 'play',
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'join');
    }
  }

  /** Disconnects and forgets the queue. */
  async leave(ctx: CommandContext): Promise<void> {
    const player = this.players.get(ctx.guildId);

    if (!player) {
      await ctx.reply({
        content: 'I am not in a voice channel.',
        title: 'Not connected',
        icon: 'info',
        ephemeral: true,
      });
      return;
    }

    const channelId = player.voiceChannelId;
    const abandoned = player.queue.size;
    await this.players.destroy(ctx.guildId);

    const note = abandoned > 0 ? ` **${abandoned}** queued track(s) went with it.` : '';
    await ctx.reply({
      content: `Left **${this.channelLabel(channelId)}**.${note}`,
      title: 'Left the channel',
      icon: 'stop',
    });
  }

  async pause(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.pause());
    await this.sendNowPlaying(ctx, player);
  }

  async resume(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.resume());
    await this.sendNowPlaying(ctx, player);
  }

  /** Toggles pause, for the single play/pause button. */
  async togglePause(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () =>
      player.status === 'paused' ? player.resume() : player.pause(),
    );
    await this.sendNowPlaying(ctx, player);
  }

  /**
   * Skips, or opens a vote to.
   *
   * A DJ skips outright, and so does whoever queued the track — it is theirs to
   * withdraw. Everybody else needs a majority of the room, so one person cannot
   * talk over everyone else's choice.
   */
  async skip(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const current = player.queue.current;
    const listeners = this.options.listenerCount?.(ctx.guildId) ?? 1;
    const canSkipOutright =
      satisfiesTier(ctx.tier, 'dj') || current?.requesterId === ctx.userId || listeners <= 1;

    if (current && !canSkipOutright) {
      const passed = this.recordSkipVote(ctx, current.id, listeners);

      if (!passed) {
        const vote = tally(this.skipVotes.get(ctx.guildId)!, listeners);
        await ctx.reply({
          content: `**${vote.votes}/${vote.required}** votes to skip **${current.title}**.`,
          title: 'Vote to skip',
          icon: 'skip',
          tone: 'info',
        });
        return;
      }
    }

    this.skipVotes.delete(ctx.guildId);
    const next = await this.players.withLock(ctx.guildId, () => player.skip());

    if (!next) {
      await ctx.reply({
        content: 'Nothing left to skip to — the queue is empty.',
        title: 'End of queue',
        icon: 'skip',
      });
      return;
    }

    await this.sendNowPlaying(ctx, player);
  }

  /** Records one vote, returning whether that carried it. */
  private recordSkipVote(ctx: CommandContext, trackId: string, listeners: number): boolean {
    const existing = this.skipVotes.get(ctx.guildId);
    // A vote belongs to the track it was opened on; a new song starts over.
    const vote = existing?.trackId === trackId ? existing : startVote(trackId, listeners);

    const updated = addVoter(vote, ctx.userId);
    this.skipVotes.set(ctx.guildId, updated);

    return tally(updated, listeners).passed;
  }

  async previous(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const previous = await this.players.withLock(ctx.guildId, () => player.previous());

    if (!previous) {
      await ctx.reply({
        content: 'Nothing played before this one.',
        title: 'No history',
        icon: 'previous',
        ephemeral: true,
      });
      return;
    }

    await this.sendNowPlaying(ctx, player);
  }

  async stop(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.destroy(ctx.guildId);
    await ctx.reply({
      content: 'Stopped playback and cleared the queue.',
      title: 'Stopped',
      icon: 'stop',
    });
  }

  async seek(ctx: CommandContext, positionMs: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.seek(positionMs));
    await this.sendNowPlaying(ctx, player);
  }

  async setVolume(ctx: CommandContext, volume: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const applied = await this.players.withLock(ctx.guildId, () => player.setVolume(volume));
    await ctx.reply({
      content: `Volume set to **${applied}%**.`,
      title: 'Volume',
      icon: 'volume',
    });
  }

  async setFilter(ctx: CommandContext, preset: string | undefined): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    try {
      await this.players.withLock(ctx.guildId, () => player.setFilter(preset));
      await ctx.reply({
        content: preset ? `Filter set to **${preset}**.` : 'Filters cleared.',
        title: 'Filters',
        icon: 'sliders',
      });
    } catch (error) {
      await this.replyWithError(ctx, error, 'filter');
    }
  }

  async shuffle(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.queue.shuffle());
    await ctx.reply({
      content: `Shuffled **${player.queue.size}** tracks.`,
      title: 'Shuffled',
      icon: 'shuffle',
    });
  }

  /** Cycles loop when no mode is given, so one button can drive it. */
  async setLoop(ctx: CommandContext, mode?: LoopMode): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const next = mode ?? nextLoopMode(player.loop);
    player.loop = next;

    await ctx.reply({ content: `Loop: **${LOOP_LABELS[next]}**.`, title: 'Loop', icon: 'loop' });
  }

  async setAutoplay(ctx: CommandContext, enabled?: boolean): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    player.autoplay = enabled ?? !player.autoplay;
    await ctx.reply({
      content: `Autoplay is now **${player.autoplay ? 'on' : 'off'}**.`,
      title: 'Autoplay',
      icon: 'shuffle',
    });
  }

  async clear(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const removed = await this.players.withLock(ctx.guildId, () => player.queue.clear());
    await ctx.reply({
      content: `Removed **${removed}** tracks from the queue.`,
      title: 'Queue cleared',
      icon: 'stop',
    });
  }

  /**
   * Removes one upcoming track.
   *
   * Anyone may take out what they queued themselves — withdrawing your own
   * request is not a moderation act — but taking out somebody else's is a DJ's
   * to make.
   */
  async remove(ctx: CommandContext, position: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const track = await this.trackAt(ctx, player, position);
    if (!track) return;

    if (track.requesterId !== ctx.userId && !satisfiesTier(ctx.tier, 'dj')) {
      await ctx.reply({
        content: `**${track.title}** was queued by someone else. Ask a DJ, or remove your own tracks.`,
        title: 'Not yours to remove',
        icon: 'warning',
        tone: 'warning',
        ephemeral: true,
      });
      return;
    }

    await this.players.withLock(ctx.guildId, () => player.queue.remove(position));
    await ctx.reply({
      content: `Removed **${track.title}** from the queue.`,
      title: 'Removed',
      icon: 'stop',
    });
  }

  /** Moves an upcoming track to another position, shifting the rest along. */
  async move(ctx: CommandContext, from: number, to: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const track = await this.trackAt(ctx, player, from);
    if (!track) return;
    if (!(await this.trackAt(ctx, player, to))) return;

    if (from === to) {
      await ctx.reply({
        content: `**${track.title}** is already at **${to}**.`,
        title: 'Nothing to do',
        icon: 'info',
        ephemeral: true,
      });
      return;
    }

    await this.players.withLock(ctx.guildId, () => player.queue.move(from, to));
    await ctx.reply({
      content: `Moved **${track.title}** to **${to}**.`,
      title: 'Moved',
      icon: 'queue',
    });
  }

  /**
   * Plays an upcoming track now, skipping what is in front of it.
   *
   * What it jumps over goes to the history rather than being dropped, so
   * `previous` can still reach it.
   */
  async jump(ctx: CommandContext, position: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    if (!(await this.trackAt(ctx, player, position))) return;

    const track = await this.players.withLock(ctx.guildId, () => player.jumpTo(position));
    logger.info({ guildId: ctx.guildId, position, track: track.title }, 'jumped in the queue');

    await this.sendNowPlaying(ctx, player);
  }

  /**
   * Drops everything the caller queued.
   *
   * Their own tracks only: the point is leaving without stranding the room
   * with forty songs nobody else picked, which needs no permission — and
   * clearing somebody else's is what `clear` is for.
   */
  async removeMine(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const removed = await this.players.withLock(ctx.guildId, () =>
      player.queue.removeByRequester(ctx.userId),
    );

    if (removed === 0) {
      await ctx.reply({
        content: 'You have nothing in the queue right now.',
        title: 'Nothing to remove',
        icon: 'queue',
        ephemeral: true,
      });
      return;
    }

    await ctx.reply({
      content: `Removed **${removed}** ${removed === 1 ? 'track' : 'tracks'} you queued.`,
      title: 'Removed yours',
      icon: 'stop',
    });
  }

  /**
   * The guild's player, made if it does not exist yet.
   *
   * Every path that might create one comes through here, so a guild's own
   * starting volume and queue size cannot apply on some commands and not
   * others.
   */
  private async playerFor(ctx: CommandContext, voiceChannelId?: string): Promise<Player> {
    const volume =
      (await this.options.startingVolumeFor?.(ctx.guildId).catch(() => undefined)) ??
      this.options.defaultVolume;

    return this.players.getOrCreate({
      guildId: ctx.guildId,
      voiceChannelId: voiceChannelId ?? ctx.voiceChannelId!,
      textChannelId: ctx.channelId,
      ...(volume === undefined ? {} : { volume }),
      ...(this.options.maxQueueSize === undefined
        ? {}
        : { maxQueueSize: this.options.maxQueueSize }),
    });
  }

  /**
   * The upcoming track at a 1-based position, or a complaint about the number.
   *
   * Every queue-editing command needs the same range check, and answering it
   * once here keeps them from disagreeing about what position 0 means.
   */
  private async trackAt(
    ctx: CommandContext,
    player: Player,
    position: number,
  ): Promise<Track | undefined> {
    const size = player.queue.size;

    if (!Number.isInteger(position) || position < 1 || position > size) {
      await ctx.reply({
        content: size
          ? `Pick a queue position from **1** to **${size}**.`
          : 'Nothing is queued behind the current track.',
        title: 'No such track',
        icon: 'queue',
        ephemeral: true,
      });
      return undefined;
    }

    return player.queue.at(position);
  }

  /** Renders the Now Playing panel on demand. */
  async nowPlaying(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.sendNowPlaying(ctx, player);
  }

  /** Renders one page of the queue. */
  async queue(ctx: CommandContext, page = 1): Promise<void> {
    const player = this.players.get(ctx.guildId);

    if (!player || player.queue.isEmpty) {
      await ctx.reply({
        content: 'The queue is empty. Add something with `play`.',
        title: 'Queue',
        icon: 'queue',
      });
      return;
    }

    const slice = paginateSakuraQueue(player.queue.tracks, page);
    const current = player.queue.current;

    const card = await renderQueueCard({
      current: current && {
        title: current.title,
        author: current.author,
        artworkUrl: current.artworkUrl,
        durationMs: current.durationMs,
        positionMs: player.positionMs,
        isStream: current.isStream,
        paused: player.status === 'paused',
      },
      tracks: slice.items.map((track, index) => ({
        position: slice.firstPosition + index + (current ? 1 : 0),
        title: track.title,
        author: track.author,
        durationMs: track.durationMs,
        isStream: track.isStream,
        requesterName: this.nameFor(track.requesterId),
        ...(track.requesterId === AUTOPLAY_REQUESTER_ID ? { autoplay: true } : {}),
      })),
      page: slice.page,
      totalPages: slice.totalPages,
      totalTracks: player.queue.size,
      totalDurationMs: player.queue.totalDurationMs,
      loop: player.loop,
      theme: this.options.theme,
      variant: this.options.variant,
    });

    await ctx.reply({
      attachments: [{ name: 'queue.png', data: card }],
      components: this.options.queueComponents?.(slice.page, slice.totalPages),
      edit: true,
    });
  }

  /** Renders and sends the Now Playing panel for a player. */
  async sendNowPlaying(ctx: CommandContext, player: Player): Promise<void> {
    const current = player.queue.current;

    if (!current) {
      await ctx.reply({ content: 'Nothing is playing right now.', ephemeral: true });
      return;
    }

    const card = await renderNowPlayingCard(this.toCardData(player, current));

    await ctx.reply({
      attachments: [{ name: 'now-playing.png', data: card }],
      components: this.options.nowPlayingComponents?.(player),
      edit: true,
    });
  }

  private toCardData(player: Player, current: Track): NowPlayingCardData {
    return {
      title: current.title,
      author: current.author,
      artworkUrl: current.artworkUrl,
      durationMs: current.durationMs,
      positionMs: player.positionMs,
      isStream: current.isStream,
      paused: player.status === 'paused',
      requesterName: this.nameFor(current.requesterId),
      volume: player.volume,
      loop: player.loop,
      autoplay: player.autoplay,
      queueLength: player.queue.size,
      filterPreset: player.snapshot().filterPreset,
      source: current.source,
      theme: this.options.theme,
      variant: this.options.variant,
    };
  }

  /**
   * Queues tracks that are already resolved.
   *
   * A saved playlist has nothing to look up — the tracks were resolved when
   * they were saved — so it enters the queue here rather than through
   * {@link play}, and still under the guild lock like every other mutation.
   */
  async enqueueResolved(ctx: CommandContext, inputs: TrackInput[], label: string): Promise<void> {
    if (inputs.length === 0) {
      await ctx.reply({
        content: `**${label}** has no tracks in it yet.`,
        title: 'Nothing to queue',
        icon: 'playlist',
        ephemeral: true,
      });
      return;
    }

    const player = await this.playerFor(ctx);

    try {
      const tracks = inputs.map((input) => createTrack(input));
      const { started, added } = await this.players.withLock(ctx.guildId, () =>
        player.enqueue(tracks),
      );

      const suffix = added < tracks.length ? ` (the queue took ${added} of ${tracks.length})` : '';
      await ctx.reply({
        content: `Queued **${added}** tracks from **${label}**${suffix}.`,
        title: 'Playlist queued',
        icon: 'playlist',
      });

      if (started) await this.sendNowPlaying(ctx, player);
    } catch (error) {
      await this.replyWithError(ctx, error, 'playlist play');
    }
  }

  /** The track playing right now, if there is one. */
  currentTrack(guildId: string): Track | undefined {
    return this.players.get(guildId)?.queue.current;
  }

  private toTrack(candidate: TrackCandidate, requesterId: string): Track {
    return createTrack({
      source: candidate.source,
      identifier: candidate.identifier,
      title: candidate.title,
      author: candidate.author,
      durationMs: candidate.durationMs,
      uri: candidate.uri,
      artworkUrl: candidate.artworkUrl,
      isStream: candidate.isStream,
      requesterId,
      metadata: candidate.metadata,
    });
  }

  /** Fetches the guild's player, replying when there is nothing to act on. */
  private require(ctx: CommandContext): Player | undefined {
    const player = this.players.get(ctx.guildId);
    if (player) return player;

    void ctx.reply({
      content: 'Nothing is playing right now.',
      title: 'Nothing playing',
      icon: 'note',
      ephemeral: true,
    });
    return undefined;
  }

  /** A channel's name, or a neutral phrase when it is not in cache. */
  private channelLabel(channelId: string): string {
    const name = this.options.channelName?.(channelId);
    return name ? `#${name}` : 'the voice channel';
  }

  private nameFor(userId: string): string {
    // A track the bot chose has no requester to name, and printing the marker
    // id on a card would read as somebody's account.
    if (userId === AUTOPLAY_REQUESTER_ID) return 'Autoplay';

    return this.options.displayName?.(userId) ?? userId;
  }

  /** Maps a failure onto a short, actionable message (spec §24, §35). */
  private async replyWithError(ctx: CommandContext, error: unknown, action: string): Promise<void> {
    if (!(error instanceof ResolverError)) {
      logger.error(
        { err: error, guildId: ctx.guildId, action, correlationId: ctx.correlationId },
        'music command failed',
      );
    }

    await ctx.reply({
      content: describeResolverError(error),
      title: 'That did not work',
      tone: 'error',
      ephemeral: true,
    });
  }
}

const LOOP_LABELS: Record<LoopMode, string> = {
  off: 'off',
  song: 'this track',
  queue: 'the queue',
};

/** Cycles off → track → queue → off, the order the loop button walks. */
function nextLoopMode(current: LoopMode): LoopMode {
  if (current === 'off') return 'song';
  if (current === 'song') return 'queue';
  return 'off';
}
