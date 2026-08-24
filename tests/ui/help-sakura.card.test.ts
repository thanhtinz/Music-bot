import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  HELP_SAKURA_CATEGORY_SLOTS,
  HELP_SAKURA_PAGE_SIZE,
  HELP_SAKURA_TEMPLATE_SIZE,
  renderSakuraHelpCard,
  type HelpSakuraCardData,
  type HelpSakuraCommand,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

function commands(count: number): HelpSakuraCommand[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `cmd${index}`,
    description: `Does thing ${index}`,
  }));
}

function data(overrides: Partial<HelpSakuraCardData> = {}): HelpSakuraCardData {
  return {
    prefix: '/',
    activeCategory: 0,
    categories: [
      { title: 'Music', count: 8 },
      { title: 'Queue', count: 5 },
      { title: 'Playlist', count: 4 },
    ],
    commands: [
      { name: 'play', args: '<song>', description: 'Play a song', usage: 'play keyword or url' },
      { name: 'pause', description: 'Pause the music' },
      { name: 'skip', description: 'Skip the current song' },
    ],
    ...overrides,
  };
}

describe('renderSakuraHelpCard', () => {
  it('renders a PNG at the template size', async () => {
    const buffer = await renderSakuraHelpCard(data());
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(HELP_SAKURA_TEMPLATE_SIZE.width);
    expect(image.height).toBe(HELP_SAKURA_TEMPLATE_SIZE.height);
  });

  it('moves the highlight to the active category', async () => {
    const [first, third] = await Promise.all([
      renderSakuraHelpCard(data({ activeCategory: 0 })),
      renderSakuraHelpCard(data({ activeCategory: 2 })),
    ]);

    expect(first.equals(third)).toBe(false);
  });

  it('renders the guild prefix everywhere it appears', async () => {
    const [slash, bang] = await Promise.all([
      renderSakuraHelpCard(data({ prefix: '/' })),
      renderSakuraHelpCard(data({ prefix: '!' })),
    ]);

    expect(slash.equals(bang)).toBe(false);
  });

  it('clears sidebar slots the catalog does not fill', async () => {
    const [few, many] = await Promise.all([
      renderSakuraHelpCard(data({ categories: [{ title: 'Music', count: 8 }] })),
      renderSakuraHelpCard(data()),
    ]);

    expect(few.equals(many)).toBe(false);
  });

  it('ignores categories past the sidebar slots', async () => {
    const categories = Array.from({ length: HELP_SAKURA_CATEGORY_SLOTS + 4 }, (_, index) => ({
      title: `Cat${index}`,
      count: index,
    }));

    const buffer = await renderSakuraHelpCard(data({ categories }));
    expectCardImage(buffer);
  });

  it('has room for the longest hint a required argument needs', async () => {
    // `?remove <position>` was sixteen pixels over and the hint was dropped —
    // on the one command whose argument is not optional, so the card asked for
    // a number without ever saying so. The picture is the only place that
    // shows; this fails if the row stops fitting again.
    const row = { name: 'remove', description: 'Take one track out of the queue' };
    const [withHint, without] = await Promise.all([
      renderSakuraHelpCard(data({ prefix: '?', commands: [{ ...row, args: '<position>' }] })),
      renderSakuraHelpCard(data({ prefix: '?', commands: [row] })),
    ]);

    expect(withHint.equals(without)).toBe(false);
  });

  it('drops a hint that genuinely cannot fit, rather than overlapping', async () => {
    // A mention prefix leaves a few pixels; there is nothing to draw there, and
    // running into the description would be worse than saying nothing.
    const row = { name: 'remove', description: 'Take one track out of the queue' };
    const [withHint, without] = await Promise.all([
      renderSakuraHelpCard(
        data({ prefix: '@Melody ', commands: [{ ...row, args: '<position>' }] }),
      ),
      renderSakuraHelpCard(data({ prefix: '@Melody ', commands: [row] })),
    ]);

    expect(withHint.equals(without)).toBe(true);
  });

  it('caps rows at the page size', async () => {
    const [exact, overflowing] = await Promise.all([
      renderSakuraHelpCard(data({ commands: commands(HELP_SAKURA_PAGE_SIZE) })),
      renderSakuraHelpCard(data({ commands: commands(HELP_SAKURA_PAGE_SIZE + 6) })),
    ]);

    expect(exact.equals(overflowing)).toBe(true);
  });

  it('clears the rows a short page does not fill', async () => {
    const [full, short] = await Promise.all([
      renderSakuraHelpCard(data({ commands: commands(HELP_SAKURA_PAGE_SIZE) })),
      renderSakuraHelpCard(data({ commands: commands(2) })),
    ]);

    expect(full.equals(short)).toBe(false);
  });

  it('draws a per-command icon rather than reusing one', async () => {
    const [play, pause] = await Promise.all([
      renderSakuraHelpCard(data({ commands: [{ name: 'play', description: 'x' }] })),
      renderSakuraHelpCard(data({ commands: [{ name: 'pause', description: 'x' }] })),
    ]);

    expect(play.equals(pause)).toBe(false);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraHelpCard(data()),
      renderSakuraHelpCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('marks which page of a category it is showing', async () => {
    const first = await renderSakuraHelpCard(data({ page: 1, totalPages: 2 }));
    const second = await renderSakuraHelpCard(data({ page: 2, totalPages: 2 }));

    expect(first.equals(second)).toBe(false);
  });

  it('says nothing about pages when a category fits on one card', async () => {
    // `Page 1/1` is a question raised for no reason.
    const plain = await renderSakuraHelpCard(data());
    const single = await renderSakuraHelpCard(data({ page: 1, totalPages: 1 }));

    expect(plain.equals(single)).toBe(true);
  });

  it('renders with nothing to show', async () => {
    const buffer = await renderSakuraHelpCard(data({ categories: [], commands: [] }));
    expectCardImage(buffer);
  });

  it('survives degenerate input', async () => {
    const buffer = await renderSakuraHelpCard(
      data({
        activeCategory: 99,
        categories: [{ title: '', count: -4 }],
        commands: [{ name: '', description: '' }],
      }),
    );

    expectCardImage(buffer);
  });
});
