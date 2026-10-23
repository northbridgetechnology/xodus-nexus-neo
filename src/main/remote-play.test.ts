import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RemotePlayManager } from './remote-play';
import { EncryptedRemotePlayCredentials } from './remote-play-storage';
import { RemotePlayTransport, consoleIce, normalizeConsoles, normalizeIce, streamBaseUri, verificationUri, type RemoteUserToken } from './remote-play-api';
const token: RemoteUserToken = { access_token: 'synthetic-access-secret', refresh_token: 'synthetic-refresh-secret', expiresAt: Date.now() + 3600_000 };
const authorization = { base: 'https://region.gssv-play-prod.xboxlive.com', token: 'synthetic-stream-secret', webToken: 'synthetic-web-secret', userHash: 'synthetic-hash', expiresAt: Date.now() + 3600_000 };
const xbox = { id: 'F123456789012345', name: 'Living room Xbox', model: 'XboxSeriesX', powerState: 'On', streamingEnabled: true };
const managers: RemotePlayManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(manager => manager.dispose())); vi.restoreAllMocks(); });
function fixture(saved = true) {
  const vault = { read: vi.fn(async () => saved ? token : undefined), write: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const api = { deviceCode: vi.fn(async () => ({ user_code: 'TEST-CODE', device_code: 'private-device-secret', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 })),
    pollDeviceCode: vi.fn(async () => token), refresh: vi.fn(async () => token), authorize: vi.fn(async () => authorization), consoles: vi.fn(async () => [xbox]), transferToken: vi.fn(async () => 'synthetic-transfer-secret'),
    stream: vi.fn(async (_auth, route, method, _payload, _signal) => route === '/play' ? { sessionPath: '/sessions/home/remote-session-123' } : route.endsWith('/state') ? { state: 'Provisioned' } : undefined),
    exchange: vi.fn(async (_auth, _id, kind) => kind === 'sdp' ? { sdp: 'v=0\r\nremote-answer' } : [{ candidate: 'candidate:1 1 UDP 123 192.168.1.10 9002 typ host', sdpMid: '0', sdpMLineIndex: '0' }]),
  };
  const changed = vi.fn(), display = vi.fn();
  const manager = new RemotePlayManager(vault, changed, api as any, display); managers.push(manager);
  return { manager, vault, api, changed, display };
}
describe('Xbox Remote Play lifecycle', () => {
  it('discovers only the authorized account and never sends bearer tokens to the renderer', async () => {
    const { manager, vault, api, changed } = fixture(); await manager.initialize(); await manager.refreshConsoles();
    expect(manager.current.consoles).toEqual([xbox]); expect(api.consoles).toHaveBeenCalledWith(authorization, expect.any(AbortSignal));
    expect(vault.write).toHaveBeenCalledWith(token);
    expect(JSON.stringify(changed.mock.calls)).not.toMatch(/synthetic-.*secret|synthetic-hash/);
  });
  it('rejects arbitrary console IDs and consoles with streaming disabled before starting a session', async () => {
    const { manager, api } = fixture(); await manager.initialize(); await manager.refreshConsoles();
    await expect(manager.connect('attacker-console')).rejects.toThrow('from your account');
    api.consoles.mockResolvedValue([{ ...xbox, streamingEnabled: false }]); await manager.refreshConsoles();
    await expect(manager.connect(xbox.id)).rejects.toThrow('Enable Remote features'); expect(api.stream).not.toHaveBeenCalled();
  });
  it('creates a home session, negotiates it, rejects stale session IDs and cleans up exactly its own session', async () => {
    const { manager, api, display } = fixture(); await manager.initialize(); await manager.refreshConsoles();
    const { id } = await manager.connect(xbox.id);
    expect(manager.current.session?.phase).toBe('connecting');
    expect(api.stream).toHaveBeenCalledWith(authorization, '/play', 'POST', expect.objectContaining({ serverId: xbox.id, titleId: '' }), expect.any(AbortSignal));
    await expect(manager.connect(xbox.id)).rejects.toThrow('Disconnect');
    await expect(manager.exchangeSdp('stale-session', 'v=0\r\nclient-offer')).rejects.toThrow('no longer active');
    expect(await manager.exchangeSdp(id, 'v=0\r\nclient-offer')).toEqual({ sdp: 'v=0\r\nremote-answer' });
    const candidates = await manager.exchangeIce(id, []); expect(candidates[0].sdpMLineIndex).toBe(0);
    manager.connectionState(id, 'connected'); expect(manager.current.session?.phase).toBe('connected'); expect(display).toHaveBeenLastCalledWith(true);
    await manager.disconnect(); expect(display).toHaveBeenLastCalledWith(false); expect(manager.current.session).toBeUndefined();
    expect(api.stream).toHaveBeenLastCalledWith(authorization, '/remote-session-123', 'DELETE', undefined, expect.any(AbortSignal));
    await expect(manager.exchangeSdp(id, 'v=0\r\nclient-offer')).rejects.toThrow('no longer active');
  });
  it('preserves the real provisioning failure and releases its session and display blocker', async () => {
    const { manager, api, display } = fixture(); await manager.initialize(); await manager.refreshConsoles();
    api.stream.mockImplementation(async (_auth, route) => route === '/play' ? { sessionId: 'remote-session-123' } : route.endsWith('/state') ? { state: 'Failed' } : undefined);
    await expect(manager.connect(xbox.id)).rejects.toThrow('could not start Remote Play');
    expect(manager.current.error).toContain('could not start Remote Play'); expect(manager.current.session).toBeUndefined(); expect(display).toHaveBeenLastCalledWith(false);
  });
  it('cancels a pending connection without resurrecting it after the response arrives', async () => {
    const { manager, api } = fixture(); await manager.initialize(); await manager.refreshConsoles();
    let answer!: (value: any) => void;
    api.stream.mockImplementation((_auth, route) => route === '/play' ? new Promise(resolve => { answer = resolve; }) : Promise.resolve(undefined));
    const pending = manager.connect(xbox.id); const rejection = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(answer).toBeTypeOf('function')); await manager.disconnect(); answer({ sessionId: 'late-session-123' });
    await rejection; expect(manager.current.session).toBeUndefined();
    expect(api.stream).toHaveBeenLastCalledWith(authorization, '/late-session-123', 'DELETE', undefined, expect.any(AbortSignal));
  });
  it('shows a public sign-in code but keeps the private device code and OAuth tokens out of state', async () => {
    const { manager, vault, api, changed } = fixture(false);
    let complete!: (value: RemoteUserToken) => void;
    api.pollDeviceCode.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await manager.initialize(); await manager.signIn(false);
    expect(manager.current.deviceCode?.code).toBe('TEST-CODE'); expect(manager.signInUrl()).toBe('https://microsoft.com/devicelogin');
    expect(JSON.stringify(changed.mock.calls)).not.toContain('private-device-secret');
    complete(token); await vi.waitFor(() => expect(manager.current.auth).toBe('signed-in'));
    expect(vault.write).not.toHaveBeenCalled(); await manager.signOut(); expect(vault.clear).toHaveBeenCalledOnce();
  });
  it('cancels sign-in and refuses to persist a late successful response', async () => {
    const { manager, vault, api } = fixture(false);
    let complete!: (value: RemoteUserToken) => void;
    api.pollDeviceCode.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await manager.initialize(); await manager.signIn(true); manager.cancelSignIn(); complete(token);
    await Promise.resolve(); await Promise.resolve();
    expect(manager.current.auth).toBe('signed-out'); expect(manager.current.deviceCode).toBeUndefined(); expect(vault.write).not.toHaveBeenCalled();
  });
});

