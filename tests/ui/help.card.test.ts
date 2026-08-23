import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { HELP_CARD_WIDTH, renderHelpCard, type HelpCardData } from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCALE = 2;

function data(overrides: Partial<HelpCardData> = {}): HelpCardData {
  return {
    groups: [
      {
        title: 'Playback',
        commands: [
          { name: 'play', description: 'Play a track', aliases: ['p'] },
          { name: 'skip', description: 'Skip the current track' },
        ],
      },
    ],
    prefix: '!',
    botName: 'MusicBot',
    ...overrides,
  };
}

describe('renderHelpCard', () => {
  it('renders a PNG at the declared width', async () => {
    const buffer = await renderHelpCard(data());
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const image = await loadImage(buffer);
    expect(image.width).toBe(HELP_CARD_WIDTH * SCALE);
  });

  it('grows taller as groups are added', async () => {
    const small = await loadImage(await renderHelpCard(data()));
    const large = await loadImage(
      await renderHelpCard(
        data({
          groups: Array.from({ length: 6 }, (_, index) => ({
            title: `Group ${index}`,
            commands: Array.from({ length: 4 }, (_, i) => ({
              name: `cmd${i}`,
              description: 'Does a thing',
            })),
          })),
        }),
      ),
    );

    expect(large.height).toBeGreaterThan(small.height);
  });

  it('balances groups across two columns', async () => {
    // Two identical groups should sit side by side, not stack, so the card is
    // no taller than a single group plus chrome.
    const one = await loadImage(await renderHelpCard(data()));
    const two = await loadImage(
      await renderHelpCard(
        data({ groups: [data().groups[0]!, { ...data().groups[0]!, title: 'Queue' }] }),
      ),
    );

    expect(two.height).toBe(one.height);
  });

  it('renders with no groups at all', async () => {
    const buffer = await renderHelpCard(data({ groups: [] }));
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('reflects the guild prefix', async () => {
    const [bang, dot] = await Promise.all([
      renderHelpCard(data({ prefix: '!' })),
      renderHelpCard(data({ prefix: '.' })),
    ]);

    expect(bang.equals(dot)).toBe(false);
  });
});
