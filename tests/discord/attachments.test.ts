import { describe, expect, it, vi } from 'vitest';

import type { Command, CommandContext, ReplyPayload } from '../../src/application/commands';
import { PlayerManager } from '../../src/application/player';
import { MusicService } from '../../src/application/services/music.service';
import { COMMAND_CATALOG } from '../../src/commands/catalog';
import { buildCommands, playRequest } from '../../src/commands/handlers';
import { ResolverRegistry } from '../../src/resolvers';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';
import {
  createInteractionContext,
  createMessageContext,
} from '../../src/infrastructure/discord/context';
import { toSlashCommand } from '../../src/infrastructure/discord/register-commands';

const UPLOAD = 'https://cdn.discordapp.com/attachments/1/2/song.mp3';

/** The `play` command as the router builds it, options and all. */
function playCommand(): Command {
  const meta = COMMAND_CATALOG.find((entry) => entry.name === 'play')!;
  return { ...meta, execute: async () => undefined } as Command;
}

function interaction(options: {
  attachment?: { url: string };
  value?: string;
}): Parameters<typeof createInteractionContext>[0] {
  return {
    guildId: 'guild',
    channelId: 'text',
    id: 'interaction',
    commandName: 'play',
    user: { id: 'user' },
    deferred: false,
    replied: false,
    options: {
      get: (name: string) => {
        if (name === 'file') return options.attachment ? { attachment: options.attachment } : null;
        if (name === 'query') return options.value ? { value: options.value } : null;
        return null;
      },
    },
  } as unknown as Parameters<typeof createInteractionContext>[0];
}

function message(attachments: { url: string }[]): Parameters<typeof createMessageContext>[0] {
  return {
    guildId: 'guild',
    channelId: 'text',
    id: 'message',
    author: { id: 'user' },
    attachments: { first: () => attachments[0] },
    channel: { isSendable: () => false },
    reply: vi.fn(),
  } as unknown as Parameters<typeof createMessageContext>[0];
}

describe('an upload attached to a slash command', () => {
  it('registers as an attachment option, not as text', () => {
    const payload = toSlashCommand(COMMAND_CATALOG.find((entry) => entry.name === 'play')!);
    const file = payload.options?.find((option) => option.name === 'file');

    // 11 is ApplicationCommandOptionType.Attachment.
    expect(file).toMatchObject({ type: 11, required: false });
  });

  it('lists required options before optional ones, as Discord insists', () => {
    for (const meta of COMMAND_CATALOG) {
      const options = toSlashCommand(meta).options ?? [];
      const lastRequired = options.map((option) => Boolean(option.required)).lastIndexOf(true);
      const firstOptional = options.map((option) => Boolean(option.required)).indexOf(false);

      if (lastRequired >= 0 && firstOptional >= 0) {
        expect(firstOptional).toBeGreaterThan(lastRequired);
      }
    }
  });

  it('hands the command the file’s URL rather than Discord’s id for it', () => {
    const ctx = createInteractionContext(interaction({ attachment: { url: UPLOAD } }), {
      tier: 'dj',
    });

    expect(ctx.option('file')).toBe(UPLOAD);
  });

  it('still reads a text option as text', () => {
    const ctx = createInteractionContext(interaction({ value: 'chăm hoa' }), { tier: 'dj' });

    expect(ctx.option('query')).toBe('chăm hoa');
  });
});

describe('an upload attached to a typed command', () => {
  const parsed = { name: 'play', args: [], rest: '', source: 'prefix' as const };

  it('lands under the option name the command declared for it', () => {
    const ctx = createMessageContext(message([{ url: UPLOAD }]), parsed, playCommand(), {
      tier: 'dj',
    });

    expect(ctx.option('file')).toBe(UPLOAD);
  });

  it('is nothing at all when no file came with the message', () => {
    const ctx = createMessageContext(message([]), parsed, playCommand(), { tier: 'dj' });

    expect(ctx.option('file')).toBeUndefined();
  });

  it('is left alone on a command that takes no file', () => {
    const skip = COMMAND_CATALOG.find((entry) => entry.name === 'skip')!;
    const ctx = createMessageContext(
      message([{ url: UPLOAD }]),
      { ...parsed, name: 'skip' },
      { ...skip, execute: async () => undefined } as Command,
      { tier: 'dj' },
    );

    expect(ctx.option('file')).toBeUndefined();
  });
});

describe('a play with nothing to play', () => {
  it('asks for something instead of searching for nothing', async () => {
    // The router used to catch this, and cannot any more: the text is optional
    // now, because a file on its own is a complete instruction.
    const players = new PlayerManager(new FakeAudioBackend(), {});
    const service = new MusicService(players, new ResolverRegistry(), {});
    const commands = buildCommands(service, { prefix: '!', botName: 'MusicBot' });
    const play = commands.find((command) => command.name === 'play')!;

    const replies: ReplyPayload[] = [];
    const ctx = {
      guildId: 'guild',
      channelId: 'text',
      userId: 'user',
      voiceChannelId: 'voice',
      commandName: 'play',
      args: [],
      rest: '',
      sourceType: 'prefix',
      tier: 'dj',
      correlationId: 'corr',
      async reply(payload: ReplyPayload) {
        replies.push(payload);
      },
      async defer() {},
      option: () => undefined,
    } as unknown as CommandContext;

    await play.execute(ctx);

    expect(replies.at(-1)?.content).toContain('!play <song>');
    expect(replies.at(-1)?.ephemeral).toBe(true);
    // Nothing was connected to, and nothing was queued.
    expect(players.has('guild')).toBe(false);
  });
});

describe('choosing between an upload and words', () => {
  const ctx = (file: string | undefined, query: string, rest = '') => ({
    option: (name: string) => (name === 'file' ? file : query || undefined),
    rest,
  });

  it('plays the file when there is one', () => {
    expect(playRequest(ctx(UPLOAD, ''))).toBe(UPLOAD);
  });

  it('prefers the file over words typed alongside it', () => {
    // Attaching is the more deliberate act, and the one the person can see.
    expect(playRequest(ctx(UPLOAD, 'something else'))).toBe(UPLOAD);
  });

  it('plays the words when there is no file', () => {
    expect(playRequest(ctx(undefined, 'chăm hoa'))).toBe('chăm hoa');
  });

  it('falls back to the rest of a typed line', () => {
    expect(playRequest({ option: () => undefined, rest: 'chăm hoa mono' })).toBe('chăm hoa mono');
  });

  it('is nothing when there is neither', () => {
    expect(playRequest(ctx(undefined, ''))).toBeUndefined();
    expect(playRequest(ctx('   ', '   ', '   '))).toBeUndefined();
  });
});
