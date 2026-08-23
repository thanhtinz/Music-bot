import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerManager } from '../../src/application/player';
import { dedupeNodes, parseNodes } from '../../src/config/nodes';
import { createTrack, type Track } from '../../src/domain/music';
import { FakeAudioBackend } from '../helpers/fake-audio-backend';

function song(title: string): Track {
  return createTrack({
    source: 'youtube',
    identifier: title.toLowerCase(),
    title,
    author: 'Artist',
    durationMs: 200_000,
    requesterId: 'user',
  });
}

/** Lets the manager's own awaits settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseNodes', () => {
  it('reads one node', () => {
    expect(parseNodes('backup@10.0.0.5:2333:secretpass').nodes).toEqual([
      { name: 'backup', url: '10.0.0.5:2333', auth: 'secretpass', secure: false },
    ]);
  });

  it('reads several, ignoring the spaces people leave', () => {
    const { nodes } = parseNodes('a@h1:2333:p1, b@h2:2334:p2');

    expect(nodes.map((node) => node.name)).toEqual(['a', 'b']);
    expect(nodes[1]?.url).toBe('h2:2334');
  });

  it('marks a node secure when told to', () => {
    expect(parseNodes('a@h:443:p:secure').nodes[0]?.secure).toBe(true);
    expect(parseNodes('a@h:443:p:tls').nodes[0]?.secure).toBe(true);
    expect(parseNodes('a@h:2333:p').nodes[0]?.secure).toBe(false);
  });

  it('skips an entry it cannot read rather than failing the lot', () => {
    const { nodes, rejected } = parseNodes('good@h:2333:p, nonsense, also@bad');

    expect(nodes.map((node) => node.name)).toEqual(['good']);
    expect(rejected).toEqual(['nonsense', 'also@bad']);
  });

  it('reads an empty setting as no extra nodes', () => {
    expect(parseNodes('')).toEqual({ nodes: [], rejected: [] });
    expect(parseNodes('  ,  ')).toEqual({ nodes: [], rejected: [] });
  });
});

describe('dedupeNodes', () => {
  const node = (name: string, url: string) => ({ name, url, auth: 'p', secure: false });

  it('drops a repeated name', () => {
    const kept = dedupeNodes([node('main', 'h1:2333'), node('main', 'h2:2333')]);
    expect(kept).toHaveLength(1);
  });

  it('drops a repeated address, whatever it is called', () => {
    // Otherwise Shoukaku connects to the same node twice.
    const kept = dedupeNodes([node('main', 'h:2333'), node('backup', 'h:2333')]);
    expect(kept.map((entry) => entry.name)).toEqual(['main']);
  });

  it('keeps genuinely different nodes', () => {
    expect(dedupeNodes([node('a', 'h1:2333'), node('b', 'h2:2333')])).toHaveLength(2);
  });
});

describe('failover when a node is lost', () => {
  let backend: FakeAudioBackend;
  let manager: PlayerManager;

  beforeEach(() => {
    backend = new FakeAudioBackend();
    manager = new PlayerManager(backend, { maxQueueSize: 20 });
  });

  it('reconnects a player that was on the lost node', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Faded'));
    backend.calls.length = 0;

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['guild'] });
    await settle();

    // The guild has to be handed to another node, which means connecting again.
    expect(backend.calls).toContain('connect:guild:voice');
    expect(manager.has('guild')).toBe(true);
  });

  it('picks the track back up where it was', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Faded'));
    await player.seek(30_000);
    backend.calls.length = 0;

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['guild'] });
    await settle();

    expect(backend.calls).toContain('play:guild:Faded');
    expect(backend.calls).toContain('seek:guild:30000');
    expect(player.status).toBe('playing');
  });

  it('keeps the queue and the history', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue([song('One'), song('Two')]);

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['guild'] });
    await settle();

    expect(player.queue.current?.title).toBe('One');
    expect(player.queue.tracks.map((track) => track.title)).toEqual(['Two']);
  });

  it('stays paused across a failover', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Faded'));
    await player.pause();

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['guild'] });
    await settle();

    expect(player.status).toBe('paused');
  });

  it('moves every guild that was on the node', async () => {
    for (const guildId of ['one', 'two']) {
      const player = await manager.getOrCreate({ guildId, voiceChannelId: `voice-${guildId}` });
      await player.enqueue(song('Track'));
    }
    backend.calls.length = 0;

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['one', 'two'] });
    await settle();

    expect(backend.calls).toContain('connect:one:voice-one');
    expect(backend.calls).toContain('connect:two:voice-two');
  });

  it('leaves guilds that were on another node alone', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Faded'));
    backend.calls.length = 0;

    backend.events.emit('nodeLost', { node: 'other', guildIds: ['somebody-else'] });
    await settle();

    expect(backend.calls).toEqual([]);
  });

  it('survives a reconnect that fails', async () => {
    const player = await manager.getOrCreate({ guildId: 'guild', voiceChannelId: 'voice' });
    await player.enqueue(song('Faded'));
    backend.failNextConnect = true;

    backend.events.emit('nodeLost', { node: 'main', guildIds: ['guild'] });
    await settle();

    // The failure is reported, not thrown at the event loop.
    expect(player.status).toBe('error');
  });
});
