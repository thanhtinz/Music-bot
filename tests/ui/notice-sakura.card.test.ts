import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import {
  NOTICE_SAKURA_SIZE,
  parseNoticeMessage,
  renderSakuraNoticeCard,
  type NoticeCardData,
} from '../../src/ui/canvas';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

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

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('renders a single unbroken word longer than the panel', async () => {
    const buffer = await renderSakuraNoticeCard(data({ message: 'x'.repeat(400) }));

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('survives an empty message', async () => {
    const buffer = await renderSakuraNoticeCard({ message: '' });

    expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
