import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSearchQuery,
  parseInput,
  RadioResolver,
  ResolverError,
  ResolverRegistry,
  scoreCandidate,
  SpotifyResolver,
  YouTubeResolver,
  type ResolvedPlaylist,
  type SpotifyMetadataClient,
  type SpotifyTrackMetadata,
  type TrackCandidate,
  type TrackSearchClient,
} from '../../src/resolvers';

function candidate(overrides: Partial<TrackCandidate> = {}): TrackCandidate {
  return {
    source: 'youtube',
    identifier: 'abc',
    title: 'Faded',
    author: 'Alan Walker',
    durationMs: 212_000,
    ...overrides,
  };
}

/** Search client double, so no test touches the network. */
class FakeSearchClient implements TrackSearchClient {
  results: TrackCandidate[] = [candidate()];
  playlist: ResolvedPlaylist | null = null;
  readonly queries: string[] = [];

  async search(query: string): Promise<TrackCandidate[]> {
    this.queries.push(query);
    return this.results;
  }

  async loadUrl(): Promise<TrackCandidate[]> {
    return this.results;
  }

  async loadPlaylist(): Promise<ResolvedPlaylist | null> {
    return this.playlist;
  }
}

describe('YouTubeResolver', () => {
  let client: FakeSearchClient;
  let resolver: YouTubeResolver;

  beforeEach(() => {
    client = new FakeSearchClient();
    resolver = new YouTubeResolver(client);
  });

  it('claims YouTube input and searches', () => {
    expect(resolver.canHandle(parseInput('https://youtu.be/dQw4w9WgXcQ'))).toBe(true);
    expect(resolver.canHandle(parseInput('faded'))).toBe(true);
    expect(
      resolver.canHandle(parseInput('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')),
    ).toBe(false);
  });

  it('resolves a search to the top result', async () => {
    const track = await resolver.resolveTrack(parseInput('faded alan walker'));
    expect(track?.title).toBe('Faded');
    expect(client.queries).toEqual(['faded alan walker']);
  });

  it('rejects an empty search', async () => {
    await expect(resolver.search('   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('carries a start offset from the URL', async () => {
    const track = await resolver.resolveTrack(parseInput('https://youtu.be/dQw4w9WgXcQ?t=90'));
    expect(track?.metadata?.startMs).toBe(90_000);
  });

  it('reports an unavailable video rather than returning nothing', async () => {
    client.results = [];
    await expect(
      resolver.resolveTrack(parseInput('https://youtu.be/dQw4w9WgXcQ')),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('caps a playlist at the configured size and says it did', async () => {
    client.playlist = {
      name: 'Big list',
      source: 'youtube',
      tracks: Array.from({ length: 40 }, (_, index) => candidate({ identifier: `t${index}` })),
    };

    const playlist = await resolver.resolvePlaylist(
      parseInput('https://www.youtube.com/playlist?list=PL1'),
      { maxPlaylistSize: 10 },
    );

    expect(playlist?.tracks).toHaveLength(10);
    expect(playlist?.truncated).toBe(true);
    expect(playlist?.totalCount).toBe(40);
  });

  it('does not treat a watch-in-playlist link as a playlist', async () => {
    const playlist = await resolver.resolvePlaylist(
      parseInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1'),
    );
    expect(playlist).toBeNull();
  });
});

describe('Spotify query building and scoring', () => {
  const track: SpotifyTrackMetadata = {
    id: 'sp1',
    title: 'Faded',
    artists: ['Alan Walker'],
    durationMs: 212_000,
  };

  it('prefers an ISRC when there is one', () => {
    expect(buildSearchQuery({ ...track, isrc: 'GBUM71029604' })).toBe('isrc:GBUM71029604');
  });

  it('falls back to artist and title', () => {
    expect(buildSearchQuery(track)).toBe('Alan Walker - Faded');
  });

  it('strips remaster noise that hurts matching', () => {
    expect(buildSearchQuery({ ...track, title: 'Faded (2019 Remaster)' })).toBe(
      'Alan Walker - Faded',
    );
    expect(buildSearchQuery({ ...track, title: 'Faded - 2019 Remastered' })).toBe(
      'Alan Walker - Faded',
    );
  });

  it('scores an exact match above a near miss', () => {
    const exact = candidate({ durationMs: 212_000 });
    const wrongLength = candidate({ durationMs: 400_000 });

    expect(scoreCandidate(track, exact)).toBeGreaterThan(scoreCandidate(track, wrongLength));
  });

  it('de-ranks covers and sped-up edits', () => {
    const real = candidate();
    const cover = candidate({ title: 'Faded (cover)' });
    const sped = candidate({ title: 'Faded sped up' });

    expect(scoreCandidate(track, cover)).toBeLessThan(scoreCandidate(track, real));
    expect(scoreCandidate(track, sped)).toBeLessThan(scoreCandidate(track, real));
  });
});

describe('SpotifyResolver', () => {
  const track: SpotifyTrackMetadata = {
    id: 'sp1',
    title: 'Faded',
    artists: ['Alan Walker'],
    durationMs: 212_000,
    artworkUrl: 'https://i.scdn.co/image/abc',
    isrc: 'GBUM71029604',
  };

  let metadata: SpotifyMetadataClient;
  let audio: FakeSearchClient;
  let resolver: SpotifyResolver;

  beforeEach(() => {
    audio = new FakeSearchClient();
    metadata = {
      getTrack: vi.fn(async () => track),
      getAlbum: vi.fn(async () => null),
      getPlaylist: vi.fn(async () => ({
        id: 'pl1',
        name: 'Chill',
        tracks: [track, { ...track, id: 'sp2', title: 'Alone' }],
        totalCount: 2,
      })),
    };
    resolver = new SpotifyResolver(metadata, audio);
  });

  it('keeps Spotify metadata but plays the audio source', async () => {
    const resolved = await resolver.resolveTrack(
      parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT'),
    );

    expect(resolved?.title).toBe('Faded');
    expect(resolved?.artworkUrl).toBe('https://i.scdn.co/image/abc');
    // Playback comes from the audio provider, never from Spotify itself.
    expect(resolved?.identifier).toBe('abc');
    expect(resolved?.metadata?.playbackSource).toBe('youtube');
    expect(resolved?.metadata?.isrc).toBe('GBUM71029604');
  });

  it('falls back to a text search when the ISRC finds nothing', async () => {
    let call = 0;
    audio.search = async (query: string) => {
      audio.queries.push(query);
      call += 1;
      return call === 1 ? [] : [candidate()];
    };

    const resolved = await resolver.resolveTrack(
      parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT'),
    );

    expect(resolved).not.toBeNull();
    expect(audio.queries[0]).toContain('isrc:');
    expect(audio.queries[1]).toBe('Alan Walker - Faded');
  });

  it('reports when nothing playable exists', async () => {
    audio.results = [];
    audio.search = async () => [];

    await expect(
      resolver.resolveTrack(parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a missing track distinctly from a missing match', async () => {
    metadata.getTrack = vi.fn(async () => null);

    await expect(
      resolver.resolveTrack(parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(audio.queries).toHaveLength(0);
  });

  it('imports a playlist without searching for every entry up front', async () => {
    const playlist = await resolver.resolvePlaylist(
      parseInput('https://open.spotify.com/playlist/4cOdK2wGLETKBW3PvgPWqT'),
    );

    expect(playlist?.tracks).toHaveLength(2);
    // Deferring the audio lookup is what keeps a 500-track import cheap.
    expect(audio.queries).toHaveLength(0);
    expect(playlist?.tracks[0]?.metadata?.needsAudioLookup).toBe(true);
  });

  it('applies the playlist cap', async () => {
    metadata.getPlaylist = vi.fn(async () => ({
      id: 'pl1',
      name: 'Huge',
      tracks: Array.from({ length: 30 }, (_, index) => ({ ...track, id: `sp${index}` })),
      totalCount: 30,
    }));

    const playlist = await resolver.resolvePlaylist(
      parseInput('https://open.spotify.com/playlist/4cOdK2wGLETKBW3PvgPWqT'),
      { maxPlaylistSize: 5 },
    );

    expect(playlist?.tracks).toHaveLength(5);
    expect(playlist?.truncated).toBe(true);
  });
});

describe('RadioResolver', () => {
  const resolver = new RadioResolver({ allowedHosts: ['radio.example.com'] });

  it('resolves a preset by key or genre', async () => {
    const byKey = await resolver.resolveTrack(parseInput('lofi'));
    expect(byKey?.title).toBe('Lo-fi Beats');
    expect(byKey?.isStream).toBe(true);
    expect(byKey?.durationMs).toBe(0);
  });

  it('allows a configured station even when its host is not listed', async () => {
    // The operator picked these URLs explicitly.
    expect(resolver.isAllowed('https://ice1.somafm.com/groovesalad-128-mp3')).toBe(true);
  });

  it('allows an allowlisted host and its subdomains', () => {
    expect(resolver.isAllowed('https://radio.example.com/stream.mp3')).toBe(true);
    expect(resolver.isAllowed('https://cdn.radio.example.com/stream.mp3')).toBe(true);
  });

  it('refuses hosts that are not allowlisted', async () => {
    await expect(
      resolver.resolveTrack(parseInput('https://internal.corp/admin')),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE' });
  });

  it('refuses a lookalike host', () => {
    // `radio.example.com.evil.tld` must not pass an endsWith check.
    expect(resolver.isAllowed('https://radio.example.com.evil.tld/stream')).toBe(false);
    expect(resolver.isAllowed('https://notradio.example.com/stream')).toBe(false);
  });

  it('refuses non-http schemes', () => {
    expect(resolver.isAllowed('file:///etc/passwd')).toBe(false);
    expect(resolver.isAllowed('gopher://x/1')).toBe(false);
    expect(resolver.isAllowed('nonsense')).toBe(false);
  });

  it('only claims searches that name a station', () => {
    expect(resolver.canHandle(parseInput('lofi'))).toBe(true);
    expect(resolver.canHandle(parseInput('faded alan walker'))).toBe(false);
  });
});

describe('ResolverRegistry', () => {
  let audio: FakeSearchClient;
  let registry: ResolverRegistry;

  beforeEach(() => {
    audio = new FakeSearchClient();
    registry = new ResolverRegistry({ retryAttempts: 1 });
    registry.registerAll([
      new RadioResolver({ allowedHosts: ['radio.example.com'] }),
      new YouTubeResolver(audio),
    ]);
  });

  it('rejects a duplicate resolver name', () => {
    expect(() => registry.register(new YouTubeResolver(audio))).toThrow(/Duplicate/);
  });

  it('routes a YouTube link to the YouTube resolver', async () => {
    const result = await registry.resolve('https://youtu.be/dQw4w9WgXcQ');
    expect(result.kind).toBe('track');
  });

  it('routes a station name to radio, ahead of the search provider', async () => {
    const result = await registry.resolve('lofi');
    expect(result.kind).toBe('track');
    if (result.kind === 'track') expect(result.track.source).toBe('radio');
  });

  it('returns a playlist for a playlist link', async () => {
    audio.playlist = { name: 'Mix', source: 'youtube', tracks: [candidate()] };
    const result = await registry.resolve('https://www.youtube.com/playlist?list=PL1');

    expect(result.kind).toBe('playlist');
  });

  it('reports an empty result rather than inventing one', async () => {
    audio.playlist = { name: 'Mix', source: 'youtube', tracks: [] };
    const result = await registry.resolve('https://www.youtube.com/playlist?list=PL1');

    expect(result.kind).toBe('empty');
  });

  it('refuses a source the guild disabled', async () => {
    await expect(
      registry.resolve('https://youtu.be/dQw4w9WgXcQ', { allowedSources: ['soundcloud'] }),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE' });
  });

  it('reports when nothing can handle the input', async () => {
    const bare = new ResolverRegistry();
    await expect(bare.resolve('anything')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps searching other providers when one fails', async () => {
    const failing = new YouTubeResolver({
      search: async () => {
        throw new ResolverError('PROVIDER_ERROR', 'down');
      },
      loadUrl: async () => [],
    });
    Object.defineProperty(failing, 'name', { value: 'youtube-b' });

    const combined = new ResolverRegistry({ retryAttempts: 1 });
    combined.registerAll([failing, new YouTubeResolver(audio)]);

    await expect(combined.search('faded')).resolves.toHaveLength(1);
  });

  it('exposes per-resolver circuit state for metrics', () => {
    expect(registry.health()).toMatchObject({ radio: 'closed', youtube: 'closed' });
  });

  it('lists the sources it can serve', () => {
    expect(registry.sources().sort()).toEqual(['radio', 'youtube']);
  });
});
