import type { CommandCategory, CommandOption } from '../application/commands';
import type { PermissionTier } from '../application/commands';

/**
 * Declaration of a command's public surface, without its implementation.
 *
 * The catalog is the single source of truth for the command matrix (spec §5):
 * slash registration, the help card, and the prefix/mention registry all read
 * from it, so the three interfaces cannot drift apart.
 */
export interface CommandMeta {
  name: string;
  description: string;
  category: CommandCategory;
  aliases?: string[];
  options?: CommandOption[];
  tier?: PermissionTier;
  cooldownMs?: number;
  requiresVoice?: boolean;
  deferred?: boolean;
}

const QUERY: CommandOption = {
  name: 'query',
  description: 'Search terms or a URL',
  required: true,
  rest: true,
};

export const COMMAND_CATALOG: readonly CommandMeta[] = [
  {
    name: 'play',
    description: 'Play a track or add it to the queue',
    category: 'playback',
    aliases: ['p'],
    options: [QUERY],
    requiresVoice: true,
    deferred: true,
  },
  {
    name: 'search',
    description: 'Search, then pick what to play',
    category: 'playback',
    aliases: ['find', 'sr'],
    options: [QUERY],
    requiresVoice: true,
    deferred: true,
  },
  {
    name: 'pause',
    description: 'Pause playback',
    category: 'playback',
    requiresVoice: true,
  },
  {
    name: 'resume',
    description: 'Resume playback',
    category: 'playback',
    aliases: ['unpause'],
    requiresVoice: true,
  },
  {
    name: 'skip',
    description: 'Skip the current track, or vote to',
    category: 'playback',
    aliases: ['s', 'next', 'voteskip', 'vs'],
    cooldownMs: 2_000,
    requiresVoice: true,
  },
  {
    name: 'previous',
    description: 'Go back to the previous track',
    category: 'playback',
    aliases: ['prev', 'back'],
    tier: 'dj',
    requiresVoice: true,
  },
  {
    name: 'stop',
    description: 'Stop playback and clear the queue',
    category: 'playback',
    tier: 'dj',
    requiresVoice: true,
  },
  {
    name: 'seek',
    description: 'Jump to a position in the current track',
    category: 'playback',
    options: [{ name: 'position', description: 'e.g. 1:30', required: true }],
    tier: 'dj',
    requiresVoice: true,
  },
  {
    name: 'volume',
    description: 'Show or set the playback volume',
    category: 'playback',
    aliases: ['vol'],
    options: [{ name: 'level', description: '0-200' }],
    tier: 'dj',
  },
  {
    name: 'nowplaying',
    description: 'Show the Now Playing panel',
    category: 'playback',
    aliases: ['np'],
  },
  {
    name: 'join',
    description: 'Join your voice channel',
    category: 'playback',
    aliases: ['summon', 'connect'],
    requiresVoice: true,
    deferred: true,
  },
  {
    name: 'leave',
    description: 'Leave the voice channel and clear the queue',
    category: 'playback',
    aliases: ['disconnect', 'dc'],
    tier: 'dj',
    deferred: true,
  },

  {
    name: 'queue',
    description: 'Show the queue, or add and remove tracks',
    category: 'queue',
    aliases: ['q'],
    options: [{ name: 'action', description: 'add | remove | page number' }],
  },
  {
    name: 'remove',
    description: 'Take one track out of the queue',
    category: 'queue',
    aliases: ['rm', 'delete'],
    options: [{ name: 'position', description: 'Queue position', required: true }],
  },
  {
    name: 'move',
    description: 'Move a queued track to another position',
    category: 'queue',
    aliases: ['mv'],
    options: [
      { name: 'from', description: 'Queue position', required: true },
      { name: 'to', description: 'Where it should go', required: true },
    ],
    tier: 'dj',
  },
  {
    name: 'jump',
    description: 'Play a queued track now, skipping past the rest',
    category: 'queue',
    aliases: ['skipto', 'jumpto'],
    options: [{ name: 'position', description: 'Queue position', required: true }],
    tier: 'dj',
    requiresVoice: true,
  },
  {
    name: 'shuffle',
    description: 'Shuffle the upcoming tracks',
    category: 'queue',
    tier: 'dj',
  },
  {
    name: 'loop',
    description: 'Cycle loop mode: off, track, queue',
    category: 'queue',
    aliases: ['repeat'],
    options: [{ name: 'mode', description: 'off | track | queue' }],
    tier: 'dj',
  },
  {
    name: 'autoplay',
    description: 'Keep playing related tracks when the queue runs out',
    category: 'queue',
    tier: 'dj',
  },
  {
    name: 'clear',
    description: 'Remove every upcoming track',
    category: 'queue',
    tier: 'dj',
  },

  {
    name: 'playlist',
    description: 'Create, edit, and play saved playlists',
    category: 'playlist',
    aliases: ['pl'],
    options: [
      {
        name: 'action',
        description: 'list | create | play | add | remove | delete | public | private',
      },
      { name: 'name', description: 'Playlist name', rest: true },
      { name: 'position', description: 'Track number, for remove' },
    ],
    deferred: true,
  },
  {
    name: 'favorite',
    description: 'Save the current track to your library',
    category: 'playlist',
    aliases: ['fav'],
  },
  {
    name: 'lyrics',
    description: 'Show lyrics for the current track or a search',
    category: 'playlist',
    options: [{ name: 'query', description: 'Track name', rest: true }],
    deferred: true,
  },

  {
    name: 'filter',
    description: 'Apply an audio filter preset',
    category: 'filters',
    options: [{ name: 'preset', description: 'bass | nightcore | vaporwave | chill | party' }],
    tier: 'dj',
    requiresVoice: true,
  },

  {
    name: '247',
    description: 'Keep the bot connected around the clock',
    category: 'settings',
    options: [{ name: 'state', description: 'on | off' }],
    tier: 'moderator',
  },
  {
    name: 'settings',
    description: 'View and change guild music settings',
    category: 'settings',
    aliases: ['config'],
    options: [
      { name: 'key', description: 'Setting name' },
      { name: 'value', description: 'New value', rest: true },
    ],
    tier: 'moderator',
  },

  {
    name: 'stats',
    description: 'What you listen to; add a name, or `server`',
    category: 'general',
    aliases: ['activity', 'top'],
    options: [{ name: 'target', description: 'server, or someone to look up' }],
    deferred: true,
  },
  {
    name: 'help',
    description: 'Show every command',
    category: 'general',
    aliases: ['h', 'commands'],
  },
];

/** Groups the catalog by category, preserving declaration order. */
export function catalogByCategory(): Map<CommandCategory, CommandMeta[]> {
  const grouped = new Map<CommandCategory, CommandMeta[]>();

  for (const meta of COMMAND_CATALOG) {
    const bucket = grouped.get(meta.category);
    if (bucket) bucket.push(meta);
    else grouped.set(meta.category, [meta]);
  }

  return grouped;
}
