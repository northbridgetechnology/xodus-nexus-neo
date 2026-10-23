import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EncryptedStreamingBrowseCache, cleanBrowse, type BrowseSnapshot } from './streaming-browse-cache';
import { RemotePlayManager } from './remote-play';
const cloud = { id: 'halo', productId: '9NP1P1WFS0LB', title: 'Halo Infinite', entitled: true, genres: ['Shooter'], coverUrl: 'https://store-images.s-microsoft.com/image/test' };
const recent = { id: 'xbox:123', titleId: '123', title: 'Halo Infinite', mode: 'xbox' as const, modes: ['xbox' as const], lastPlayed: new Date().toISOString() };
const roots: string[] = [], managers: RemotePlayManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.dispose())); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); vi.restoreAllMocks(); });
it('restores bounded encrypted snapshots only for their saved account and ignores corrupt or expired files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xodus-browse-')); roots.push(root);
  const values = new Map<string, string>(); let seq = 0;
  const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => { const id = `opaque-${++seq}`; values.set(id, value); return Buffer.from(id); }, decryptString: (value: Buffer) => values.get(value.toString())! };
  const cache = new EncryptedStreamingBrowseCache(root, encryption);
  await cache.write('account-one', { cloud: { at: Date.now(), games: [{ ...cloud, access_token: 'must-not-cache' } as any] }, recent: { at: Date.now(), games: [recent] } });
  const file = path.join(root, 'remote-play/browse-cache.enc');
  expect((await readFile(file, 'utf8'))).toMatch(/^opaque-/); expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect([...values.values()].join()).not.toContain('must-not-cache');
  expect((await new EncryptedStreamingBrowseCache(root, encryption).read('account-one')).cloud?.games[0].title).toBe('Halo Infinite');
  expect(await cache.read('account-two')).toEqual({});
  expect(cleanBrowse({ cloud: { at: Date.now() - 8 * 86400_000, games: [cloud] }, recent: { at: Date.now() + 86400_000, games: [recent] } })).toEqual({});
  await writeFile(file, 'broken'); expect(await cache.read('account-one')).toEqual({});
  await cache.write('account-one', { recent: { at: Date.now(), games: [recent] } }); await cache.clear(); expect(await cache.read('account-one')).toEqual({});
});
function fixture(snapshot: BrowseSnapshot) {
  const token = { access_token: 'private-access', refresh_token: 'private-refresh', expiresAt: Date.now() + 3600_000, cacheId: 'account-one' };
  const auth = { base: 'https://westus.gssv-play-prod.xboxlive.com', token: 'private-stream', webToken: 'private-web', userHash: 'private-hash', expiresAt: Date.now() + 3600_000 };
  const credentials = { read: vi.fn(async () => token), write: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const cache = { read: vi.fn(async () => structuredClone(snapshot)), write: vi.fn(async () => {}), clear: vi.fn(async () => {}), flush: vi.fn(async () => {}) };
  const api = { refresh: vi.fn(async () => token), authorize: vi.fn(async () => auth), authorizeCloud: vi.fn(async () => auth),
    xboxRecent: vi.fn(async () => [{ ...recent, title: 'Newly played game' }]), cloudTitles: vi.fn(async () => ({ games: [{ ...cloud, title: 'Fresh catalog' }] })) };
  const changed = vi.fn(), recentChanged = vi.fn();
  const manager = new RemotePlayManager(credentials, changed, api as any, undefined, undefined, cache, recentChanged); managers.push(manager);
  return { manager, api, cache, credentials, changed, recentChanged };
}
it('serves warm catalog and history after restart without network and keeps explicit Refresh live', async () => {
  const { manager, api, cache } = fixture({ cloud: { at: Date.now(), games: [cloud] }, recent: { at: Date.now(), games: [recent] } });
  await manager.initialize(); expect(manager.cloudCurrent.games[0].title).toBe('Halo Infinite');
  await manager.refreshCloudCatalog(false); expect((await manager.recentlyPlayed())[0].title).toBe('Halo Infinite');
  expect(api.refresh).not.toHaveBeenCalled(); expect(api.cloudTitles).not.toHaveBeenCalled(); expect(api.xboxRecent).not.toHaveBeenCalled();
  const copy = await manager.recentlyPlayed(); copy[0].title = 'changed'; expect(manager.recentCurrent[0].title).toBe('Halo Infinite');
  await manager.refreshCloudCatalog(); expect(manager.cloudCurrent.games[0].title).toBe('Fresh catalog');
  expect((await manager.recentlyPlayed(true))[0].title).toBe('Newly played game'); expect(cache.write).toHaveBeenCalled();
  expect(JSON.stringify(cache.write.mock.calls)).not.toContain('private-');
});
it('returns stale history immediately, coalesces background requests and publishes fresh results', async () => {
  const { manager, api, recentChanged } = fixture({ recent: { at: Date.now() - 10 * 60_000, games: [recent] } });
  let finish!: (games: typeof recent[]) => void; api.xboxRecent.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await manager.initialize(); expect((await manager.recentlyPlayed())[0].title).toBe('Halo Infinite');
  await vi.waitFor(() => expect(api.xboxRecent).toHaveBeenCalledOnce());
  expect((await manager.recentlyPlayed())[0].title).toBe('Halo Infinite'); expect(api.xboxRecent).toHaveBeenCalledOnce();
  finish([{ ...recent, title: 'Fresh history' }]); await vi.waitFor(() => expect(manager.recentCurrent[0].title).toBe('Fresh history')); expect(recentChanged).toHaveBeenCalled();
});
it('preserves a usable catalog while stale refresh runs or fails, and clears snapshots on sign-out', async () => {
  const { manager, api, cache } = fixture({ cloud: { at: Date.now() - 7 * 3600_000, games: [cloud] }, recent: { at: Date.now(), games: [recent] } });
  await manager.initialize(); api.cloudTitles.mockRejectedValueOnce(Error('Offline'));
  await expect(manager.refreshCloudCatalog(false)).rejects.toThrow('Offline'); expect(manager.cloudCurrent.games[0].title).toBe('Halo Infinite');
  await manager.signOut(); expect(manager.cloudCurrent.games).toEqual([]); expect(manager.recentCurrent).toEqual([]); expect(cache.clear).toHaveBeenCalledOnce();
  await expect(manager.recentlyPlayed()).rejects.toThrow('Sign in');
});
it('does not restore account data for a session without remembered credentials', async () => {
  const { manager, credentials, cache } = fixture({ cloud: { at: Date.now(), games: [cloud] } });
  credentials.read.mockResolvedValue(undefined as any); await manager.initialize(); expect(cache.read).not.toHaveBeenCalled(); expect(manager.cloudCurrent.games).toEqual([]);
});
