import { describe, expect, it } from 'vitest';

import {
  buildNowPlayingControls,
  buildQueuePagination,
  buildVolumePicker,
  VOLUME_STEPS,
  buildHelpCategories,
  buildSearchPicks,
  decodeComponentId,
  encodeComponentId,
  toJSON,
} from '../../src/infrastructure/discord/components';

describe('component ids', () => {
  it('round-trips an action', () => {
    const id = encodeComponentId({ action: 'skip' });
    expect(decodeComponentId(id)).toEqual({ action: 'skip' });
  });

  it('round-trips an action with an argument', () => {
    const id = encodeComponentId({ action: 'page', arg: '7' });
    expect(decodeComponentId(id)).toEqual({ action: 'page', arg: '7' });
  });

  it('ignores components that are not ours', () => {
    // Another bot's buttons must not be mistaken for ours.
    expect(decodeComponentId('other:skip')).toBeNull();
    expect(decodeComponentId('skip')).toBeNull();
    expect(decodeComponentId('')).toBeNull();
  });

  it('ignores an unknown action in our namespace', () => {
    expect(decodeComponentId('mb:selfdestruct')).toBeNull();
  });

  it('stays inside Discord’s 100-character limit', () => {
    expect(encodeComponentId({ action: 'page', arg: '9999' }).length).toBeLessThanOrEqual(100);
    expect(() => encodeComponentId({ action: 'page', arg: 'x'.repeat(200) })).toThrow(/too long/);
  });
});

/** The actions a serialised row carries, in the order they are shown. */
function actionsOf(row: { components: unknown[] } | undefined): (string | undefined)[] {
  return (row?.components ?? []).map(
    (component) => decodeComponentId((component as { custom_id: string }).custom_id)?.action,
  );
}

