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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

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
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
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

  it('renders with nothing to show', async () => {
    const buffer = await renderSakuraHelpCard(data({ categories: [], commands: [] }));
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('survives degenerate input', async () => {
    const buffer = await renderSakuraHelpCard(
      data({
        activeCategory: 99,
        categories: [{ title: '', count: -4 }],
        commands: [{ name: '', description: '' }],
      }),
    );

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
