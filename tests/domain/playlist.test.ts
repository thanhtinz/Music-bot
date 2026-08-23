import { describe, expect, it } from 'vitest';

import { createTrack } from '../../src/domain/music';
import {
  appendTrack,
  assertValidPlaylistName,
  createPlaylist,
  indexOfTrack,
  isVisibleTo,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  normalizePlaylistName,
  playlistDurationMs,
  PlaylistError,
  removeTrackAt,
  renamePlaylist,
  setVisibility,
  toSavedTrack,
  toTrackInput,
  type SavedTrack,
} from '../../src/domain/playlist';

function saved(overrides: Partial<SavedTrack> = {}): SavedTrack {
  return {
    source: 'youtube',
    identifier: 'abc',
    title: 'Faded',
    author: 'Alan Walker',
    durationMs: 212_000,
    isStream: false,
    ...overrides,
  };
}

describe('normalizePlaylistName', () => {
  it('matches names typed from memory', () => {
    expect(normalizePlaylistName('  Chill   Vibes ')).toBe('chill vibes');
    expect(normalizePlaylistName('CHILL VIBES')).toBe(normalizePlaylistName('chill vibes'));
  });
});

describe('assertValidPlaylistName', () => {
  it('keeps the owner capitalisation but collapses whitespace', () => {
    expect(assertValidPlaylistName('  Late   Night  ')).toBe('Late Night');
  });

  it('rejects an empty name', () => {
    expect(() => assertValidPlaylistName('   ')).toThrow(PlaylistError);
  });

  it('rejects a name past the limit', () => {
    expect(() => assertValidPlaylistName('x'.repeat(MAX_PLAYLIST_NAME_LENGTH + 1))).toThrow(
      /limited to/,
    );
  });
});

describe('createPlaylist', () => {
  it('defaults to public and empty', () => {
    const playlist = createPlaylist({ guildId: 'g', ownerId: 'u', name: 'Chill' });

    expect(playlist.visibility).toBe('public');
    expect(playlist.tracks).toEqual([]);
    expect(playlist.createdAt).toBe(playlist.updatedAt);
  });

  it('gives every playlist its own id', () => {
    const a = createPlaylist({ guildId: 'g', ownerId: 'u', name: 'A' });
    const b = createPlaylist({ guildId: 'g', ownerId: 'u', name: 'B' });

    expect(a.id).not.toBe(b.id);
  });

  it('caps the tracks it is seeded with', () => {
    const playlist = createPlaylist({
      guildId: 'g',
      ownerId: 'u',
      name: 'Big',
      tracks: Array.from({ length: MAX_TRACKS_PER_PLAYLIST + 10 }, () => saved()),
    });

    expect(playlist.tracks).toHaveLength(MAX_TRACKS_PER_PLAYLIST);
  });
});

describe('appendTrack', () => {
  it('adds without mutating the original', () => {
    const playlist = createPlaylist({ guildId: 'g', ownerId: 'u', name: 'Chill' });
    const updated = appendTrack(playlist, saved(), 5);

    expect(playlist.tracks).toHaveLength(0);
    expect(updated.tracks).toHaveLength(1);
    expect(updated.updatedAt).toBe(5);
  });

  it('refuses rather than dropping a track at the cap', () => {
    const playlist = createPlaylist({
      guildId: 'g',
      ownerId: 'u',
      name: 'Full',
      tracks: Array.from({ length: MAX_TRACKS_PER_PLAYLIST }, () => saved()),
    });

    expect(() => appendTrack(playlist, saved())).toThrow(/full/);
  });
});

describe('removeTrackAt', () => {
  const playlist = createPlaylist({
    guildId: 'g',
    ownerId: 'u',
    name: 'Chill',
    tracks: [saved({ title: 'One' }), saved({ title: 'Two' }), saved({ title: 'Three' })],
  });

  it('removes by 1-based position', () => {
    const { playlist: updated, removed } = removeTrackAt(playlist, 2);

    expect(removed.title).toBe('Two');
    expect(updated.tracks.map((track) => track.title)).toEqual(['One', 'Three']);
  });

  it('rejects a position outside the playlist', () => {
    expect(() => removeTrackAt(playlist, 0)).toThrow(PlaylistError);
    expect(() => removeTrackAt(playlist, 4)).toThrow(PlaylistError);
    expect(() => removeTrackAt(playlist, 1.5)).toThrow(PlaylistError);
  });
});

describe('toSavedTrack / toTrackInput', () => {
  it('drops the per-enqueue identity and re-attributes on the way back', () => {
    const track = createTrack({
      source: 'youtube',
      identifier: 'abc',
      title: 'Faded',
      author: 'Alan Walker',
      durationMs: 212_000,
      requesterId: 'original-user',
    });

    const stored = toSavedTrack(track);
    expect(stored).not.toHaveProperty('id');
    expect(stored).not.toHaveProperty('requesterId');

    const input = toTrackInput(stored, 'new-user');
    expect(input.requesterId).toBe('new-user');
    expect(input.identifier).toBe('abc');
  });
});

describe('playlistDurationMs', () => {
  it('counts a stream as zero', () => {
    const playlist = createPlaylist({
      guildId: 'g',
      ownerId: 'u',
      name: 'Mixed',
      tracks: [saved({ durationMs: 1000 }), saved({ durationMs: 9999, isStream: true })],
    });

    expect(playlistDurationMs(playlist)).toBe(1000);
  });
});

describe('visibility', () => {
  const playlist = createPlaylist({ guildId: 'g', ownerId: 'owner', name: 'Chill' });

  it('shows public playlists to anyone', () => {
    expect(isVisibleTo(playlist, 'someone-else')).toBe(true);
  });

  it('shows private playlists only to their owner', () => {
    const hidden = setVisibility(playlist, 'private');

    expect(isVisibleTo(hidden, 'someone-else')).toBe(false);
    expect(isVisibleTo(hidden, 'owner')).toBe(true);
  });
});

describe('indexOfTrack', () => {
  const playlist = createPlaylist({
    guildId: 'g',
    ownerId: 'u',
    name: 'Chill',
    tracks: [saved({ identifier: 'one' }), saved({ identifier: 'two' })],
  });

  it('finds the same song', () => {
    expect(indexOfTrack(playlist, saved({ identifier: 'two' }))).toBe(1);
  });

  it('ignores everything but source and identifier', () => {
    // The same video with a different title is still the same video.
    expect(indexOfTrack(playlist, saved({ identifier: 'one', title: 'Renamed' }))).toBe(0);
  });

  it('tells apart the same identifier on another source', () => {
    expect(indexOfTrack(playlist, saved({ identifier: 'one', source: 'spotify' }))).toBe(-1);
  });

  it('returns -1 for a song that is not there', () => {
    expect(indexOfTrack(playlist, saved({ identifier: 'three' }))).toBe(-1);
  });
});

describe('renamePlaylist', () => {
  it('validates the new name', () => {
    const playlist = createPlaylist({ guildId: 'g', ownerId: 'u', name: 'Chill' });

    expect(renamePlaylist(playlist, '  Late  Night ').name).toBe('Late Night');
    expect(() => renamePlaylist(playlist, ' ')).toThrow(PlaylistError);
  });
});
