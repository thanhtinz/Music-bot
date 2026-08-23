import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  NOTICE_SAKURA_SIZE,
  parseNoticeMessage,
  renderSakuraNoticeCard,
  type NoticeCardData,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

function data(overrides: Partial<NoticeCardData> = {}): NoticeCardData {
  return { title: 'Volume', message: 'Volume set to **85%**.', icon: 'volume', ...overrides };
}

describe('parseNoticeMessage', () => {
  it('marks the bold runs', () => {
    expect(parseNoticeMessage('Volume set to **85%**.')).toEqual([
      { text: 'Volume', emphasis: false, spaced: false },
      { text: 'set', emphasis: false, spaced: true },
      { text: 'to', emphasis: false, spaced: true },
      { text: '85%', emphasis: true, spaced: true },
      { text: '.', emphasis: false, spaced: false },
    ]);
  });

  it('keeps punctuation attached to the word it follows', () => {
    // `85% .` instead of `85%.` is exactly what a naive word split produces.
    const words = parseNoticeMessage('Loop: **queue**, autoplay **on**.');

    expect(words.filter((word) => !word.spaced).map((word) => word.text)).toEqual([
      'Loop:',
      ',',
      '.',
    ]);
  });

  it('marks a code span and drops its backticks', () => {
    // On an image a backtick is just a backtick, so the marker has to go.
    expect(parseNoticeMessage('Queue something with `play`.')).toEqual([
      { text: 'Queue', emphasis: false, spaced: false },
      { text: 'something', emphasis: false, spaced: true },
      { text: 'with', emphasis: false, spaced: true },
      { text: 'play', emphasis: true, spaced: true },
      { text: '.', emphasis: false, spaced: false },
    ]);
  });

  it('handles bold and code in the same message', () => {
    const words = parseNoticeMessage('Left **#music-room**, resume with `play`.');

    expect(words.filter((word) => word.emphasis).map((word) => word.text)).toEqual([
      '#music-room',
      'play',
    ]);
  });

  it('handles a message with no markup', () => {
    expect(parseNoticeMessage('Stopped playback.')).toEqual([
      { text: 'Stopped', emphasis: false, spaced: false },
      { text: 'playback.', emphasis: false, spaced: true },
    ]);
  });

  it('handles an unclosed marker without losing the text', () => {
    const words = parseNoticeMessage('Broken **markup here');

    expect(words.map((word) => word.text).join(' ')).toBe('Broken **markup here');
  });
});

describe('renderSakuraNoticeCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraNoticeCard(data());
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(NOTICE_SAKURA_SIZE.width);
    expect(image.height).toBe(NOTICE_SAKURA_SIZE.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraNoticeCard(data()),
      renderSakuraNoticeCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('draws each tone differently', async () => {
    const tones = ['success', 'info', 'warning', 'error'] as const;
    const rendered = await Promise.all(
      tones.map((tone) => renderSakuraNoticeCard(data({ tone, icon: undefined }))),
    );

    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(rendered[i]!.equals(rendered[j]!)).toBe(false);
      }
    }
  });

  it('falls back to a heading when none is given', async () => {
    const [titled, untitled] = await Promise.all([
      renderSakuraNoticeCard(data({ title: 'Volume' })),
      renderSakuraNoticeCard(data({ title: undefined })),
    ]);

    expect(titled.equals(untitled)).toBe(false);
  });

  it('shows a footnote when there is one', async () => {
    const [without, withNote] = await Promise.all([
      renderSakuraNoticeCard(data()),
      renderSakuraNoticeCard(data({ footnote: 'Tip: try /play' })),
    ]);

    expect(without.equals(withNote)).toBe(false);
  });

  it('renders a message far too long for the panel', async () => {
    const buffer = await renderSakuraNoticeCard(
      data({ message: 'word '.repeat(200), footnote: 'note '.repeat(80) }),
    );

    expectCardImage(buffer);
  });

  it('renders a single unbroken word longer than the panel', async () => {
    const buffer = await renderSakuraNoticeCard(data({ message: 'x'.repeat(400) }));

    expectCardImage(buffer);
  });

  it('survives an empty message', async () => {
    const buffer = await renderSakuraNoticeCard({ message: '' });

    expectCardImage(buffer);
  });
});

describe('a message longer than the card', () => {
  const long = 'This message goes on well past the two lines the card has room for, and then some.';

  it('drops the tail, so two messages that differ only past the cut match', async () => {
    const [alpha, omega] = await Promise.all([
      renderSakuraNoticeCard(data({ message: `${long} Alpha alpha alpha.` })),
      renderSakuraNoticeCard(data({ message: `${long} Omega omega omega.` })),
    ]);

    expect(alpha.equals(omega)).toBe(true);
  });

  it('marks the cut, so a long message does not read as a finished one', async () => {
    const [cut, whole] = await Promise.all([
      renderSakuraNoticeCard(data({ message: long })),
      // The words that survive the cut, on their own: they fit, so they are
      // drawn without an ellipsis. A sentence that just stops reads as a
      // broken bot rather than a long message.
      renderSakuraNoticeCard(data({ message: 'This message goes on well past the two' })),
    ]);

    expect(cut.equals(whole)).toBe(false);
  });

  it('differs from the message that fits', async () => {
    const [cut, short] = await Promise.all([
      renderSakuraNoticeCard(data({ message: long })),
      renderSakuraNoticeCard(data({ message: 'Short enough.' })),
    ]);

    expect(cut.equals(short)).toBe(false);
  });

  it('keeps a single unbreakable word inside the card', async () => {
    const buffer = await renderSakuraNoticeCard(data({ message: 'x'.repeat(400) }));

    expectCardImage(buffer);
  });
});