describe('credential isolation', () => {
  it('writes only encrypted Remote Play data, with no plaintext fallback or changes to unrelated files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'remote-vault-'));
    const secret = new Map<string, string>();
    const encryption = { isEncryptionAvailable: () => true, encryptString: (text: string) => { secret.set('encrypted', text); return Buffer.from('encrypted'); }, decryptString: (_data: Buffer) => secret.get('encrypted')! };
    try {
      const vault = new EncryptedRemotePlayCredentials(root, encryption);
      expect(await vault.read()).toBeUndefined(); await vault.write(token);
      expect((await readFile(path.join(root, 'remote-play/account.enc'))).toString()).toBe('encrypted');
      expect(await vault.read()).toEqual(token); await vault.clear(); expect(await vault.read()).toBeUndefined();
      const locked = new EncryptedRemotePlayCredentials(root, { ...encryption, isEncryptionAvailable: () => false });
      await expect(locked.write(token)).rejects.toThrow('Secure credential storage is unavailable'); expect(await vault.read()).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('Remote Play protocol validation', () => {
  it.each(['http://region.xboxlive.com', 'https://region.xboxlive.com.evil.test', 'https://region.xboxlive.com:444', 'https://user:secret@region.xboxlive.com', 'https://region.xboxlive.com/private'])('rejects untrusted region addresses: %s', url => {
    expect(() => streamBaseUri(url)).toThrow();
  });
  it('allows Microsoft regions and fixed device-login pages only', () => {
    expect(streamBaseUri(authorization.base + '/')).toBe(authorization.base);
    expect(() => verificationUri('https://evil.test/steal')).toThrow();
    expect(() => verificationUri('https://microsoft.com/link?token=private')).toThrow();
    expect(verificationUri('https://microsoft.com/devicelogin')).toBe('https://microsoft.com/devicelogin');
  });
  it('normalizes console data, strips extra account fields and requires explicit streaming permission', () => {
    expect(normalizeConsoles([{ id: xbox.id, name: '<Console>', privateToken: 'secret', consoleStreamingEnabled: 'true' }, { id: '../bad' }])).toEqual([{ id: xbox.id, name: '<Console>', model: 'Xbox', powerState: 'Unknown', streamingEnabled: false }]);
  });
  it('preserves LAN candidates, converts server string indices and rejects oversized ICE', () => {
    const value = [{ candidate: 'a=candidate:1 1 UDP 1 192.168.1.10 9002 typ host', sdpMid: '0', sdpMLineIndex: '0' }];
    expect(consoleIce(value)[0]).toEqual({ candidate: 'candidate:1 1 UDP 1 192.168.1.10 9002 typ host', sdpMid: '0', sdpMLineIndex: 0 });
    expect(() => normalizeIce([{ ...value[0], candidate: 'x'.repeat(5000) }])).toThrow();
    expect(() => normalizeIce(Array.from({ length: 257 }, () => value[0]))).toThrow();
  });
  it('never exposes error response bodies in HTTP failures', async () => {
    const api = new RemotePlayTransport(vi.fn(async () => new Response('private-token-do-not-expose', { status: 401 })));
    await expect(api.consoles(authorization, new AbortController().signal)).rejects.toThrow('Console discovery failed (HTTP 401)');
  });
  it('accepts empty successful DELETE/POST responses and refuses arbitrary streaming routes', async () => {
    const fetcher = vi.fn(async () => new Response(''));
    const api = new RemotePlayTransport(fetcher);
    await expect(api.stream(authorization, '/remote-session-123', 'DELETE', undefined)).resolves.toBeUndefined();
    expect(() => api.stream(authorization, '/../../attack', 'POST', {})).toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('exchanges a posted offer and bounded pending response before reading the answer', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(JSON.stringify({ exchangeResponse: JSON.stringify({ sdp: 'v=0\r\nanswer' }) })));
    const api = new RemotePlayTransport(fetcher);
    expect(await api.exchange(authorization, 'remote-session-123', 'sdp', {}, new AbortController().signal)).toEqual({ sdp: 'v=0\r\nanswer' });
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET']);
  });
});

describe('Microsoft Remote Play authentication contract', () => {
  it('requests only home-streaming and console permissions, retaining tokens in the main process', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
      const target = String(url); calls.push({ url: target, body: options?.body ? JSON.parse(String(options.body)) : undefined });
      if (target.includes('/user/authenticate')) return new Response(JSON.stringify({ Token: 'xbox-user-secret' }));
      if (target.includes('/xsts/authorize')) {
        const body = JSON.parse(String(options?.body));
        return new Response(JSON.stringify({ Token: body.RelyingParty.includes('gssv') ? 'gssv-secret' : 'web-secret', DisplayClaims: { xui: [{ uhs: 'hash' }] } }));
      }
      return new Response(JSON.stringify({ gsToken: 'stream-secret', offeringSettings: { regions: [{ isDefault: true, baseUri: authorization.base }] } }));
    });
    const api = new RemotePlayTransport(fetcher);
    const result = await api.authorize(token, new AbortController().signal);
    expect(result).toMatchObject({ base: authorization.base, token: 'stream-secret', webToken: 'web-secret', userHash: 'hash' });
    expect(calls.find(call => call.url.includes('/user/authenticate'))?.body.Properties.RpsTicket).toBe(`d=${token.access_token}`);
    expect(calls.filter(call => call.url.includes('/xsts/authorize')).map(call => call.body.RelyingParty)).toEqual(['http://gssv.xboxlive.com/', 'http://xboxlive.com']);
    expect(calls.find(call => call.url.includes('/login/user'))?.body.offeringId).toBe('xhome');
    expect(calls.some(call => /xgpu|xcloud/.test(call.url))).toBe(false);
  });
  it('polls pending device authentication without sending the private device code to any other host', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token, expires_in: 3600 })));
    const api = new RemotePlayTransport(fetcher);
    const result = await api.pollDeviceCode({ user_code: 'PUBLIC', device_code: 'private-device-code', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 10, interval: 0 }, new AbortController().signal);
    expect(result.access_token).toBe(token.access_token);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
      expect(new URLSearchParams(call[1].body).get('device_code')).toBe('private-device-code');
    }
  });
  it('fails immediately for a declined device code without echoing Microsoft error descriptions', async () => {
    const api = new RemotePlayTransport(vi.fn(async () => new Response(JSON.stringify({ error: 'authorization_declined', error_description: 'private-account-description' }), { status: 400 })));
    await expect(api.pollDeviceCode({ user_code: 'PUBLIC', device_code: 'private-device-code', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 10, interval: 0 }, new AbortController().signal)).rejects.toThrow('Microsoft sign-in was declined.');
  });
});

it('decodes Teredo IPv4 fallback without accepting other IPv6 ranges or oversized addresses', () => {
  const candidate = (address: string) => [{ candidate: `candidate:1 1 UDP 1 ${address} 9002 typ host`, sdpMid: '0', sdpMLineIndex: 0 }];
  const value = consoleIce(candidate('2001:0:4136:e378:8000:63bf:3fff:fdd2'));
  expect(value[0].candidate).toContain('192.0.2.45 9002'); expect(value[1].candidate).toContain('192.0.2.45 40000');
  expect(consoleIce(candidate('2001:db8::1'))).toHaveLength(1);
  expect(consoleIce(candidate('2001:0:' + 'a'.repeat(2000)))).toHaveLength(1);
  expect(consoleIce(candidate('2001:0::63bf:3fff:fdd2'))[1].candidate).toContain('192.0.2.45 40000');
});
