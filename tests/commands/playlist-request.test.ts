import { describe, expect, it } from 'vitest';

import { parsePlaylistRequest } from '../../src/commands/handlers';

/** Slash supplies named options and no positional args. */
function slash(values: Record<string, string>) {
  return parsePlaylistRequest([], (name) => values[name]);
}

describe('parsePlaylistRequest', () => {
  describe('from slash options', () => {
    it('reads action, name and position by name', () => {
      expect(slash({ action: 'remove', name: 'Chill Vibes', position: '3' })).toEqual({
        action: 'remove',
        name: 'Chill Vibes',
        position: 3,
      });
    });

    it('defaults to listing the library', () => {
      expect(slash({})).toEqual({ action: 'list', name: '' });
    });

    it('lower-cases the action so `Play` and `play` agree', () => {
      expect(slash({ action: 'PLAY', name: 'Chill' }).action).toBe('play');
    });

    it('ignores a position that is not a whole number above zero', () => {
      expect(slash({ action: 'remove', name: 'Chill', position: '0' })).not.toHaveProperty(
        'position',
      );
      expect(slash({ action: 'remove', name: 'Chill', position: 'x' })).not.toHaveProperty(
        'position',
      );
      expect(slash({ action: 'remove', name: 'Chill', position: '1.5' })).not.toHaveProperty(
        'position',
      );
    });
  });

  describe('from prefix arguments', () => {
    const prefix = (...args: string[]) => parsePlaylistRequest(args, () => undefined);

    it('takes the name from everything after the action', () => {
      expect(prefix('play', 'Chill', 'Vibes')).toEqual({ action: 'play', name: 'Chill Vibes' });
    });

    it('reads the trailing number as the position, for remove', () => {
      expect(prefix('remove', 'Chill', 'Vibes', '3')).toEqual({
        action: 'remove',
        name: 'Chill Vibes',
        position: 3,
      });
    });

    it('leaves a trailing number in the name for every other action', () => {
      expect(prefix('play', 'Top', '40')).toEqual({ action: 'play', name: 'Top 40' });
    });

    it('keeps a remove name that is only a number', () => {
      // `remove 40` names no position, so 40 is the playlist.
      expect(prefix('remove', '40')).toEqual({ action: 'remove', name: '40' });
    });

    it('keeps a non-numeric last token as part of the name', () => {
      expect(prefix('remove', 'Chill', 'Vibes')).toEqual({
        action: 'remove',
        name: 'Chill Vibes',
      });
    });

    it('defaults to listing when given nothing', () => {
      expect(prefix()).toEqual({ action: 'list', name: '' });
    });
  });
});
