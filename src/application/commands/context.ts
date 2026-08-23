import type { SourceType } from './parser';

/** Permission tiers evaluated per guild (spec §14.1). */
export type PermissionTier = 'everyone' | 'dj' | 'moderator' | 'admin' | 'owner' | 'botOwner';

export interface ReplyAttachment {
  name: string;
  data: Buffer;
}

/**
 * A reply the application layer wants to send.
 *
 * Deliberately framework-neutral: it carries content, canvas attachments, and
 * intent flags, and the Discord adapter turns that into an interaction reply or
 * a channel message.
 */
export interface ReplyPayload {
  content?: string;
  /**
   * Headline for the card a text reply is drawn onto.
   *
   * Only read when the reply is rendered as a notice panel; a command that
   * says nothing here still gets a sensible heading from its tone.
   */
  title?: string;
  /** Glyph key for that card, e.g. `volume`. */
  icon?: string;
  /** How the notice should read; defaults by whether the reply is ephemeral. */
  tone?: 'success' | 'info' | 'warning' | 'error';
  attachments?: ReplyAttachment[];
  /** Only the invoking user should see this (settings, private errors). */
  ephemeral?: boolean;
  /** Edit the existing reply instead of sending a new message. */
  edit?: boolean;
  /**
   * Interactive components to attach.
   *
   * Deliberately untyped here: buttons are a Discord concept, and typing them
   * would drag discord.js into the application layer. The Discord adapter is
   * the only thing that looks inside.
   */
  components?: unknown[];
}

/**
 * Everything a command needs to know about its invocation.
 *
 * Slash, prefix, and mention all produce this same object, which is what lets
 * one application service back all three interfaces (spec §4.1).
 */
export interface CommandContext {
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
  /** Voice channel the invoking user is in, if any. */
  readonly voiceChannelId?: string;
  readonly commandName: string;
  readonly args: readonly string[];
  /** Raw text after the command name — used for search queries. */
  readonly rest: string;
  readonly sourceType: SourceType;
  /** Highest tier the invoking member holds in this guild. */
  readonly tier: PermissionTier;
  /** Correlation id threaded through logs and metrics (spec §23.2). */
  readonly correlationId: string;

  reply(payload: ReplyPayload): Promise<void>;
  /** Acknowledges early when resolving may take a while (spec §35). */
  defer(ephemeral?: boolean): Promise<void>;
  /** Named option value; slash options and positional args resolve the same way. */
  option(name: string): string | undefined;
}

/** Ordering used when checking whether a member meets a required tier. */
const TIER_RANK: Record<PermissionTier, number> = {
  everyone: 0,
  dj: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
  botOwner: 5,
};

/** True when `held` satisfies `required`. */
export function satisfiesTier(held: PermissionTier, required: PermissionTier): boolean {
  return TIER_RANK[held] >= TIER_RANK[required];
}
