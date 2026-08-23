import { describe, expect, it } from 'vitest';

import {
  describeResolverError,
  LavaSrcResolver,
  ResolverError,
  type TrackCandidate,
} from '../../src/resolvers';
import { parseInput } from '../../src/resolvers/url';

function candidate(title: string, index = 0): TrackCandidate {
  return {
    source: 'spotify',
    identifier: `id-${index}`,
    title,
    author: 'MONO',
    durationMs: 200_000,
  };
}

/** A node that answers with a canned load and records what it was asked. */
function node(responses: { loadUrl?: TrackCandidate[] } = {}): {
  client: ConstructorParameters<typeof LavaSrcResolver>[0];
  urls: string[];
} {
  const urls: string[] = [];

  return {
    urls,
    client: {
      search: async () => [],
      loadUrl: async (url: string) => {
        urls.push(url);
        return (responses.loadUrl ?? []) as TrackCandidate[];
      },
    },
  };
}

const TRACK_URL = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
const ALBUM_URL = 'https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT';

describe('LavaSrcResolver', () => {
  it('takes Spotify links and nothing else', () => {
    const resolver = new LavaSrcResolver(node().client);

    expect(resolver.canHandle(parseInput(TRACK_URL))).toBe(true);
    expect(resolver.canHandle(parseInput('https://youtu.be/abc'))).toBe(false);
  });

  it('hands a track link to the node as it was pasted', async () => {
    const { client, urls } = node({ loadUrl: [candidate('Chăm Hoa')] });

    const track = await new LavaSrcResolver(client).resolveTrack(parseInput(TRACK_URL));

    expect(track?.title).toBe('Chăm Hoa');
    expect(urls).toEqual([TRACK_URL]);
  });

  it('rebuilds the URL for a `spotify:track:` uri', async () => {
    const { client, urls } = node({ loadUrl: [candidate('Chăm Hoa')] });

    await new LavaSrcResolver(client).resolveTrack(
      parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT'),
    );

    expect(urls[0]).toContain('open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  });

  it('says the node has no Spotify support rather than "unavailable"', async () => {
    const { client } = node({ loadUrl: [] });

    // Almost always a missing plugin or missing credentials — an operator
    // problem, and "unavailable" sends them looking at the wrong thing.
    await expect(
      new LavaSrcResolver(client).resolveTrack(parseInput(TRACK_URL)),
    ).rejects.toThrowError(ResolverError);
    await expect(new LavaSrcResolver(client).resolveTrack(parseInput(TRACK_URL))).rejects.toThrow(
      /not enabled on the audio node/i,
    );
  });

  it('leaves a YouTube link to the resolver that owns it', async () => {
    const { client } = node({ loadUrl: [candidate('Chăm Hoa')] });

    expect(await new LavaSrcResolver(client).resolveTrack(parseInput('https://youtu.be/abc'))).toBe(
      null,
    );
  });

  describe('albums and playlists', () => {
    it('uses the node’s playlist load when it has one', async () => {
      const resolver = new LavaSrcResolver({
        search: async () => [],
        loadUrl: async () => [],
        loadPlaylist: async () => ({
          name: 'Chill Tối Muộn',
          source: 'spotify' as const,
          url: ALBUM_URL,
          tracks: [candidate('One', 1), candidate('Two', 2)],
          totalCount: 2,
          truncated: false,
        }),
      });

      const playlist = await resolver.resolvePlaylist(parseInput(ALBUM_URL));

      expect(playlist?.name).toBe('Chill Tối Muộn');
      expect(playlist?.tracks).toHaveLength(2);
    });

    it('caps a playlist at the queue limit and says it was capped', async () => {
      const resolver = new LavaSrcResolver({
        search: async () => [],
        loadUrl: async () => [],
        loadPlaylist: async () => ({
          name: 'Long',
          source: 'spotify' as const,
          url: ALBUM_URL,
          tracks: Array.from({ length: 10 }, (_, index) => candidate(`Track ${index}`, index)),
          totalCount: 10,
          truncated: false,
        }),
      });

      const playlist = await resolver.resolvePlaylist(parseInput(ALBUM_URL), {
        maxPlaylistSize: 3,
      });

      expect(playlist?.tracks).toHaveLength(3);
      expect(playlist?.truncated).toBe(true);
      expect(playlist?.totalCount).toBe(10);
    });

    it('falls back to a plain load on a node that does not separate playlists', async () => {
      const { client } = node({ loadUrl: [candidate('One', 1), candidate('Two', 2)] });

      const playlist = await new LavaSrcResolver(client).resolvePlaylist(parseInput(ALBUM_URL));

      expect(playlist?.tracks).toHaveLength(2);
      expect(playlist?.name).toBe('Spotify album');
    });

    it('reports an unsupported link for an empty playlist load', async () => {
      const { client } = node({ loadUrl: [] });

      await expect(
        new LavaSrcResolver(client).resolvePlaylist(parseInput(ALBUM_URL)),
      ).rejects.toThrow(/not enabled on the audio node/i);
    });

    it('leaves a single track to resolveTrack', async () => {
      const { client } = node({ loadUrl: [candidate('One')] });

      expect(await new LavaSrcResolver(client).resolvePlaylist(parseInput(TRACK_URL))).toBe(null);
    });
  });
});

describe('describeResolverError', () => {
  it('prefers a message the resolver wrote for the situation', () => {
    const error = new ResolverError('UNAVAILABLE', 'Spotify links are not enabled.', {
      userFacing: true,
    });

    // Otherwise a missing plugin reads as "that track is unavailable", which
    // sends the reader looking at the wrong thing.
    expect(describeResolverError(error)).toBe('Spotify links are not enabled.');
  });

  it('still maps by code for an error with no message of its own', () => {
    const error = new ResolverError('UNAVAILABLE', 'internal detail nobody should read');

    expect(describeResolverError(error)).toBe('That track is unavailable. Skipping it.');
  });

  it('reaches the user through a play command', async () => {
    const { client } = node({ loadUrl: [] });
    const resolver = new LavaSrcResolver(client);

    await expect(resolver.resolveTrack(parseInput(TRACK_URL))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ResolverError &&
        describeResolverError(error).includes('not enabled on the audio node'),
    );
  });
});
