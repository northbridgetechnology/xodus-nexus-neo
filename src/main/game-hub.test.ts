import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { GameHubStore, mergePlayedGames, validateDiscord } from './game-hub-store';
import { DiscordPresence, discordActivity, discordFrame } from './discord-presence';
import { RemotePlayTransport } from './remote-play-api';
const roots: string[] = [], clients: DiscordPresence[] = [], sockets: net.Socket[] = [], servers: net.Server[] = [];
afterEach(async () => { clients.splice(0).forEach(c => c.dispose()); sockets.splice(0).forEach(s => s.destroy()); await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve())))); await Promise.all(roots.splice(0).map(r => fs.rm(r, { recursive: true, force: true }))); });
const game = { title: 'Halo Infinite', productId: '9NP1P1WFS0LB', cloudId: 'HALOINFINITE', mode: 'cloud' as const, lastPlayed: '2026-10-21T00:00:00Z' };
it('persists actual play sessions across restarts without requiring downloaded games, deduplicating modes and preserving IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-history-')); roots.push(root);
  const store = new GameHubStore(root, () => {}); await store.record(game);
  await store.record({ ...game, mode: 'local', gameId: 'local-game', lastPlayed: '2026-10-21T01:00:00Z' }); await store.flush();
  const restored = new GameHubStore(root, () => {}); await restored.load();
  expect(restored.recent).toHaveLength(1); expect(restored.recent[0]).toMatchObject({ title: game.title, mode: 'local', modes: expect.arrayContaining(['local', 'cloud']), cloudId: game.cloudId, gameId: 'local-game' });
  expect(mergePlayedGames([{ ...restored.recent[0], coverUrl: 'https://evil.test/track' }])[0].coverUrl).toBeUndefined();
});
it('validates Discord settings and requires an application ID only when enabling sharing', () => {
  expect(validateDiscord({ enabled: false, applicationId: '' })).toEqual({ enabled: false, applicationId: '' });
  expect(() => validateDiscord({ enabled: true, applicationId: '' })).toThrow('application ID');
  expect(() => validateDiscord({ enabled: true, applicationId: 'bot-token' })).toThrow();
  expect(discordActivity({ id: 'game', title: 'Halo', mode: 'cloud', startedAt: 100000 })).toEqual({ details: 'Halo', state: 'Xbox Cloud Gaming', timestamps: { start: 100 }, instance: false });
  expect(discordActivity()).toBeNull();
});
it('uses Discord local IPC, handles split frames and ping, and clears activity when sharing is disabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-discord-')); roots.push(root);
  const messages: any[] = []; let pongs = 0;
  const server = net.createServer(socket => {
    sockets.push(socket); let pending = Buffer.alloc(0);
    socket.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 8 && pending.length >= 8 + pending.readUInt32LE(4)) {
        const op = pending.readUInt32LE(0), length = pending.readUInt32LE(4), body = JSON.parse(pending.subarray(8, 8 + length).toString()); pending = pending.subarray(8 + length);
        if (op === 0) { expect(body).toEqual({ v: 1, client_id: '123456789012345678' }); const ready = discordFrame(1, { evt: 'READY' }); socket.write(ready.subarray(0, 4)); socket.write(ready.subarray(4)); socket.write(discordFrame(3, { ping: true })); }
        if (op === 1) messages.push(body); if (op === 4) pongs++;
      }
    });
  }); servers.push(server); server.listen(path.join(root, 'discord-ipc-0')); await once(server, 'listening');
  const client = new DiscordPresence(() => {}, [root]); clients.push(client);
  client.update({ id: 'cloud', title: 'Halo Infinite', mode: 'cloud', startedAt: Date.now() }); client.configure({ enabled: true, applicationId: '123456789012345678' });
  await vi.waitFor(() => expect(messages.some(m => m.args.activity?.state === 'Xbox Cloud Gaming')).toBe(true));
  expect(client.status.state).toBe('connected'); expect(pongs).toBe(1);
  client.configure({ enabled: false, applicationId: '' }); await vi.waitFor(() => expect(messages.at(-1)?.args.activity).toBeNull()); expect(client.status.state).toBe('disabled');
});
it('reads account-wide Xbox history with pagination, strips unrelated fields and refuses another user’s response', async () => {
  const auth = { base: 'https://region.xboxlive.com', token: 'secret', webToken: 'web-secret', userHash: 'hash', expiresAt: Date.now() + 10000 };
  const calls: string[] = [];
  const api = new RemotePlayTransport(vi.fn(async (url, options) => {
    const headers = new Headers(options?.headers);
    expect(headers.get('x-xbl-client-name')).toBe('XboxApp');
    expect(headers.get('x-xbl-client-type')).toBe('UWA');
    calls.push(String(url));
    if (String(url).includes('profile.xboxlive.com')) return Response.json({ profileUsers: [{ id: '123' }] });
    return Response.json({ xuid: '123', titles: [{ titleId: '12345', name: 'Halo Infinite', type: 'Game', productId: game.productId, privateToken: 'not-for-renderer', displayImage: 'http://store-images.microsoft.com/image/test', titleHistory: { visible: true, lastTimePlayed: game.lastPlayed } }, { titleId: '99', name: 'Hidden game', type: 'Game', titleHistory: { visible: false, lastTimePlayed: game.lastPlayed } }], pagingInfo: calls.length === 2 ? { continuationToken: 'next-page' } : {} });
  }));
  const result = await api.xboxRecent(auth, new AbortController().signal); expect(result).toHaveLength(2); expect(result[0].coverUrl).toMatch(/^https:\/\/store-images.microsoft.com\//); expect(calls[1]).toContain('detail,image,productId'); expect(calls[2]).toContain('continuationToken=next-page'); expect(JSON.stringify(result)).not.toContain('not-for-renderer');
  const bad = new RemotePlayTransport(vi.fn(async url => String(url).includes('profile.xboxlive.com') ? Response.json({ profileUsers: [{ id: '123' }] }) : Response.json({ xuid: 'another-user', titles: [] })));
  await expect(bad.xboxRecent(auth, new AbortController().signal)).rejects.toThrow('unreadable');
});
