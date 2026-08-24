import { describe, expect, it } from 'vitest';

import {
  isBareId,
  looksLikeAudioStream,
  parseInput,
  parseTimeToSeconds,
} from '../../src/resolvers';

describe('parseInput — YouTube', () => {
  it('reads a watch URL', () => {
    expect(parseInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
      kind: 'youtube-video',
      source: 'youtube',
      identifier: 'dQw4w9WgXcQ',
    });
  });

  it('reads short, shorts, embed and live forms', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ]) {
      expect(parseInput(url), url).toMatchObject({
        kind: 'youtube-video',
        identifier: 'dQw4w9WgXcQ',
      });
    }
  });

  it('accepts music and mobile hosts', () => {
    expect(parseInput('https://music.youtube.com/watch?v=dQw4w9WgXcQ').kind).toBe('youtube-video');
    expect(parseInput('https://m.youtube.com/watch?v=dQw4w9WgXcQ').kind).toBe('youtube-video');
  });

  it('prefers the video when a watch URL also names a playlist', () => {
    // Pasting a watch link from inside a playlist means that video, not all 200.
    expect(parseInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toMatchObject({
      kind: 'youtube-video',
      identifier: 'dQw4w9WgXcQ',
      playlistId: 'PL123',
    });
  });

  it('reads a playlist URL', () => {
    expect(parseInput('https://www.youtube.com/playlist?list=PLabc123')).toMatchObject({
      kind: 'youtube-playlist',
      identifier: 'PLabc123',
    });
  });

  it('reads a start offset in every form', () => {
    expect(parseInput('https://youtu.be/dQw4w9WgXcQ?t=90').startMs).toBe(90_000);
    expect(parseInput('https://youtu.be/dQw4w9WgXcQ?t=1m30s').startMs).toBe(90_000);
    expect(parseInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=45').startMs).toBe(45_000);
  });

  it('falls back to search for a malformed video id', () => {
    expect(parseInput('https://www.youtube.com/watch?v=short').kind).toBe('search');
  });
});

