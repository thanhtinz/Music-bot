import { loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { SETTING_DESCRIPTORS, createSettings } from '../../src/domain/settings';
import {
  renderSakuraSettingsCard,
  SETTINGS_SAKURA_SIZE,
  type SettingsCardData,
} from '../../src/ui/canvas';
import { expectCardImage } from '../helpers/card-image';

const settings = createSettings('guild', {
  prefix: '!',
  defaultVolume: 70,
  idleTimeoutMs: 300_000,
});

function data(overrides: Partial<SettingsCardData> = {}): SettingsCardData {
  return {
    rows: SETTING_DESCRIPTORS.map((descriptor) => ({
      key: descriptor.key,
      label: descriptor.label,
      description: descriptor.description,
      value: descriptor.format(settings),
    })),
    guildName: 'Test Server',
    prefix: '/',
    ...overrides,
  };
}

describe('renderSakuraSettingsCard', () => {
  it('renders a PNG at the declared size', async () => {
    const buffer = await renderSakuraSettingsCard(data());
    expectCardImage(buffer);

    const image = await loadImage(buffer);
    expect(image.width).toBe(SETTINGS_SAKURA_SIZE.width);
    expect(image.height).toBe(SETTINGS_SAKURA_SIZE.height);
  });

  it('is deterministic for identical input', async () => {
    const [first, second] = await Promise.all([
      renderSakuraSettingsCard(data()),
      renderSakuraSettingsCard(data()),
    ]);

    expect(first.equals(second)).toBe(true);
  });

  it('shows the values, not just the labels', async () => {
    const changed = data({
      rows: data().rows.map((row) => (row.key === 'volume' ? { ...row, value: '85%' } : row)),
    });

    expect(
      (await renderSakuraSettingsCard(data())).equals(await renderSakuraSettingsCard(changed)),
    ).toBe(false);
  });

  it('renders without a server name', async () => {
    const buffer = await renderSakuraSettingsCard(data({ guildName: undefined }));
    expectCardImage(buffer);
  });

  it('reflects the prefix in the footer hint', async () => {
    const [slash, bang] = await Promise.all([
      renderSakuraSettingsCard(data({ prefix: '/' })),
      renderSakuraSettingsCard(data({ prefix: '!' })),
    ]);

    expect(slash.equals(bang)).toBe(false);
  });

  it('survives an empty sheet and an over-long one', async () => {
    expectCardImage(await renderSakuraSettingsCard(data({ rows: [] })));

    const many = data({
      rows: Array.from({ length: 20 }, (_, index) => ({
        key: `key${index}`,
        label: 'A label long enough to need truncating on this card',
        description: 'A description that also runs past the space it has',
        value: 'a value that is far too long to fit in the column',
      })),
    });
    expectCardImage(await renderSakuraSettingsCard(many));
  });
});
