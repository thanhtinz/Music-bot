import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

/** Actions a component can carry back to the bot. */
export type ComponentAction =
  | 'previous'
  | 'playpause'
  | 'skip'
  | 'shuffle'
  | 'loop'
  | 'queue'
  | 'favorite'
  | 'stop'
  | 'page'
  | 'plpage'
  | 'lypage'
  | 'pick'
  | 'help'
  | 'mute'
  | 'volume';

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
  'plpage',
  'lypage',
  'pick',
  'help',
  'mute',
  'volume',
];

function isComponentAction(value: string): value is ComponentAction {
  return (ACTIONS as readonly string[]).includes(value);
}

export interface NowPlayingControlsState {
  paused: boolean;
  /** Disables previous when there is no history to go back to. */
  hasPrevious: boolean;
  /** Disables skip when nothing is queued behind the current track. */
  hasQueue: boolean;
  loop: 'off' | 'song' | 'queue';
  /** Current volume, shown on the picker. */
  volume?: number;
  /** Whether the player is muted rather than turned down. */
  muted?: boolean;
}

/**
 * The levels the volume picker offers.
 *
 * A short list of round numbers: anything finer is what the `volume` command
 * is for, and a menu of two hundred entries is not a control.
 */
export const VOLUME_STEPS = [10, 25, 50, 75, 100, 150, 200] as const;

/**
 * Transport row for the Now Playing panel (spec §4.4).
 *
 * Buttons that cannot do anything are disabled rather than hidden, so the row
 * keeps its shape as playback state changes (spec §35).
 */
export function buildNowPlayingControls(state: NowPlayingControlsState): ComponentRow[] {
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
      .setCustomId(encodeComponentId({ action: 'mute' }))
      .setEmoji(state.muted ? '🔇' : '🔊')
      .setStyle(state.muted ? ButtonStyle.Danger : ButtonStyle.Secondary),
  );

  return [transport, buildVolumePicker(state.volume ?? 100, state.muted ?? false)];
}

/**
 * The volume dropdown under the transport row.
 *
 * A picker rather than a pair of up/down buttons: setting a level takes one
 * press instead of six, and the placeholder can say where it is now — which a
 * button cannot.
 */
export function buildVolumePicker(
  volume: number,
  muted = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeComponentId({ action: 'volume' }))
    .setPlaceholder(muted ? 'Volume: muted' : `Volume: ${Math.round(volume)}%`)
    .addOptions(
      VOLUME_STEPS.map((step) => ({
        label: `${step}%`,
        value: String(step),
        // Marking the current one keeps the menu honest when it reopens.
        default: !muted && step === Math.round(volume),
      })),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
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
  return buildPagination('page', page, totalPages);
}

/**
 * Pagination row for the playlist library card.
 *
 * Its own action, so a press on a library card cannot be answered with a page
 * of the queue when both are on screen.
 */
export function buildPlaylistPagination(
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] {
  return buildPagination('plpage', page, totalPages);
}

/**
 * Category buttons under a help card.
 *
 * The card's sidebar lists every category; without these the only one anybody
 * could reach would be the first. The active one is disabled rather than
 * hidden, so the row keeps its shape as pages change (spec §35).
 */
export function buildHelpCategories(
  categories: string[],
  active: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Discord allows five buttons a row, and the catalog has more categories
  // than that.
  for (let start = 0; start < categories.length; start += 5) {
    const slice = categories.slice(start, start + 5);

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...slice.map((category, offset) =>
          new ButtonBuilder()
            // 1-based, so a button press and somebody typing `help 3` mean
            // the same thing.
            .setCustomId(encodeComponentId({ action: 'help', arg: String(start + offset + 1) }))
            .setLabel(label(category))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(start + offset === active),
        ),
      ),
    );
  }

  return rows;
}

/** Discord button labels are capped at 80 characters; a category never is. */
function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * The numbered pick buttons under a search card.
 *
 * One button per result, numbered as the card is: the row is the same list,
 * so a press cannot mean a position that is not on screen.
 */
export function buildSearchPicks(count: number): ActionRowBuilder<ButtonBuilder>[] {
  const capped = Math.max(0, Math.min(count, 5));
  if (capped === 0) return [];

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...Array.from({ length: capped }, (_, index) =>
      new ButtonBuilder()
        .setCustomId(encodeComponentId({ action: 'pick', arg: String(index + 1) }))
        .setLabel(String(index + 1))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return [row];
}

/** Pagination row for a page of lyrics, with its own action. */
export function buildLyricsPagination(
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] {
  return buildPagination('lypage', page, totalPages);
}

function buildPagination(
  action: ComponentAction,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const total = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), total);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action, arg: '1' }))
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === 1),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action, arg: String(current - 1) }))
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current === 1),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action, arg: String(current) }))
      .setLabel(`${current}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action, arg: String(current + 1) }))
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current === total),
    new ButtonBuilder()
      .setCustomId(encodeComponentId({ action, arg: String(total) }))
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === total),
  );

  return [row];
}

/** A row of either kind, since the Now Playing panel now carries both. */
export type ComponentRow =
  ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

/** Serialised rows, for tests and for the dashboard's message previews. */
export function toJSON(rows: ComponentRow[]) {
  return rows.map((row) => row.toJSON());
}
