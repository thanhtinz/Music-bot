import { describe, expect, it } from 'vitest';

import { isBareMention, parseMessage, tokenize } from '../../src/application/commands';

const options = { prefix: '!', botUserId: '123456789' };

describe('parseMessage — prefix', () => {
  it('parses a command with arguments', () => {
    const parsed = parseMessage('!play chạy ngay đi', options);

    expect(parsed).toMatchObject({
      name: 'play',
      args: ['chạy', 'ngay', 'đi'],
      rest: 'chạy ngay đi',
      source: 'prefix',
    });
  });

  it('lowercases the command name but keeps argument casing', () => {
    expect(parseMessage('!PLAY Alan Walker', options)).toMatchObject({
      name: 'play',
      args: ['Alan', 'Walker'],
    });
  });

  it('supports a multi-character prefix', () => {
    expect(parseMessage('m!skip', { ...options, prefix: 'm!' })?.name).toBe('skip');
  });

  it('ignores messages that do not start with the prefix', () => {
    expect(parseMessage('play something', options)).toBeNull();
    expect(parseMessage('hello !play', options)).toBeNull();
  });

  it('ignores a bare prefix and blank input', () => {
    expect(parseMessage('!', options)).toBeNull();
    expect(parseMessage('   ', options)).toBeNull();
    expect(parseMessage('', options)).toBeNull();
  });

  it('tolerates padding around the message', () => {
    expect(parseMessage('   !pause   ', options)?.name).toBe('pause');
  });
});

describe('parseMessage — mention', () => {
  it('strips the mention before parsing', () => {
    expect(parseMessage('<@123456789> play faded', options)).toMatchObject({
      name: 'play',
      args: ['faded'],
      source: 'mention',
    });
  });

  it('accepts the legacy nickname mention form', () => {
    expect(parseMessage('<@!123456789> skip', options)?.name).toBe('skip');
  });

  it('ignores mentions of other users', () => {
    expect(parseMessage('<@999> play faded', options)).toBeNull();
  });

  it('returns null for a bare mention so the caller can show help', () => {
    expect(parseMessage('<@123456789>', options)).toBeNull();
    expect(isBareMention('<@123456789>  ', '123456789')).toBe(true);
    expect(isBareMention('<@123456789> play', '123456789')).toBe(false);
  });
});

describe('prefix and mention produce identical tokens', () => {
  it('agrees on name, args, and rest', () => {
    const viaPrefix = parseMessage('!queue add "Hãy Trao Cho Anh"', options);
    const viaMention = parseMessage('<@123456789> queue add "Hãy Trao Cho Anh"', options);

    expect(viaPrefix?.name).toBe(viaMention?.name);
    expect(viaPrefix?.args).toEqual(viaMention?.args);
    expect(viaPrefix?.rest).toBe(viaMention?.rest);
  });
});

describe('tokenize', () => {
  it('keeps quoted segments together', () => {
    expect(tokenize('play "shape of you" now')).toEqual(['play', 'shape of you', 'now']);
    expect(tokenize("play 'lạc trôi'")).toEqual(['play', 'lạc trôi']);
  });

  it('collapses repeated whitespace', () => {
    expect(tokenize('a   b \n c')).toEqual(['a', 'b', 'c']);
  });

  it('treats an unterminated quote as running to the end', () => {
    expect(tokenize('play "chạy ngay đi')).toEqual(['play', 'chạy ngay đi']);
  });

  it('returns an empty list for blank input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});
