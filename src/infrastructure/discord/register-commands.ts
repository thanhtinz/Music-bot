import {
  ApplicationCommandOptionType,
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

import { createLogger } from '../../telemetry/logger';
import { COMMAND_CATALOG, type CommandMeta } from '../../commands/catalog';

const logger = createLogger('slash-registration');

/** Discord rejects command names that are not lowercase and 1-32 characters. */
function isValidName(name: string): boolean {
  return /^[\w-]{1,32}$/.test(name) && name === name.toLowerCase();
}

/**
 * Converts a catalog entry into a slash-command payload.
 *
 * Argument names match the catalog exactly, which is what lets a command read
 * `ctx.option('query')` regardless of whether it arrived by slash or by prefix.
 */
export function toSlashCommand(meta: CommandMeta): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: meta.name,
    description: meta.description.slice(0, 100),
    // Required options first: Discord rejects a command that lists an optional
    // one before a required one, and the catalog is written for readers rather
    // than for that rule.
    options: [...(meta.options ?? [])]
      .sort((left, right) => Number(Boolean(right.required)) - Number(Boolean(left.required)))
      .map((option) => {
        const shared = {
          name: option.name,
          description: option.description.slice(0, 100),
          required: Boolean(option.required),
        };

        return option.type === 'attachment'
          ? { ...shared, type: ApplicationCommandOptionType.Attachment as const }
          : { ...shared, type: ApplicationCommandOptionType.String as const };
      }),
  };
}

/** Every catalog command Discord will accept, as registration payloads. */
export function buildSlashCommands(
  catalog: readonly CommandMeta[] = COMMAND_CATALOG,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return catalog.filter((meta) => isValidName(meta.name)).map(toSlashCommand);
}

export interface RegistrationOptions {
  token: string;
  clientId: string;
  /**
   * Register to one guild instead of globally.
   *
   * Guild commands appear immediately; global ones can take an hour to
   * propagate, which makes them useless while developing.
   */
  guildId?: string;
  catalog?: readonly CommandMeta[];
}

/** Publishes the slash commands to Discord. */
export async function registerSlashCommands(options: RegistrationOptions): Promise<number> {
  const body = buildSlashCommands(options.catalog);
  const rest = new REST({ version: '10' }).setToken(options.token);

  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);

  await rest.put(route, { body });

  logger.info(
    { count: body.length, scope: options.guildId ? 'guild' : 'global' },
    'registered slash commands',
  );

  return body.length;
}
