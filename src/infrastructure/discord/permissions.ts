import { PermissionFlagsBits, type GuildMember } from 'discord.js';

import type { PermissionTier } from '../../application/commands';

export interface GuildPermissionSettings {
  /** Role that grants DJ rights (spec §14.1). */
  djRoleId?: string;
  /** Discord user ids treated as bot owners. */
  botOwnerIds?: readonly string[];
  /**
   * Whether everyone counts as a DJ.
   *
   * Small servers usually want this: requiring a role there means one person
   * ends up doing all the skipping.
   */
  everyoneIsDj?: boolean;
}

/**
 * Works out the highest tier a member holds (spec §14.1).
 *
 * Tiers are derived from Discord state on every command rather than cached, so
 * removing someone's DJ role takes effect immediately.
 */
export function resolveTier(
  member: GuildMember,
  settings: GuildPermissionSettings = {},
): PermissionTier {
  if (settings.botOwnerIds?.includes(member.id)) return 'botOwner';
  if (member.guild.ownerId === member.id) return 'owner';

  if (member.permissions.has(PermissionFlagsBits.Administrator)) return 'admin';
  if (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    return 'moderator';
  }

  if (settings.everyoneIsDj) return 'dj';
  if (settings.djRoleId && member.roles.cache.has(settings.djRoleId)) return 'dj';

  return 'everyone';
}

/** Voice permissions the bot needs before it tries to join (spec §6.1). */
export const REQUIRED_VOICE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
] as const;

/**
 * Names the voice permissions the bot is missing in a channel.
 *
 * Checking up front turns a silent failure to join into a message naming
 * exactly what an admin has to grant (spec §24).
 */
export function missingVoicePermissions(botMember: GuildMember, channelId: string): string[] {
  const channel = botMember.guild.channels.cache.get(channelId);
  if (!channel) return ['View Channel'];

  const permissions = channel.permissionsFor(botMember);
  if (!permissions) return ['View Channel'];

  const names: Record<string, string> = {
    [String(PermissionFlagsBits.ViewChannel)]: 'View Channel',
    [String(PermissionFlagsBits.Connect)]: 'Connect',
    [String(PermissionFlagsBits.Speak)]: 'Speak',
  };

  return REQUIRED_VOICE_PERMISSIONS.filter((flag) => !permissions.has(flag)).map(
    (flag) => names[String(flag)] ?? 'Unknown',
  );
}