describe('parseInput — Spotify', () => {
  it('reads track, album and playlist links', () => {
    const id = '4cOdK2wGLETKBW3PvgPWqT';

    expect(parseInput(`https://open.spotify.com/track/${id}`)).toMatchObject({
      kind: 'spotify-track',
      identifier: id,
    });
    expect(parseInput(`https://open.spotify.com/album/${id}`).kind).toBe('spotify-album');
    expect(parseInput(`https://open.spotify.com/playlist/${id}`).kind).toBe('spotify-playlist');
  });

  it('reads locale-prefixed links', () => {
    const id = '4cOdK2wGLETKBW3PvgPWqT';
    expect(parseInput(`https://open.spotify.com/intl-vi/track/${id}`)).toMatchObject({
      kind: 'spotify-track',
      identifier: id,
    });
  });

  it('reads the spotify: URI form', () => {
    expect(parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toMatchObject({
      kind: 'spotify-track',
      identifier: '4cOdK2wGLETKBW3PvgPWqT',
    });
  });

  it('drops tracking parameters from the normalised URL', () => {
    const parsed = parseInput(
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123&context=xyz',
    );
    expect(parsed.url).toBe('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  });
});

describe('parseInput — Apple Music', () => {
  it('reads an album link', () => {
    const parsed = parseInput('https://music.apple.com/us/album/de-mi-lam-gi/1441164589');

    expect(parsed).toMatchObject({
      kind: 'applemusic-album',
      source: 'applemusic',
      identifier: '1441164589',
    });
  });

  it('reads a song shared from inside an album as one track', () => {
    // `?i=` is how Apple shares a single song: the page is the album, and
    // missing this queues the whole thing behind it.
    const parsed = parseInput('https://music.apple.com/vn/album/cham-hoa/1441164589?i=1441164592');

    expect(parsed).toMatchObject({
      kind: 'applemusic-track',
      source: 'applemusic',
      identifier: '1441164592',
    });
  });

  it('reads a playlist link', () => {
    expect(
      parseInput(
        'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
      ),
    ).toMatchObject({
      kind: 'applemusic-playlist',
      source: 'applemusic',
    });
  });

  it('reads a link with no locale in it', () => {
    expect(parseInput('https://music.apple.com/album/cham-hoa/1441164589')).toMatchObject({
      kind: 'applemusic-album',
      source: 'applemusic',
    });
  });

  it('hands the URL over as Apple wrote it', () => {
    // The plugin reads the same link, `i` and all.
    const raw = 'https://music.apple.com/vn/album/cham-hoa/1441164589?i=1441164592';
    expect(parseInput(raw).url).toBe(raw);
  });

  it('falls back to a search for a page that is not music', () => {
    expect(parseInput('https://music.apple.com/us/browse')).toMatchObject({ kind: 'search' });
  });
});

describe('parseInput — Deezer', () => {
  it('reads track, album and playlist links', () => {
    expect(parseInput('https://www.deezer.com/track/3135556')).toMatchObject({
      kind: 'deezer-track',
      source: 'deezer',
      identifier: '3135556',
    });
    expect(parseInput('https://deezer.com/album/302127')).toMatchObject({
      kind: 'deezer-album',
      source: 'deezer',
    });
    expect(parseInput('https://www.deezer.com/en/playlist/1479458365')).toMatchObject({
      kind: 'deezer-playlist',
      source: 'deezer',
      identifier: '1479458365',
    });
  });

  it('normalises away the locale', () => {
    expect(parseInput('https://www.deezer.com/fr/track/3135556').url).toBe(
      'https://www.deezer.com/track/3135556',
    );
  });

  it('falls back to a search for a page that is not a track', () => {
    expect(parseInput('https://www.deezer.com/us/channels/pop')).toMatchObject({
      kind: 'search',
    });
  });
});

describe('parseInput — other sources', () => {
  it('reads SoundCloud tracks and sets', () => {
    expect(parseInput('https://soundcloud.com/artist/song').kind).toBe('soundcloud-track');
    expect(parseInput('https://soundcloud.com/artist/sets/album').kind).toBe('soundcloud-playlist');
  });

  it('treats an unknown https URL as a stream', () => {
    expect(parseInput('https://radio.example.com/stream.mp3')).toMatchObject({
      kind: 'http-stream',
      source: 'http',
    });
  });

  it('treats plain text as a search', () => {
    expect(parseInput('chạy ngay đi sơn tùng')).toMatchObject({
      kind: 'search',
      identifier: 'chạy ngay đi sơn tùng',
    });
  });

  it('does not hand a non-http scheme to a resolver', () => {
    // Fetching whatever scheme a user names is how SSRF starts.
    expect(parseInput('ftp://internal.host/secret').kind).toBe('search');
    expect(parseInput('file:///etc/passwd').kind).toBe('search');
  });

  it('handles blank input', () => {
    expect(parseInput('   ').kind).toBe('search');
    expect(parseInput('').identifier).toBe('');
  });

  it('accepts a bare host without a scheme', () => {
    expect(parseInput('youtu.be/dQw4w9WgXcQ').kind).toBe('youtube-video');
  });
});

describe('parseTimeToSeconds', () => {
  it('parses every supported form', () => {
    expect(parseTimeToSeconds('90')).toBe(90);
    expect(parseTimeToSeconds('1m30s')).toBe(90);
    expect(parseTimeToSeconds('1:30')).toBe(90);
    expect(parseTimeToSeconds('1:02:03')).toBe(3_723);
    expect(parseTimeToSeconds('2h')).toBe(7_200);
  });

  it('returns zero for nonsense', () => {
    expect(parseTimeToSeconds('')).toBe(0);
    expect(parseTimeToSeconds('soon')).toBe(0);
  });
});

describe('helpers', () => {
  it('spots direct audio URLs', () => {
    expect(looksLikeAudioStream('https://x.com/a.mp3')).toBe(true);
    expect(looksLikeAudioStream('https://x.com/live.m3u8')).toBe(true);
    expect(looksLikeAudioStream('https://x.com/page')).toBe(false);
    expect(looksLikeAudioStream('not a url')).toBe(false);
  });

  it('spots bare ids', () => {
    expect(isBareId('dQw4w9WgXcQ')).toBe('youtube');
    expect(isBareId('4cOdK2wGLETKBW3PvgPWqT')).toBe('spotify');
    expect(isBareId('hello')).toBeUndefined();
  });
});
