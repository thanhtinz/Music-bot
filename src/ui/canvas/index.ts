import {
  renderNowPlayingCard as renderClassicNowPlayingCard,
  type NowPlayingCardData,
} from './cards/now-playing.card';
import { renderSakuraNowPlayingCard } from './cards/now-playing-sakura.card';
import { renderSakuraQueueCard } from './cards/queue-sakura.card';
import { renderQueueCard as renderClassicQueueCard, type QueueCardData } from './cards/queue.card';

/**
 * Renders the Now Playing panel in the style the caller asked for.
 *
 * Callers hand over player state and a variant name; which card module runs is
 * an implementation detail they do not need to know about.
 */
export async function renderNowPlayingCard(data: NowPlayingCardData): Promise<Buffer> {
  return data.variant === 'sakura'
    ? renderSakuraNowPlayingCard(data)
    : renderClassicNowPlayingCard(data);
}

/**
 * Renders the queue panel in the style the caller asked for.
 *
 * Note the variants page differently: the classic list holds
 * {@link QUEUE_PAGE_SIZE} rows, the illustrated one {@link QUEUE_SAKURA_PAGE_SIZE}.
 */
export async function renderQueueCard(data: QueueCardData): Promise<Buffer> {
  return data.variant === 'sakura' ? renderSakuraQueueCard(data) : renderClassicQueueCard(data);
}

export { renderClassicNowPlayingCard, renderSakuraNowPlayingCard };
export { NOW_PLAYING_CARD_SIZE } from './cards/now-playing.card';
export { SAKURA_TEMPLATE_SIZE } from './cards/now-playing-sakura.card';
export type { NowPlayingCardData, LoopMode } from './cards/now-playing.card';
export { renderClassicQueueCard, renderSakuraQueueCard };
export { queueCardHeight, QUEUE_PAGE_SIZE, QUEUE_CARD_WIDTH } from './cards/queue.card';
export {
  QUEUE_SAKURA_PAGE_SIZE,
  QUEUE_SAKURA_UPCOMING_PER_PAGE,
  QUEUE_SAKURA_TEMPLATE_SIZE,
  paginateSakuraQueue,
} from './cards/queue-sakura.card';
export type { QueuePageSlice } from './cards/queue-sakura.card';
export type { QueueCardData, QueueCardTrack } from './cards/queue.card';
export { renderHelpCard, HELP_CARD_WIDTH } from './cards/help.card';
export type { HelpCardData, HelpCardGroup, HelpCardCommand } from './cards/help.card';
export {
  renderSakuraHelpCard,
  HELP_SAKURA_TEMPLATE_SIZE,
  HELP_SAKURA_PAGE_SIZE,
  HELP_SAKURA_CATEGORY_SLOTS,
} from './cards/help-sakura.card';
export type {
  HelpSakuraCardData,
  HelpSakuraCategory,
  HelpSakuraCommand,
} from './cards/help-sakura.card';
export { drawGlyph, glyphFor } from './glyphs';
export type { GlyphName } from './glyphs';
export { THEMES, DEFAULT_THEME, resolveTheme } from './theme';
export type { CanvasTheme, ThemeName } from './theme';
export { registerFonts, font, UI_FONT } from './fonts';
export { formatDuration } from './primitives';
