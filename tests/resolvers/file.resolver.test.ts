import { describe, expect, it, vi } from 'vitest';

import {
  FileResolver,
  fileNameOf,
  parseInput,
  RadioResolver,
  ResolverError,
  type TrackCandidate,
  type TrackSearchClient,
} from '../../src/resolvers';

const UPLOAD = 'https://cdn.discordapp.com/attachments/1/2/Ch%C4%83m_Hoa_MONO.mp3?ex=abc&is=def';

function client(
  tracks: TrackCandidate[],
): TrackSearchClient & { loadUrl: ReturnType<typeof vi.fn> } {
  const loadUrl = vi.fn(async () => tracks);
  return { search: vi.fn(async () => []), loadUrl } as unknown as TrackSearchClient & {
    loadUrl: ReturnType<typeof vi.fn>;
  };
}

const TAGGED: TrackCandidate = {
  source: 'http',
  identifier: UPLOAD,
  title: 'Chăm Hoa',
  author: 'MONO',
  durationMs: 245_000,
  uri: UPLOAD,
};

const UNTAGGED: TrackCandidate = {
  source: 'http',
  identifier: UPLOAD,
  title: 'Unknown title',
  author: 'Unknown artist',
  durationMs: 245_000,
};

describe('reading a file name from a URL', () => {
  it('takes the name and drops the path, query and extension', () => {
    expect(fileNameOf(UPLOAD)).toBe('Chăm Hoa MONO');
  });

  it('keeps a name that has no decoration', () => {
    expect(fileNameOf('https://cdn.discordapp.com/attachments/1/2/demo.flac')).toBe('demo');
  });

  it('has something to say about a URL with no file in it', () => {
    expect(fileNameOf('https://cdn.discordapp.com/')).toBe('Uploaded file');
    expect(fileNameOf('not a url at all')).toBe('not a url at all');
  });

  it('survives a broken escape rather than throwing', () => {
    expect(fileNameOf('https://cdn.discordapp.com/attachments/1/2/%E0%A4%A.mp3')).toBe('%E0%A4%A');
  });
});

describe('FileResolver', () => {
  it('plays an upload from Discord', async () => {
    const backend = client([TAGGED]);
    const resolver = new FileResolver(backend);

    const track = await resolver.resolveTrack(parseInput(UPLOAD));

    expect(backend.loadUrl).toHaveBeenCalledWith(UPLOAD, {});
    expect(track).toMatchObject({ title: 'Chăm Hoa', author: 'MONO', durationMs: 245_000 });
  });

  it('treats it as a track, not a stream', async () => {
    // A stream has no end and no position; a file has both, which is what
    // makes seek, the progress bar and the timestamps work on it.
    const resolver = new FileResolver(client([{ ...TAGGED, isStream: true }]));

    const track = await resolver.resolveTrack(parseInput(UPLOAD));

    expect(track?.isStream).toBe(false);
  });

  it('falls back to the file name when the file has no tags', async () => {
    const resolver = new FileResolver(client([UNTAGGED]));

    const track = await resolver.resolveTrack(parseInput(UPLOAD));

    expect(track).toMatchObject({ title: 'Chăm Hoa MONO', author: 'Uploaded file' });
  });

  it('refuses a host that is not on the allowlist', async () => {
    const backend = client([TAGGED]);
    const resolver = new FileResolver(backend);
    const input = parseInput('https://evil.example.com/track.mp3');

    expect(resolver.canHandle(input)).toBe(false);
    expect(await resolver.resolveTrack(input)).toBeNull();
    // Never fetched: an allowlist that asks first is not an allowlist.
    expect(backend.loadUrl).not.toHaveBeenCalled();
  });

  it('takes a host the operator did allow', () => {
    const resolver = new FileResolver(client([TAGGED]), { allowedHosts: ['files.example.com'] });

    expect(resolver.canHandle(parseInput('https://files.example.com/a/track.mp3'))).toBe(true);
    expect(resolver.canHandle(parseInput('https://cdn.discordapp.com/a/track.mp3'))).toBe(false);
  });

  it('allows a subdomain of an allowed host, and not a lookalike', () => {
    const resolver = new FileResolver(client([TAGGED]));

    expect(resolver.isAllowed('https://images.cdn.discordapp.com/a.mp3')).toBe(true);
    expect(resolver.isAllowed('https://cdn.discordapp.com.evil.test/a.mp3')).toBe(false);
  });

  it('refuses anything that is not http', () => {
    const resolver = new FileResolver(client([TAGGED]));

    expect(resolver.isAllowed('file:///etc/passwd')).toBe(false);
    expect(resolver.isAllowed('not a url')).toBe(false);
  });

  it('leaves a page that is not an audio file alone', () => {
    const resolver = new FileResolver(client([TAGGED]));

    expect(resolver.canHandle(parseInput('https://cdn.discordapp.com/attachments/1/2/notes'))).toBe(
      false,
    );
  });

  it('says what went wrong when the node cannot read the file', async () => {
    const resolver = new FileResolver(client([]));

    await expect(resolver.resolveTrack(parseInput(UPLOAD))).rejects.toBeInstanceOf(ResolverError);
    await expect(resolver.resolveTrack(parseInput(UPLOAD))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      options: { userFacing: true },
    });
  });

  it('leaves radio stations to the radio resolver', () => {
    const file = new FileResolver(client([TAGGED]));
    const radio = new RadioResolver();
    const station = parseInput('https://ice1.somafm.com/groovesalad-128-mp3');

    expect(file.canHandle(station)).toBe(false);
    expect(radio.canHandle(station)).toBe(true);
  });
});
