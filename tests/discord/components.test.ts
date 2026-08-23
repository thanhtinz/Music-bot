import { describe, expect, it } from 'vitest';

import {
  buildNowPlayingControls,
  buildQueuePagination,
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

describe('buildNowPlayingControls', () => {
  const state = { paused: false, hasPrevious: true, hasQueue: true, loop: 'off' as const };

  it('builds two rows of buttons', () => {
    const rows = toJSON(buildNowPlayingControls(state));

    expect(rows).toHaveLength(2);
    expect(rows[0]?.components).toHaveLength(5);
    expect(rows[1]?.components).toHaveLength(3);
  });

  it('disables what cannot be done right now', () => {
    const rows = toJSON(buildNowPlayingControls({ ...state, hasPrevious: false, hasQueue: false }));
    const transport = rows[0]?.components ?? [];

    // previous, skip and shuffle all need something to act on.
    expect(transport[0]).toMatchObject({ disabled: true });
    expect(transport[2]).toMatchObject({ disabled: true });
    expect(transport[3]).toMatchObject({ disabled: true });
    // Play/pause always works while a track is loaded.
    expect((transport[1] as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it('shows play while paused and pause while playing', () => {
    const playing = toJSON(buildNowPlayingControls(state))[0]?.components?.[1];
    const paused = toJSON(buildNowPlayingControls({ ...state, paused: true }))[0]?.components?.[1];

    expect(playing).not.toEqual(paused);
  });

  it('lights the loop button when loop is on', () => {
    const off = toJSON(buildNowPlayingControls(state))[0]?.components?.[4];
    const on = toJSON(buildNowPlayingControls({ ...state, loop: 'queue' }))[0]?.components?.[4];

    expect(off).not.toEqual(on);
  });

  it('every button carries a decodable id', () => {
    for (const row of toJSON(buildNowPlayingControls(state))) {
      for (const component of row.components) {
        const customId = (component as { custom_id?: string }).custom_id;
        expect(customId).toBeDefined();
        expect(decodeComponentId(customId as string)).not.toBeNull();
      }
    }
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
