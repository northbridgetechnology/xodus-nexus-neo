import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemotePlayManager } from './remote-play';
import { RemotePlayTransport, cloudImage, hydrateCloudGames, normalizeCloudGames } from './remote-play-api';
const token = { access_token: 'synthetic-access-secret', refresh_token: 'synthetic-refresh-secret', expiresAt: Date.now() + 3600_000 };
const home = { base: 'https://home.xboxlive.com', token: 'synthetic-home-secret', webToken: 'synthetic-web-secret', userHash: 'synthetic-hash', expiresAt: Date.now() + 3600_000 };
const cloud = { ...home, streamType: 'cloud' as const, token: 'synthetic-cloud-secret', region: 'WestUS', offering: 'xgpuweb' };
const game = { id: 'CLOUD_GAME', productId: '9ABCDEFGHIJK', title: 'Cloud game', entitled: true, genres: ['Adventure'] };
const xbox = { id: 'F123456789012345', name: 'Xbox', model: 'XboxSeriesX', powerState: 'On', streamingEnabled: true };
const managers: RemotePlayManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.dispose())); vi.restoreAllMocks(); });
function fixture() {
  const api = { refresh: vi.fn(async () => token), authorize: vi.fn(async () => home), authorizeCloud: vi.fn(async () => cloud),
    consoles: vi.fn(async () => [xbox]), cloudTitles: vi.fn(async () => ({ games: [game, { ...game, id: 'LOCKED', entitled: false }] })),
    stream: vi.fn(async (_auth, route, _method, _payload, _signal) => route === '/play' ? { sessionId: 'cloud-session-123' } : route.endsWith('/state') ? { state: 'Provisioned' } : undefined),
    exchange: vi.fn(async (_auth, _id, kind) => kind === 'sdp' ? { sdp: 'v=0\r\nanswer' } : []), transferToken: vi.fn(async () => 'synthetic-transfer-secret'),
  };
  const vault = { read: vi.fn(async () => token), write: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const changed = vi.fn(), cloudChanged = vi.fn(), display = vi.fn();
  const manager = new RemotePlayManager(vault, changed, api as any, display, cloudChanged); managers.push(manager);
  return { api, manager, changed, cloudChanged, display, vault };
}
describe('Cloud Gaming lifecycle', () => {
  it('reuses the saved streaming account without requiring home-console authorization, and keeps secrets out of both renderer states', async () => {
    const { manager, api, changed, cloudChanged } = fixture(); await manager.initialize(); await manager.refreshCloudCatalog();
    expect(manager.cloudCurrent).toMatchObject({ games: [game, expect.anything()], region: 'WestUS', offering: 'xgpuweb' });
    expect(api.authorize).not.toHaveBeenCalled(); expect(api.authorizeCloud).toHaveBeenCalledOnce();
    expect(JSON.stringify([changed.mock.calls, cloudChanged.mock.calls])).not.toMatch(/synthetic-.*secret|synthetic-hash/);
  });
  it('starts a cloud title with no serverId, shares the working SDP/input contract, and prevents simultaneous console streams', async () => {
    const { manager, api, display } = fixture(); await manager.initialize(); await manager.refreshConsoles(); await manager.refreshCloudCatalog();
    const { id } = await manager.connectCloud(game.id);
    expect(api.stream).toHaveBeenCalledWith(cloud, '/play', 'POST', expect.objectContaining({ titleId: game.id, serverId: '' }), expect.any(AbortSignal));
    expect(manager.current.session).toBeUndefined(); expect(manager.cloudCurrent.session?.phase).toBe('connecting');
    await expect(manager.connect(xbox.id)).rejects.toThrow('Disconnect');
    await manager.exchangeSdp(id, 'v=0\r\nclient-offer'); expect(api.exchange).toHaveBeenCalledWith(cloud, 'cloud-session-123', 'sdp', expect.anything(), expect.any(AbortSignal));
    manager.connectionState(id, 'connected'); expect(manager.cloudCurrent.session?.phase).toBe('connected'); expect(display).toHaveBeenLastCalledWith(true);
    await manager.disconnectKind('home'); expect(manager.cloudCurrent.session).toBeDefined();
    await manager.disconnectKind('cloud'); expect(manager.cloudCurrent.session).toBeUndefined(); expect(display).toHaveBeenLastCalledWith(false);
    await manager.connect(xbox.id); await expect(manager.connectCloud(game.id)).rejects.toThrow('Disconnect');
  });
  it('rejects unknown and unentitled games before calling play', async () => {
    const { manager, api } = fixture(); await manager.initialize(); await manager.refreshCloudCatalog();
    await expect(manager.connectCloud('../arbitrary')).rejects.toThrow('select a game');
    await expect(manager.connectCloud('LOCKED')).rejects.toThrow('does not have streaming access'); expect(api.stream).not.toHaveBeenCalled();
  });
  it('shows a cancellable resource queue and releases exactly its own cloud session', async () => {
    const { manager, api } = fixture(); await manager.initialize(); await manager.refreshCloudCatalog();
    api.stream.mockImplementation(async (_auth, route) => route === '/play' ? { sessionId: 'queued-session-123' } : route.endsWith('/state') ? { state: 'WaitingForResources', waitTimeDetails: { estimatedTotalWaitTimeInSeconds: 60 } } : undefined);
    const pending = manager.connectCloud(game.id); const rejection = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(manager.cloudCurrent.session).toMatchObject({ phase: 'queued', queueSeconds: 60 }));
    await manager.disconnectKind('cloud'); await rejection;
    expect(api.stream).toHaveBeenLastCalledWith(cloud, '/queued-session-123', 'DELETE', undefined, expect.any(AbortSignal)); expect(manager.cloudCurrent.session).toBeUndefined();
  });
  it('closes a late cloud play response after cancellation without restoring the session', async () => {
    const { manager, api } = fixture(); await manager.initialize(); await manager.refreshCloudCatalog();
    let answer!: (v: any) => void;
    api.stream.mockImplementation((_auth, route) => route === '/play' ? new Promise(resolve => { answer = resolve; }) : Promise.resolve(undefined));
    const pending = manager.connectCloud(game.id); const rejection = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(answer).toBeTypeOf('function')); await manager.disconnectKind('cloud'); answer({ sessionId: 'late-cloud-session' }); await rejection;
    expect(api.stream).toHaveBeenLastCalledWith(cloud, '/late-cloud-session', 'DELETE', undefined, expect.any(AbortSignal)); expect(manager.cloudCurrent.session).toBeUndefined();
  });
  it('clears the account-specific catalog and session on sign-out', async () => {
    const { manager, vault } = fixture(); await manager.initialize(); await manager.refreshCloudCatalog(); await manager.connectCloud(game.id);
    await manager.signOut(); expect(manager.current.auth).toBe('signed-out'); expect(manager.cloudCurrent).toEqual({ games: [], refreshing: false }); expect(vault.clear).toHaveBeenCalledOnce();
  });
  it('publishes a partial catalog and allows starting a game before background hydration finishes', async () => {
    const { manager, api } = fixture(); await manager.initialize();
    let finish!: (v: any) => void;
    (api.cloudTitles as any).mockImplementation(async (_auth: any, _signal: AbortSignal, progress: any) => {
      progress([game], { loaded: 1, total: 80 });
      return new Promise(resolve => { finish = resolve; });
    });
    const pending = manager.refreshCloudCatalog();
    await vi.waitFor(() => expect(manager.cloudCurrent.games).toEqual([game]));
    expect(manager.cloudCurrent).toMatchObject({ refreshing: true, loading: { loaded: 1, total: 80 } });
    await manager.connectCloud(game.id); expect(manager.cloudCurrent.session?.phase).toBe('connecting');
    finish({ games: [game] }); await pending;
    expect(manager.cloudCurrent.refreshing).toBe(false); expect(manager.cloudCurrent.loading).toBeUndefined();
  });
  it('ignores late partial catalog updates after sign-out', async () => {
    const { manager, api } = fixture(); await manager.initialize();
    let send!: (games: any[], loading: any) => void, finish!: (v: any) => void;
    (api.cloudTitles as any).mockImplementation(async (_auth: any, _signal: AbortSignal, progress: any) => {
      send = progress; return new Promise(resolve => { finish = resolve; });
    });
    const pending = manager.refreshCloudCatalog();
    await vi.waitFor(() => expect(send).toBeTypeOf('function'));
    const signout = manager.signOut(); send([game], { loaded: 1, total: 80 }); finish({ games: [game] });
    await Promise.all([pending, signout]); expect(manager.cloudCurrent).toEqual({ games: [], refreshing: false });
  });
  it('serializes OAuth refresh when console and cloud catalogs load together', async () => {
    const { manager, api } = fixture(); await manager.initialize();
    let answer!: (v: typeof token) => void; api.refresh.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const pending = Promise.all([manager.refreshConsoles(), manager.refreshCloudCatalog()]);
    await vi.waitFor(() => expect(answer).toBeTypeOf('function')); answer(token); await pending; expect(api.refresh).toHaveBeenCalledOnce();
  });
});
describe('Cloud Gaming transport', () => {
  it('authorizes the cloud offering without requesting the home offering or leaking response errors', async () => {
    const requests: any[] = [];
    const api = new RemotePlayTransport(vi.fn(async (url, options) => {
      const body = JSON.parse(String(options?.body)); requests.push({ url: String(url), body });
      if (String(url).includes('/user/authenticate')) return Response.json({ Token: 'synthetic-user-secret' });
      if (String(url).includes('/xsts/authorize')) return Response.json({ Token: 'synthetic-gssv-secret' });
      return Response.json({ gsToken: cloud.token, offeringSettings: { regions: [{ name: 'WestUS', baseUri: cloud.base, isDefault: true }] } });
    }));
    expect(await api.authorizeCloud(token, new AbortController().signal)).toMatchObject({ streamType: 'cloud', offering: 'xgpuweb', region: 'WestUS' });
    expect(requests[2]).toMatchObject({ url: 'https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user', body: { offeringId: 'xgpuweb' } }); expect(JSON.stringify(requests)).not.toContain('xhome');
  });
  it('falls back to the free-to-play offering only for access failures', async () => {
    const offerings: string[] = [];
    const api = new RemotePlayTransport(vi.fn(async (url, options) => {
      if (String(url).includes('/authenticate') || String(url).includes('/authorize')) return Response.json({ Token: 'secret' });
      const body = JSON.parse(String(options?.body)); offerings.push(body.offeringId);
      return body.offeringId === 'xgpuweb' ? new Response('private-account-error', { status: 403 }) : Response.json({ gsToken: 'secret', offeringSettings: { regions: [{ baseUri: cloud.base }] } });
    }));
    expect((await api.authorizeCloud(token, new AbortController().signal)).offering).toBe('xgpuwebf2p'); expect(offerings).toEqual(['xgpuweb', 'xgpuwebf2p']);
  });
  it('publishes the first 40 playable games before slow later pages and keeps visible cards in place', async () => {
    const entries = Array.from({ length: 82 }, (_, i) => ({ titleId: `GAME_${i}`, details: { productId: `P${String(i).padStart(11, '0')}`, hasEntitlement: i > 0 } }));
    const pages: string[][] = [], release: (() => void)[] = [];
    const response = (ids: string[]) => Response.json({ Products: Object.fromEntries(ids.map(id => [id, { ProductTitle: `Named ${id}` }])) });
    const fetcher = vi.fn(async (url, options) => {
      if (String(url).endsWith('/v2/titles')) return Response.json({ results: entries });
      if (String(url).includes('displaycatalog.mp.microsoft.com')) return Response.json({ Products: [] });
      const ids: string[] = JSON.parse(String(options?.body)).Products; pages.push(ids);
      if (pages.length === 1) return response(ids);
      return new Promise<Response>(resolve => release.push(() => resolve(response(ids))));
    });
    const updates: any[] = [];
    let finished = false;
    const pending = new RemotePlayTransport(fetcher).cloudTitles(cloud, new AbortController().signal, (games, loading) => updates.push({ games, loading })).then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(finished).toBe(false); expect(pages[0]).toHaveLength(40); expect(pages[0]).not.toContain(entries[0].details.productId);
    const first = updates.find(value => value.games.length === 40);
    expect(first.loading).toEqual({ loaded: 40, total: 82 }); expect(first.games.every((g: any) => g.entitled && g.title.startsWith('Named '))).toBe(true);
    release[1](); await vi.waitFor(() => expect(updates.at(-1).games.length).toBe(42));
    release[0](); const result = await pending;
    expect(result.games).toHaveLength(82); expect(result.games.slice(0, 40)).toEqual(first.games);
    expect(first.games).toHaveLength(40); // Earlier snapshots were not mutated.
  });
  it('normalizes entitlement flags strictly, deduplicates IDs and permits only Microsoft artwork hosts', () => {
    const games = normalizeCloudGames([{ titleId: game.id, details: { productId: game.productId, hasEntitlement: 'true' } }, { titleId: game.id }, { titleId: '../bad' }]);
    expect(games).toHaveLength(1); expect(games[0].entitled).toBe(false);
    hydrateCloudGames(games, { [game.productId]: { ProductTitle: 'Safe title', Image_Poster: { URL: '//store-images.s-microsoft.com/image/test' }, Categories: ['Adventure'] } });
    expect(games[0]).toMatchObject({ title: 'Safe title', genres: ['Adventure'], coverUrl: expect.stringContaining('https://store-images.s-microsoft.com/') });
    expect(cloudImage('https://store-images.s-microsoft.com.evil.test/track')).toBeUndefined(); expect(cloudImage('javascript:alert(1)')).toBeUndefined();
  });
  it('loads artwork without forwarding account credentials to the public catalog and uses cloud session routes', async () => {
    const fetcher = vi.fn(async (url, options) => String(url).includes('displaycatalog.mp.microsoft.com') ? Response.json({ Products: [] }) : String(url).endsWith('/v2/titles') ? Response.json({ results: [{ titleId: game.id, details: { productId: game.productId, hasEntitlement: true } }] }) : Response.json({ Products: { [game.productId]: { ProductTitle: 'Named game' } } }));
    const api = new RemotePlayTransport(fetcher); const result = await api.cloudTitles(cloud, new AbortController().signal);
    expect(result.games[0].title).toBe('Named game'); expect((fetcher.mock.calls[1][1]?.headers as any).Authorization).toBeUndefined();
    await api.stream(cloud, '/cloud-session-123', 'DELETE', undefined); expect(fetcher.mock.calls.at(-1)?.[0]).toBe('https://home.xboxlive.com/v5/sessions/cloud/cloud-session-123');
  });
});
