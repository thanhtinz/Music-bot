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
  cardFile,
  HISTORY_SAKURA_ROWS,
  type NowPlayingCardData,
  paginateSakuraQueue,
  renderNowPlayingCard,
  renderQueueCard,
  renderSakuraHistoryCard,
} from '../../ui/canvas';
import { satisfiesTier, type CommandContext, type ReplyHandle } from '../commands';
import { formatSleepRemaining, lineFor, MAX_SLEEP_MS, parseSleepRequest } from '../player';
import type { Player, PlayerManager, ProgressTicker, SleepPlan, SleepTimer } from '../player';

const logger = createLogger('music-service');

/** How a timer that is already running reads in a reply. */
function describeSleepPlan(plan: SleepPlan): string {
  return plan.kind === 'track'
    ? 'I will stop once the current track finishes.'
    : `Sleeping in **${formatSleepRemaining(plan.remainingMs)}**.`;
}

/** `1 track` / `2 tracks`, so a reply does not have to say "track(s)". */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

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
   * Keeps the progress line above a panel moving.
   *
   * Optional, so a service built for a test or the preview harness sends a
   * panel without starting a timer nothing will ever stop.
   */
  progress?: Pick<ProgressTicker, 'watch' | 'stop'>;
  /**
   * The guild sleep timers.
   *
   * Optional for the same reason: a service built for a preview or a test
   * should not start a countdown nothing will ever cancel. Without it `sleep`
   * says the timer is not running rather than pretending it set one.
   */
  sleep?: Pick<SleepTimer, 'set' | 'setAfterTrack' | 'cancel' | 'plan'>;
  /**
   * The volume a guild's players should start at.
   *
   * Without it every guild starts at the environment's default, which would
   * make the `volume` setting a value nothing reads.
   */
  startingVolumeFor?: (guildId: string) => Promise<number | undefined>;
  /** Resolves a display name for a requester id. */
  displayName?: (userId: string) => string | undefined;
  /** Resolves a guild's name, for a card header. */
  guildName?: (guildId: string) => string | undefined;
  /**
   * How many people are listening in the guild's voice channel.
   *
   * Undefined means the count is unknown — the vote then falls back to asking
   * one person, because refusing to skip on missing information would be worse
   * than skipping too easily.
   */
  listenerCount?: (guildId: string) => number | undefined;
  /**
   * Who is in the guild's voice channel right now.
   *
   * Undefined means the channel cannot be read, which `leavecleanup` treats as
   * a refusal rather than as an empty room: guessing would throw away the queue
   * of everybody present.
   */
  listenerIds?: (guildId: string) => ReadonlySet<string> | undefined;
  /**
   * Resolves a channel's name.
   *
   * Replies are drawn as images, where Discord's `<#id>` mention is only ever
   * literal text, so a card has to name the channel itself.
   */
  channelName?: (channelId: string) => string | undefined;
  /**
   * Sends somebody a private message, reporting whether it arrived.
   *
   * A closed DM is the ordinary case rather than an error — plenty of people
   * have them off — so it comes back as `false` and `grab` says so, instead of
   * being thrown at the command.
   */
  directMessage?: (
    userId: string,
    payload: { content: string; attachments?: { name: string; data: Buffer }[] },
  ) => Promise<boolean>;
  /**
   * Posts a panel into a channel nobody's command is waiting on.
   *
   * A track starting by itself has no interaction to reply to, so this is the
   * one path that sends rather than answers. The handle comes back so the
   * progress line on that panel can keep moving.
   */
  announce?: (
    channelId: string,
    payload: {
      content: string;
      attachments: { name: string; data: Buffer }[];
      components?: unknown[];
    },
  ) => Promise<ReplyHandle | undefined>;
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
      icon: 'exit',
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

  /**
   * Sets, reads or clears the guild's sleep timer.
   *
   * One command rather than three, because that is how people ask for it:
   * `sleep 30`, `sleep track`, `sleep off`, and a bare `sleep` to check what
   * they set before dozing off.
   */
  async sleep(ctx: CommandContext, raw: string | undefined): Promise<void> {
    const timer = this.options.sleep;

    if (!timer) {
      await ctx.reply({
        content: 'The sleep timer is not running on this bot.',
        title: 'Sleep timer',
        icon: 'clock',
        ephemeral: true,
      });
      return;
    }

    const request = parseSleepRequest(raw);

    switch (request.kind) {
      case 'invalid':
        await ctx.reply({
          content: 'Try `sleep 30`, `sleep 1h30m`, `sleep track` or `sleep off`.',
          title: 'Sleep timer',
          icon: 'clock',
          ephemeral: true,
        });
        return;

      case 'too-short':
        await ctx.reply({
          content: 'That is barely a timer. Use `stop` if you want the music off now.',
          title: 'Sleep timer',
          icon: 'clock',
          ephemeral: true,
        });
        return;

      case 'too-long':
        await ctx.reply({
          content: `A sleep timer runs for at most **${formatSleepRemaining(MAX_SLEEP_MS)}**.`,
          title: 'Sleep timer',
          icon: 'clock',
          ephemeral: true,
        });
        return;

      case 'status': {
        const plan = timer.plan(ctx.guildId);
        await ctx.reply({
          content: plan
            ? describeSleepPlan(plan)
            : 'No sleep timer is set. Set one with `sleep 30`.',
          title: 'Sleep timer',
          icon: 'clock',
          ephemeral: true,
        });
        return;
      }

      case 'cancel':
        await ctx.reply(
          timer.cancel(ctx.guildId)
            ? {
                content: 'Sleep timer cancelled — the music keeps going.',
                title: 'Sleep timer',
                icon: 'clock',
              }
            : {
                content: 'There was no sleep timer to cancel.',
                title: 'Sleep timer',
                icon: 'clock',
                ephemeral: true,
              },
        );
        return;

      case 'track': {
        const player = this.require(ctx);
        if (!player) return;

        const current = player.queue.current;
        if (!current) {
          await ctx.reply({
            content: 'Nothing is playing, so there is no track to stop after.',
            title: 'Sleep timer',
            icon: 'clock',
            ephemeral: true,
          });
          return;
        }

        timer.setAfterTrack(ctx.guildId);
        await ctx.reply({
          content: `I will stop once **${current.title}** finishes.`,
          title: 'Sleep timer set',
          icon: 'clock',
        });
        return;
      }

      case 'after': {
        const player = this.require(ctx);
        if (!player) return;

        timer.set(ctx.guildId, request.ms);
        await ctx.reply({
          content: `Sleeping in **${formatSleepRemaining(request.ms)}** — I will stop the music and leave.`,
          title: 'Sleep timer set',
          icon: 'clock',
        });
      }
    }
  }

  async seek(ctx: CommandContext, positionMs: number): Promise<void> {
    const player = this.require(ctx);
    if (!player || !(await this.refuseUnseekable(ctx, player))) return;

    await this.players.withLock(ctx.guildId, () => player.seek(positionMs));
    await this.sendNowPlaying(ctx, player);
  }

  /**
   * Jumps forward or back from wherever the track is now.
   *
   * Relative rather than absolute, because that is the ask: somebody who wants
   * to hear the last ten seconds again should not have to read the clock, do
   * the subtraction and type the answer.
   */
  async nudge(ctx: CommandContext, deltaMs: number): Promise<void> {
    const player = this.require(ctx);
    if (!player || !(await this.refuseUnseekable(ctx, player))) return;

    // Clamped by the player against the track's own length, so jumping ten
    // seconds past the end lands on the end rather than off it.
    await this.players.withLock(ctx.guildId, () => player.seek(player.positionMs + deltaMs));
    await this.sendNowPlaying(ctx, player);
  }

  /** Starts the current track again from the top. */
  async replay(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player || !(await this.refuseUnseekable(ctx, player))) return;

    await this.players.withLock(ctx.guildId, () => player.seek(0));
    await this.sendNowPlaying(ctx, player);
  }

  /**
   * Whether the current track can be seeked, saying why when it cannot.
   *
   * A live stream has no position to jump to, and the player quietly ignores
   * the attempt — so without this the panel would be redrawn unchanged and
   * whoever asked would be left guessing.
   */
  private async refuseUnseekable(ctx: CommandContext, player: Player): Promise<boolean> {
    const current = player.queue.current;

    if (!current) {
      await ctx.reply({ content: 'Nothing is playing right now.', ephemeral: true });
      return false;
    }

    if (current.isStream) {
      await ctx.reply({
        content: 'This is a live stream — there is no position to jump to.',
        title: 'Seek',
        icon: 'clock',
        ephemeral: true,
      });
      return false;
    }

    return true;
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

  /**
   * The volume picker under the Now Playing panel.
   *
   * Redraws the panel rather than answering with a notice: the picker's
   * placeholder is where the level is shown, so leaving it stale would have the
   * menu claim a volume the player is no longer at — and a room of six should
   * not get six "volume changed" cards while one person finds their level.
   */
  async pickVolume(ctx: CommandContext, volume: number): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.setVolume(volume));
    await this.sendNowPlaying(ctx, player);
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
      icon: 'trash',
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
      icon: 'trash',
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
      icon: 'trash',
    });
  }

  /**
   * Drops repeats, keeping the earliest copy of each track.
   *
   * A long playlist queued twice, or a room where three people added the same
   * song, leaves a queue that plays the same thing over and over — and finding
   * each repeat by eye and removing it by position is a job nobody does.
   */
  async removeDuplicates(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const removed = await this.players.withLock(ctx.guildId, () => player.queue.removeDuplicates());

    if (removed.length === 0) {
      await ctx.reply({
        content: 'No duplicates in the queue.',
        title: 'Nothing to clean up',
        icon: 'queue',
        ephemeral: true,
      });
      return;
    }

    logger.info({ guildId: ctx.guildId, removed: removed.length }, 'removed duplicate tracks');

    await ctx.reply({
      content: `Removed **${removed.length}** duplicate ${plural(removed.length, 'track')}, keeping the first of each.`,
      title: 'Duplicates removed',
      icon: 'broom',
    });
  }

  /**
   * Drops tracks queued by people who have left the voice channel.
   *
   * For the room that has emptied out with an hour of somebody else's queue
   * still in it. Needs the listener list to be readable — without it there is
   * no way to tell who left from who is simply quiet, and guessing would throw
   * away the queue of everybody present.
   */
  async removeAbsent(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    const present = this.options.listenerIds?.(ctx.guildId);

    if (!present) {
      await ctx.reply({
        content: 'I cannot see who is in the channel right now, so I left the queue alone.',
        title: 'Cleanup',
        icon: 'queue',
        ephemeral: true,
      });
      return;
    }

    const removed = await this.players.withLock(ctx.guildId, () =>
      player.queue.removeAbsent(present),
    );

    if (removed.length === 0) {
      await ctx.reply({
        content: 'Everything queued belongs to somebody still here.',
        title: 'Nothing to clean up',
        icon: 'queue',
        ephemeral: true,
      });
      return;
    }

    logger.info(
      { guildId: ctx.guildId, removed: removed.length },
      'removed tracks of absent users',
    );

    await ctx.reply({
      content: `Removed **${removed.length}** ${plural(removed.length, 'track')} queued by people who left.`,
      title: 'Cleaned up',
      icon: 'broom',
    });
  }

  /**
   * Sends whoever asked a copy of what is playing, privately.
   *
   * The card goes in the message so the song is recognisable at a glance in a
   * DM full of them, and the link goes in the text, where it can be tapped —
   * a link drawn into an image is a link nobody can follow.
   */
  async grab(ctx: CommandContext): Promise<void> {
    const player = this.players.get(ctx.guildId);
    const current = player?.queue.current;

    if (!player || !current) {
      await ctx.reply({
        content: 'Nothing is playing right now.',
        title: 'Nothing to save',
        icon: 'note',
        ephemeral: true,
      });
      return;
    }

    if (!this.options.directMessage) {
      await ctx.reply({
        content: 'I cannot send private messages here.',
        title: 'Grab',
        icon: 'warning',
        ephemeral: true,
      });
      return;
    }

    const card = await renderNowPlayingCard(this.toCardData(player, current));
    const where = this.options.guildName?.(ctx.guildId);

    const delivered = await this.options.directMessage(ctx.userId, {
      content: [
        `**${current.title}** — ${current.author}`,
        current.uri,
        where ? `_Playing in ${where}_` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      attachments: [{ name: cardFile('now-playing'), data: card }],
    });

    await ctx.reply({
      content: delivered
        ? `Sent **${current.title}** to your messages.`
        : 'I could not message you. Your direct messages may be closed.',
      title: delivered ? 'Saved' : 'Could not send',
      icon: delivered ? 'heart' : 'warning',
      // Private either way: a room does not need to watch somebody save a song.
      ephemeral: true,
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

  /**
   * Silences the player, or puts it back where it was.
   *
   * A mute remembers the level rather than assuming one: a room that had it at
   * 30 should not come back at 100 because a button was pressed twice.
   */
  async toggleMute(ctx: CommandContext): Promise<void> {
    const player = this.require(ctx);
    if (!player) return;

    await this.players.withLock(ctx.guildId, () => player.toggleMute());

    // The panel is where a mute is visible — the speaker button and the
    // picker's placeholder both change — so it is redrawn rather than answered
    // with a notice that would cover it.
    await this.sendNowPlaying(ctx, player);
  }

  /**
   * What the room has already heard, newest first.
   *
   * The history is kept so `previous` can walk back through it; this is the
   * same list, shown rather than stepped through — usually because somebody
   * wants the name of a song that has already ended.
   */
  async history(ctx: CommandContext): Promise<void> {
    const player = this.players.get(ctx.guildId);
    const played = player ? [...player.queue.history].reverse() : [];

    const card = await renderSakuraHistoryCard({
      entries: played.slice(0, HISTORY_SAKURA_ROWS).map((track) => ({
        title: track.title,
        author: track.author,
        durationMs: track.durationMs,
        requesterName: this.nameFor(track.requesterId),
        ...(track.isStream ? { isStream: true } : {}),
      })),
      totalCount: played.length,
      ...(this.options.guildName?.(ctx.guildId) === undefined
        ? {}
        : { guildName: this.options.guildName(ctx.guildId) }),
    });

    await ctx.reply({ attachments: [{ name: cardFile('history'), data: card }] });
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
      attachments: [{ name: cardFile('queue'), data: card }],
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

    const handle = await ctx.reply({
      // The bar lives in the message text, above the card. That is what lets it
      // move without the image being redrawn: an edit that changes only the
      // text leaves the attachment alone, so the panel does not blink.
      content: lineFor(player),
      attachments: [{ name: cardFile('now-playing'), data: card }],
      components: this.options.nowPlayingComponents?.(player),
      edit: true,
    });

    this.options.progress?.watch(player, handle);
  }

  /**
   * Announces a track that started on its own, in the channel the player
   * belongs to.
   *
   * Nobody asked for this one, so it is a fresh message rather than an edit of
   * a reply that belongs to some earlier command — and the ticker adopts it,
   * because this panel is the one on screen now.
   */
  async announceTrack(player: Player): Promise<void> {
    const current = player.queue.current;
    const channelId = player.textChannelId;
    if (!current || !channelId || !this.options.announce) return;

    const card = await renderNowPlayingCard(this.toCardData(player, current));

    const handle = await this.options.announce(channelId, {
      content: lineFor(player),
      attachments: [{ name: cardFile('now-playing'), data: card }],
      components: this.options.nowPlayingComponents?.(player),
    });

    this.options.progress?.watch(player, handle);
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

  /**
   * Everything the guild has lined up: what is playing, then what is waiting.
   *
   * The order a listener would hear them in, because that is the order somebody
   * saving the session wants it back in. History is left out — a playlist of
   * what has already been played is a different thing, and `history` is where
   * that lives.
   */
  sessionTracks(guildId: string): readonly Track[] {
    const player = this.players.get(guildId);
    if (!player) return [];

    const current = player.queue.current;
    return current ? [current, ...player.queue.tracks] : [...player.queue.tracks];
  }

  /**
   * How far into that track the guild is, or `undefined` when nothing plays.
   *
   * Read rather than exposed as a player, so a lyrics card can open on the line
   * being sung without the service that draws it holding a player it could
   * mutate.
   */
  currentPositionMs(guildId: string): number | undefined {
    const player = this.players.get(guildId);
    if (!player?.queue.current) return undefined;

    return player.positionMs;
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
