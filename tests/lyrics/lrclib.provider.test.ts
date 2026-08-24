import { describe, expect, it, vi } from 'vitest';

import { LrclibProvider, parseLrc, primaryArtist, searchableTitle } from '../../src/lyrics';
import { CircuitBreaker, ResolverError } from '../../src/resolvers';

/** A fetch that answers with whatever the test says, and records the URL. */
function fakeFetch(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const calls: URL[] = [];

  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));

    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers: new Headers(init.headers ?? {}),
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const RECORD = {
  trackName: 'Chăm Hoa',
  artistName: 'MONO',
  plainLyrics: 'Line one\nLine two',
  syncedLyrics: null,
};

describe('searchableTitle', () => {
  it('strips the decorations a video title carries', () => {
    expect(searchableTitle('Chăm Hoa (Official Music Video)')).toBe('Chăm Hoa');
    expect(searchableTitle('Faded [Official Lyric Video]')).toBe('Faded');
    expect(searchableTitle('Nevada | Official Audio')).toBe('Nevada');
    expect(searchableTitle('Bones (Remastered 2024)')).toBe('Bones');
  });

  it('leaves a plain title alone', () => {
    expect(searchableTitle('Lạc Trôi')).toBe('Lạc Trôi');
  });

  it('does not strip a title down to nothing it can search', () => {
    // Parentheses that are part of the name must survive.
    expect(searchableTitle('Sunflower (Spider-Man)')).toBe('Sunflower (Spider-Man)');
  });
});

describe('primaryArtist', () => {
  it('keeps only the first name', () => {
    expect(primaryArtist('Vicetone feat. Cozi Zuehlsdorff')).toBe('Vicetone');
    expect(primaryArtist('Dua Lipa, DaBaby')).toBe('Dua Lipa');
    expect(primaryArtist('Jack & Jill')).toBe('Jack');
  });

  it('drops the topic suffix a video source adds', () => {
    expect(primaryArtist('MONO - Topic')).toBe('MONO');
  });
});

describe('parseLrc', () => {
  it('reads the timing and keeps the words', () => {
    expect(parseLrc('[00:12.34] one\n[00:15.00] two')).toEqual([
      { atMs: 12_340, line: 'one' },
      { atMs: 15_000, line: 'two' },
    ]);
  });

  it('lands a repeated line at every moment it is sung', () => {
    expect(parseLrc('[00:12.34][01:02.00] chorus')).toEqual([
      { atMs: 12_340, line: 'chorus' },
      { atMs: 62_000, line: 'chorus' },
    ]);
  });

  it('reads the fraction as fractional seconds', () => {
    // `.5` is half a second, not five hundredths and not five milliseconds.
    expect(parseLrc('[00:10.5] half')[0]?.atMs).toBe(10_500);
    expect(parseLrc('[00:10.05] a little')[0]?.atMs).toBe(10_050);
    expect(parseLrc('[00:10.005] barely')[0]?.atMs).toBe(10_005);
    expect(parseLrc('[00:10] none')[0]?.atMs).toBe(10_000);
  });

  it('keeps a blank line, because a verse break is part of the song', () => {
    expect(parseLrc('[00:10.00] one\n[00:12.00]\n[00:14.00] two')).toEqual([
      { atMs: 10_000, line: 'one' },
      { atMs: 12_000, line: '' },
      { atMs: 14_000, line: 'two' },
    ]);
  });

  it('drops the metadata tags and anything it cannot place', () => {
    expect(parseLrc('[ar:MONO]\n[length:03:20]\nstray words\n[00:10.00] real')).toEqual([
      { atMs: 10_000, line: 'real' },
    ]);
  });

  it('puts the lines in the order they are sung', () => {
    expect(parseLrc('[01:00.00] later\n[00:10.00] earlier').map((entry) => entry.line)).toEqual([
      'earlier',
      'later',
    ]);
  });
});