describe('buildNowPlayingControls', () => {
  const state = { paused: false, hasPrevious: true, hasQueue: true, loop: 'off' as const };

  it('builds a transport row and a volume picker', () => {
    const rows = toJSON(buildNowPlayingControls(state));

    expect(rows).toHaveLength(2);
    expect(actionsOf(rows[0])).toEqual(['previous', 'playpause', 'skip', 'mute']);
    expect(actionsOf(rows[1])).toEqual(['volume']);
  });

  it('disables what cannot be done right now', () => {
    const rows = toJSON(buildNowPlayingControls({ ...state, hasPrevious: false, hasQueue: false }));
    const transport = rows[0]?.components ?? [];

    // previous and skip both need something to act on.
    expect(transport[0]).toMatchObject({ disabled: true });
    expect(transport[2]).toMatchObject({ disabled: true });
    // Play/pause and mute always work while a track is loaded.
    expect((transport[1] as { disabled?: boolean }).disabled).not.toBe(true);
    expect((transport[3] as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it('shows play while paused and pause while playing', () => {
    const playing = toJSON(buildNowPlayingControls(state))[0]?.components?.[1];
    const paused = toJSON(buildNowPlayingControls({ ...state, paused: true }))[0]?.components?.[1];

    expect(playing).not.toEqual(paused);
  });

  it('marks the mute button while the player is silenced', () => {
    const loud = toJSON(buildNowPlayingControls(state))[0]?.components?.[3];
    const muted = toJSON(buildNowPlayingControls({ ...state, muted: true }))[0]?.components?.[3];

    expect(loud).not.toEqual(muted);
  });

  it('every component carries a decodable id', () => {
    for (const row of toJSON(buildNowPlayingControls(state))) {
      for (const component of row.components) {
        const customId = (component as { custom_id?: string }).custom_id;
        expect(customId).toBeDefined();
        expect(decodeComponentId(customId as string)).not.toBeNull();
      }
    }
  });
});

describe('buildVolumePicker', () => {
  it('offers every step, as values the volume command understands', () => {
    const menu = toJSON([buildVolumePicker(100)])[0]?.components?.[0] as {
      options: { value: string; default?: boolean }[];
    };

    expect(menu.options.map((option) => Number(option.value))).toEqual([...VOLUME_STEPS]);
  });

  it('says where the volume is now, and marks that step', () => {
    const menu = toJSON([buildVolumePicker(75)])[0]?.components?.[0] as {
      placeholder: string;
      options: { value: string; default?: boolean }[];
    };

    expect(menu.placeholder).toBe('Volume: 75%');
    expect(menu.options.filter((option) => option.default).map((option) => option.value)).toEqual([
      '75',
    ]);
  });

  it('marks no step while muted, and says so', () => {
    const menu = toJSON([buildVolumePicker(75, true)])[0]?.components?.[0] as {
      placeholder: string;
      options: { default?: boolean }[];
    };

    expect(menu.placeholder).toBe('Volume: muted');
    expect(menu.options.some((option) => option.default)).toBe(false);
  });

  it('marks nothing when the level is between steps', () => {
    const menu = toJSON([buildVolumePicker(63)])[0]?.components?.[0] as {
      placeholder: string;
      options: { default?: boolean }[];
    };

    expect(menu.placeholder).toBe('Volume: 63%');
    expect(menu.options.some((option) => option.default)).toBe(false);
  });
});

describe('buildQueuePagination', () => {
  it('targets first, previous, current, next and last', () => {
    const buttons = toJSON(buildQueuePagination(3, 5))[0]?.components ?? [];
    const ids = buttons.map((button) => (button as { custom_id: string }).custom_id);

    expect(ids.map((id) => decodeComponentId(id)?.arg)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('disables paging past either end', () => {
    const first = toJSON(buildQueuePagination(1, 4))[0]?.components ?? [];
    expect(first[0]).toMatchObject({ disabled: true });
    expect(first[1]).toMatchObject({ disabled: true });
    expect(first[3]).toMatchObject({ disabled: false });

    const last = toJSON(buildQueuePagination(4, 4))[0]?.components ?? [];
    expect(last[3]).toMatchObject({ disabled: true });
    expect(last[4]).toMatchObject({ disabled: true });
  });

  it('clamps a page outside the range', () => {
    const buttons = toJSON(buildQueuePagination(99, 3))[0]?.components ?? [];
    expect(buttons[2]).toMatchObject({ label: '3/3' });

    const low = toJSON(buildQueuePagination(0, 3))[0]?.components ?? [];
    expect(low[2]).toMatchObject({ label: '1/3' });
  });

  it('handles a single page', () => {
    const buttons = toJSON(buildQueuePagination(1, 1))[0]?.components ?? [];

    // Nowhere to go, so every navigation button is dead.
    for (const index of [0, 1, 3, 4]) {
      expect(buttons[index]).toMatchObject({ disabled: true });
    }
  });
});

describe('buildSearchPicks', () => {
  /** The custom ids on a built row, in order. */
  function ids(rows: ReturnType<typeof buildSearchPicks>): unknown[] {
    return toJSON(rows).flatMap((row) =>
      row.components.map((button) => (button as { custom_id?: string }).custom_id),
    );
  }

  it('numbers one button per result, counting from 1', () => {
    expect(ids(buildSearchPicks(3))).toEqual(['mb:pick:1', 'mb:pick:2', 'mb:pick:3']);
  });

  it('decodes back to the position that was pressed', () => {
    expect(decodeComponentId('mb:pick:4')).toEqual({ action: 'pick', arg: '4' });
  });

  it('offers nothing when there is nothing to pick', () => {
    expect(buildSearchPicks(0)).toEqual([]);
  });

  it('stops at five, which is what fits on a row', () => {
    expect(ids(buildSearchPicks(9))).toHaveLength(5);
  });
});

describe('buildHelpCategories', () => {
  const CATEGORIES = ['playback', 'queue', 'playlist', 'filters', 'settings', 'general'];

  it('breaks the categories into rows Discord will take', () => {
    const rows = toJSON(buildHelpCategories(CATEGORIES, 0));

    // Five buttons a row is Discord's limit, and the catalog has six.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.components).toHaveLength(5);
    expect(rows[1]?.components).toHaveLength(1);
  });

  it('numbers from 1, so a press and a typed `help 3` agree', () => {
    const first = toJSON(buildHelpCategories(CATEGORIES, 0))[0]?.components?.[2];

    expect((first as { custom_id?: string }).custom_id).toBe('mb:help:3');
  });

  it('disables the category already on screen', () => {
    const rows = toJSON(buildHelpCategories(CATEGORIES, 1));
    const buttons = rows[0]?.components ?? [];

    expect((buttons[1] as { disabled?: boolean }).disabled).toBe(true);
    expect((buttons[0] as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it('labels the buttons as the sidebar does', () => {
    const first = toJSON(buildHelpCategories(CATEGORIES, 0))[0]?.components?.[0];

    expect((first as { label?: string }).label).toBe('Playback');
  });
});
