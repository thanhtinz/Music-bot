import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Actions a component can carry back to the bot. */
export type ComponentAction =
  'previous' | 'playpause' | 'skip' | 'shuffle' | 'loop' | 'queue' | 'favorite' | 'stop' | 'page';

export interface ComponentId {
  action: ComponentAction;
  /** Extra argument, e.g. the page a pagination button targets. */
  arg?: string;
}

/** Namespace prefix, so foreign components are ignored rather than misread. */
const PREFIX = 'mb';
/** Discord's hard limit on a component's custom id. */
const MAX_CUSTOM_ID = 100;

/**
 * Encodes an action into a component custom id.
 *
 * Discord gives back nothing but this string when a button is pressed, so it
 * has to carry everything needed to act — while staying inside 100 characters.
 */
export function encodeComponentId(id: ComponentId): string {
  const encoded = [PREFIX, id.action, id.arg].filter((part) => part !== undefined).join(':');

  if (encoded.length > MAX_CUSTOM_ID) {
    throw new Error(`Component id too long: ${encoded.length} > ${MAX_CUSTOM_ID}`);
  }

  return encoded;
}

/** Decodes a custom id, or returns `null` when it is not one of ours. */
export function decodeComponentId(customId: string): ComponentId | null {
  const parts = customId.split(':');
  if (parts.length < 2 || parts[0] !== PREFIX) return null;

  const action = parts[1] as ComponentAction;
  if (!isComponentAction(action)) return null;

  const arg = parts.length > 2 ? parts.slice(2).join(':') : undefined;
  return arg === undefined ? { action } : { action, arg };
}

const ACTIONS: readonly ComponentAction[] = [
  'previous',
  'playpause',
  'skip',
  'shuffle',
  'loop',
  'queue',
  'favorite',
  'stop',
  'page',
];

function isComponentAction(value: string): value is ComponentAction {
  return (ACTIONS as readonly string[]).includes(value);
}

export interface NowPlayingControlsState {
  paused: boolean;
  /** Disables previous when there is no history to go back to. */
  hasPrevious: boolean;
  /** Disables skip and shuffle when nothing is queued behind the current track. */
  hasQueue: boolean;
  loop: 'off' | 'song' | 'queue';
}

/**
 * Transport row for the Now Playing panel (spec §4.4).
 *
 * Buttons that cannot do anything are disabled rather than hidden, so the row
 * keeps its shape as playback state changes (spec §35).
 */
export function buildNowPlayingControls(
  state: NowPlayingControlsState,
): ActionRowBuilder<ButtonBuilder>[] {
  const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'previous' }))
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!state.hasPrevious),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'playpause' }))
      .setEmoji(state.paused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'skip' }))
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!state.hasQueue),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'shuffle' }))
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!state.hasQueue),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'loop' }))
      .setEmoji('🔁')
      // A lit style is the only way to show loop is on without a text label.
      .setStyle(state.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
  );

  const secondary = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'queue' }))
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'favorite' }))
      .setEmoji('❤️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'stop' }))
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
  );

  return [transport, secondary];
}

/**
 * Pagination row for the queue card.
 *
 * The page each button targets is baked into its id, so a press needs no stored
 * state to know where it is going — the message can outlive a bot restart.
 */
export function buildQueuePagination(
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const total = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), total);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'page', arg: '1' }))
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === 1),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'page', arg: String(current - 1) }))
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current === 1),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'page', arg: String(current) }))
      .setLabel(`${current}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'page', arg: String(current + 1) }))
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current === total),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action: 'page', arg: String(total) }))
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === total),
  );

  return [row];
}

/** Serialised rows, for tests and for the dashboard's message previews. */
export function toJSON(rows: ActionRowBuilder<ButtonBuilder>[]) {
  return rows.map((row) => row.toJSON());
}