describe('LrclibProvider', () => {
  it('returns the lyrics it finds', async () => {
    const { impl, calls } = fakeFetch([RECORD]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    const lyrics = await provider.find({ title: 'Chăm Hoa (Official MV)', artist: 'MONO' });

    expect(lyrics).toMatchObject({ title: 'Chăm Hoa', artist: 'MONO', provider: 'LRCLIB' });
    expect(lyrics?.text).toBe('Line one\nLine two');
    // The decorated title must not reach the API.
    expect(calls[0]?.searchParams.get('track_name')).toBe('Chăm Hoa');
    expect(calls[0]?.searchParams.get('artist_name')).toBe('MONO');
  });

  it('falls back to the synced words when there is no plain text', async () => {
    const { impl } = fakeFetch([
      { ...RECORD, plainLyrics: null, syncedLyrics: '[00:01.00] only\n[00:02.00] this' },
    ]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    const lyrics = await provider.find({ title: 'Chăm Hoa' });

    expect(lyrics?.text).toBe('only\nthis');
    expect(lyrics?.synced).toBe(true);
  });

  it('says so for an instrumental rather than returning nothing', async () => {
    const { impl } = fakeFetch([
      { trackName: 'Interlude', artistName: 'Someone', instrumental: true },
    ]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    expect((await provider.find({ title: 'Interlude' }))?.text).toContain('Instrumental');
  });

  it('skips a hit that has no usable words', async () => {
    const { impl } = fakeFetch([
      { trackName: 'Empty', plainLyrics: '   ', syncedLyrics: null },
      RECORD,
    ]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    expect((await provider.find({ title: 'Chăm Hoa' }))?.title).toBe('Chăm Hoa');
  });

  it('returns nothing for an empty result set', async () => {
    const { impl } = fakeFetch([]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    expect(await provider.find({ title: 'Nothing at all' })).toBeUndefined();
  });

  it('returns nothing for a 404 rather than failing the command', async () => {
    const { impl } = fakeFetch(null, { status: 404 });
    const provider = new LrclibProvider({ fetchImpl: impl });

    expect(await provider.find({ title: 'Missing' })).toBeUndefined();
  });

  it('reports a rate limit as such, so the breaker can see it', async () => {
    const { impl } = fakeFetch(null, { status: 429 });
    const provider = new LrclibProvider({ fetchImpl: impl });

    await expect(provider.find({ title: 'Busy' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('reports a server error as a provider fault', async () => {
    const { impl } = fakeFetch(null, { status: 503 });
    const provider = new LrclibProvider({ fetchImpl: impl });

    await expect(provider.find({ title: 'Broken' })).rejects.toBeInstanceOf(ResolverError);
  });

  it('refuses a body larger than it will read', async () => {
    const { impl } = fakeFetch([RECORD], { headers: { 'content-length': '99999999' } });
    const provider = new LrclibProvider({ fetchImpl: impl });

    await expect(provider.find({ title: 'Huge' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('gives up rather than hanging a command', async () => {
    const hanging = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const provider = new LrclibProvider({ fetchImpl: hanging, timeoutMs: 10 });

    await expect(provider.find({ title: 'Slow' })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('stops calling a provider that keeps failing', async () => {
    const { impl } = fakeFetch(null, { status: 503 });
    const breaker = new CircuitBreaker('lrclib', { failureThreshold: 2 });
    const provider = new LrclibProvider({ fetchImpl: impl, breaker });

    await expect(provider.find({ title: 'One' })).rejects.toBeTruthy();
    await expect(provider.find({ title: 'Two' })).rejects.toBeTruthy();

    const before = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await expect(provider.find({ title: 'Three' })).rejects.toBeTruthy();

    // The third call never reached the network: the circuit was already open.
    expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('does not search for a title that cleans down to nothing', async () => {
    const { impl } = fakeFetch([RECORD]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    expect(await provider.find({ title: '   ' })).toBeUndefined();
    expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('searches without an artist when there is none', async () => {
    const { impl, calls } = fakeFetch([RECORD]);
    const provider = new LrclibProvider({ fetchImpl: impl });

    await provider.find({ title: 'Chăm Hoa' });

    expect(calls[0]?.searchParams.has('artist_name')).toBe(false);
  });
});
