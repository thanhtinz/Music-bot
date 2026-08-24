/**
 * The permissions the bot is asked for, one bit at a time.
 *
 * Written out rather than as one magic number, because an invite link is the
 * first thing an admin reads about a bot and the only honest way to keep the
 * list minimal is to make each entry justify itself. Discord shows these as
 * tick boxes; anything here that is not used is a permission somebody grants
 * for nothing.
 */
export const REQUIRED_PERMISSIONS = {
  /** To see the channel a command was typed in. */
  ViewChannel: 1n << 10n,
  /** To answer at all. */
  SendMessages: 1n << 11n,
  /** To read back the message a button was attached to. */
  ReadMessageHistory: 1n << 16n,
  /** Every reply is a rendered image, so this one is not optional. */
  AttachFiles: 1n << 15n,
  /** Link previews on the few replies that carry a URL. */
  EmbedLinks: 1n << 14n,
  /** To join the voice channel. */
  Connect: 1n << 20n,
  /** To play anything once there. */
  Speak: 1n << 21n,
  /** Without it the bot is muted in servers that default to push-to-talk. */
  UseVAD: 1n << 25n,
} as const;

/**
 * What the bot is not asked for, and why.
 *
 * Kept as a list rather than as an absence so that adding one later is a
 * deliberate act with a reason attached, and so the website can say what the
 * bot deliberately cannot do.
 */
export const DECLINED_PERMISSIONS: readonly { name: string; why: string }[] = [
  { name: 'Manage Messages', why: 'it never deletes anybody else’s messages' },
  { name: 'Mention Everyone', why: 'nothing it says needs to ping a server' },
  { name: 'Manage Roles', why: 'the DJ role is read, never assigned' },
  { name: 'Administrator', why: 'no bot needs this, and one that asks should be refused' },
];

/** The permission integer Discord expects, summed from the bits above. */
export function permissionBits(): bigint {
  return Object.values(REQUIRED_PERMISSIONS).reduce((total, bit) => total | bit, 0n);
}

export interface InviteOptions {
  clientId: string;
  /** Overrides the computed set; for an operator who wants a narrower invite. */
  permissions?: bigint;
}

/**
 * The OAuth2 URL that adds the bot to a server.
 *
 * `applications.commands` alongside `bot`, or the slash commands register and
 * then appear for nobody — the scope is what makes them visible, and an invite
 * missing it produces a bot that answers only to typed commands with no sign of
 * why.
 */
export function inviteUrl(options: InviteOptions): string {
  const url = new URL('https://discord.com/oauth2/authorize');

  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', String(options.permissions ?? permissionBits()));

  return url.toString();
}
