import {
  renderNowPlayingCard as renderClassicNowPlayingCard,
  type NowPlayingCardData,
} from './cards/now-playing.card';
import { renderSakuraNowPlayingCard } from './cards/now-playing-sakura.card';

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

export { renderClassicNowPlayingCard, renderSakuraNowPlayingCard };
export { NOW_PLAYING_CARD_SIZE } from './cards/now-playing.card';
export { SAKURA_TEMPLATE_SIZE } from './cards/now-playing-sakura.card';
export type { NowPlayingCardData, LoopMode } from './cards/now-playing.card';
export {
  renderQueueCard,
  queueCardHeight,
  QUEUE_PAGE_SIZE,
  QUEUE_CARD_WIDTH,
} from './cards/queue.card';
export type { QueueCardData, QueueCardTrack } from './cards/queue.card';
export { renderHelpCard, HELP_CARD_WIDTH } from './cards/help.card';
export type { HelpCardData, HelpCardGroup, HelpCardCommand } from './cards/help.card';
export { THEMES, DEFAULT_THEME, resolveTheme } from './theme';
export type { CanvasTheme, ThemeName } from './theme';
export { registerFonts, font, UI_FONT } from './fonts';
export { formatDuration } from './primitives';
