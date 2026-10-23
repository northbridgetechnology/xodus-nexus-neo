// Home-streaming REST contract adapted from Greenlight (MIT), unknownskl/greenlight.
// Authentication follows xal-node's MSAL flow (MIT), unknownskl/xal-node.
import { setTimeout as delay } from 'node:timers/promises';
import { isIP } from 'node:net';
import { catalogDate, gamePassAddedDate, catalogPlayModes, hydrateCloudEditions } from './cloud-catalog-metadata.js';
import type { PlayedGame } from '../shared/game-hub.js';
import type { CloudGame } from '../shared/cloud-gaming.js';
import type { RemoteConsole, RemoteIceCandidate } from '../shared/remote-play.js';

export const STREAM_CLIENT_ID = '1f907974-e22b-4810-a9de-d9647380c97e';
const OAUTH_ROOT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'xboxlive.signin openid profile offline_access';
export interface RemoteUserToken { cacheId?: string; access_token: string; refresh_token: string; expiresAt: number }
export interface RemoteDeviceCode { user_code: string; device_code: string; verification_uri: string; expires_in: number; interval: number }
export interface RemoteAuthorization { base: string; token: string; webToken: string; userHash: string; expiresAt: number; streamType?: 'cloud'; region?: string; offering?: string }
export class RemoteApiError extends Error {
  constructor(public stage: string, public status: number) { super(`${stage} failed (HTTP ${status}).`); }
}
export function streamBaseUri(value: unknown): string {
  if (typeof value !== 'string') throw Error('Xbox returned an invalid streaming region.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9.-]+\.xboxlive\.com$/.test(url.hostname) || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('Xbox returned an invalid streaming region.');
  return url.origin;
}
export function verificationUri(value: unknown): string {
  if (typeof value !== 'string') throw Error('Microsoft returned an invalid sign-in address.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(url.hostname) || url.username || url.password || url.port || !['/devicelogin', '/link', '/common/oauth2/deviceauth'].includes(url.pathname) || url.search || url.hash) throw Error('Microsoft returned an invalid sign-in address.');
  return url.href;
}
export function normalizeConsoles(value: unknown): RemoteConsole[] {
  if (!Array.isArray(value)) throw Error('Xbox returned an unreadable console list.');
  return value.filter(v => v && typeof v.id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(v.id)).slice(0, 50).map(v => ({
    id: v.id, name: typeof v.name === 'string' ? v.name.slice(0, 100) : 'Xbox console',
    model: typeof v.consoleType === 'string' ? v.consoleType.slice(0, 60) : 'Xbox',
    powerState: typeof v.powerState === 'string' ? v.powerState.slice(0, 40) : 'Unknown',
    streamingEnabled: v.consoleStreamingEnabled === true,
  }));
}
export function normalizeIce(value: unknown): RemoteIceCandidate[] {
  if (!Array.isArray(value) || value.length > 256) throw Error('Invalid streaming network candidates.');
  return value.map(v => {
    if (!v || typeof v.candidate !== 'string' || v.candidate.length > 4096 ||
      !(v.sdpMid === null || typeof v.sdpMid === 'string' && /^[0-9A-Za-z_-]{0,32}$/.test(v.sdpMid)) ||
      !(v.sdpMLineIndex === null || Number.isInteger(Number(v.sdpMLineIndex)) && Number(v.sdpMLineIndex) >= 0 && Number(v.sdpMLineIndex) < 32)) throw Error('Invalid streaming network candidate.');
    return { candidate: v.candidate, sdpMid: v.sdpMid, sdpMLineIndex: v.sdpMLineIndex === null ? null : Number(v.sdpMLineIndex) };
  });
}
/** Decode only Teredo's bounded IPv6 /32 format; Node validates the address first. */
function teredoEndpoint(address: string | undefined): { client4: string; udpPort: number } | undefined {
  if (!address || address.length > 45 || address.includes('%') || isIP(address) !== 6) return;
  let canonical = address;
  if (canonical.includes('.')) {
    const colon = canonical.lastIndexOf(':');
    const bytes = canonical.slice(colon + 1).split('.').map(Number);
    canonical = canonical.slice(0, colon + 1) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = canonical.split('::');
  const left = halves[0] ? halves[0].split(':') : [], right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const words = (halves.length > 1 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(v => parseInt(v, 16));
  if (words.length !== 8 || words[0] !== 0x2001 || words[1] !== 0) return;
  const udpPort = words[5] ^ 0xffff;
  if (!udpPort) return;
  const client4 = [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].map(v => v ^ 255).join('.');
  return { client4, udpPort };
}
/** Keep console-provided LAN candidates and add Greenlight's Teredo IPv4 fallback. */
export function consoleIce(value: unknown): RemoteIceCandidate[] {
  const candidates = normalizeIce(value), result: RemoteIceCandidate[] = [];
  for (const ice of candidates) {
    const address = ice.candidate.split(/\s+/)[4];
    const teredo = teredoEndpoint(address);
    if (teredo) {
      if (teredo.client4 && teredo.udpPort) for (const port of new Set(['9002', String(teredo.udpPort)])) {
        result.push({ candidate: `candidate:10 1 UDP 1 ${teredo.client4} ${port} typ host`, sdpMid: ice.sdpMid, sdpMLineIndex: ice.sdpMLineIndex });
      }
    }
    result.push({ ...ice, candidate: ice.candidate === 'a=end-of-candidates' ? '' : ice.candidate.replace(/^a=candidate:/, 'candidate:') });
  }
  return result;
}

export class RemotePlayTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async request(url: string, options: RequestInit, stage: string, signal?: AbortSignal, limit = 2_000_000): Promise<any> {
    let response: Response;
    try { response = await this.fetcher(url, { ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) }); }
    catch { if (signal?.aborted) throw Error('Remote Play was cancelled.'); throw Error(`${stage} could not reach Xbox. Check your internet connection and try again.`); }
    if (response.status === 204) return undefined;
    if (!response.ok) throw new RemoteApiError(stage, response.status);
    if (Number(response.headers.get('content-length') ?? 0) > limit) throw Error(`${stage} returned too much data.`);
    const reader = response.body?.getReader(); if (!reader) throw Error(`${stage} returned no data.`);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error(`${stage} returned too much data.`); chunks.push(value); } }
    finally { await reader.cancel(); }
    if (!size) return undefined;
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error(`${stage} returned unreadable data.`); }
  }
  private form(url: string, payload: Record<string, string>, stage: string, signal?: AbortSignal) {
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(payload).toString() }, stage, signal);
  }
  private json(url: string, payload: unknown, stage: string, signal?: AbortSignal) {
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1', Origin: 'https://www.xbox.com', Referer: 'https://www.xbox.com/' }, body: JSON.stringify(payload) }, stage, signal);
  }
  async deviceCode(signal: AbortSignal): Promise<RemoteDeviceCode> {
    const data = await this.form(`${OAUTH_ROOT}/devicecode`, { client_id: STREAM_CLIENT_ID, scope: SCOPE }, 'Microsoft sign-in', signal);
    if (!data || typeof data.user_code !== 'string' || !/^[A-Z0-9-]{4,20}$/.test(data.user_code) || typeof data.device_code !== 'string' || !data.device_code || !Number.isFinite(data.expires_in)) throw Error('Microsoft returned an invalid sign-in code.');
    verificationUri(data.verification_uri);
    return { ...data, expires_in: Math.min(900, Math.max(1, data.expires_in)), interval: Math.min(30, Math.max(5, Number(data.interval) || 5)) };
  }
  async pollDeviceCode(code: RemoteDeviceCode, signal: AbortSignal): Promise<RemoteUserToken> {
    const expiresAt = Date.now() + code.expires_in * 1000; let interval = code.interval;
    while (Date.now() < expiresAt) {
      await delay(interval * 1000, undefined, { signal });
      const response = await this.fetcher(`${OAUTH_ROOT}/token`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: STREAM_CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code }).toString(), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      // OAuth errors have fixed codes. Never surface raw response bodies/tokens.
      const raw = await response.text(); if (raw.length > 64_000) throw Error('Microsoft returned an invalid sign-in response.');
      let data: any; try { data = JSON.parse(raw); } catch { throw Error('Microsoft returned an unreadable sign-in response.'); }
      if (response.ok) return this.userToken(data);
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') { interval += 5; continue; }
      if (data.error === 'authorization_declined' || data.error === 'access_denied') throw Error('Microsoft sign-in was declined.');
      if (data.error === 'expired_token') break;
      throw Error(`Microsoft sign-in failed (HTTP ${response.status}). Try signing in again.`);
    }
    throw Error('The Microsoft sign-in code expired. Start sign-in again.');
  }
  private userToken(data: any): RemoteUserToken {
    if (!data || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in)) throw Error('Microsoft returned incomplete sign-in credentials.');
    return { access_token: data.access_token, refresh_token: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async refresh(token: RemoteUserToken, signal: AbortSignal): Promise<RemoteUserToken> {
    if (token.expiresAt > Date.now() + 120_000) return token;
    return this.userToken(await this.form(`${OAUTH_ROOT}/token`, { client_id: STREAM_CLIENT_ID, grant_type: 'refresh_token', refresh_token: token.refresh_token, scope: SCOPE }, 'Remote Play account refresh', signal));
  }
  async authorize(token: RemoteUserToken, signal: AbortSignal): Promise<RemoteAuthorization> {
    const user = await this.json('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', RpsTicket: `d=${token.access_token}`, SiteName: 'user.auth.xboxlive.com' }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, 'Xbox authentication', signal);
    if (typeof user?.Token !== 'string' || !user.Token) throw Error('Xbox returned an invalid user token.');
    const xsts = async (party: string) => this.json('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] }, RelyingParty: party, TokenType: 'JWT' }, 'Xbox authorization', signal);
    const gssv = await xsts('http://gssv.xboxlive.com/');
    if (typeof gssv?.Token !== 'string' || !gssv.Token) throw Error('Xbox Remote Play authorization was incomplete.');
    const stream = await this.request('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gssv-client': 'XboxComBrowser' }, body: JSON.stringify({ token: gssv.Token, offeringId: 'xhome' }) }, 'Xbox Remote Play access', signal);
    const regions = stream?.offeringSettings?.regions;
    const region = Array.isArray(regions) ? regions.find(v => v.isDefault) ?? regions[0] : undefined;
    if (typeof stream?.gsToken !== 'string' || !stream.gsToken || !region) throw Error('Xbox did not return a home-streaming region.');
    const web = await xsts('http://xboxlive.com');
    const userHash = web?.DisplayClaims?.xui?.[0]?.uhs;
    if (typeof web?.Token !== 'string' || !web.Token || typeof userHash !== 'string' || !userHash) throw Error('Xbox console authorization was incomplete.');
    return { base: streamBaseUri(region.baseUri), token: stream.gsToken, webToken: web.Token, userHash, expiresAt: Date.now() + 5 * 60_000 };
  }
  async authorizeCloud(token: RemoteUserToken, signal: AbortSignal): Promise<RemoteAuthorization> {
    const user = await this.json('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', RpsTicket: `d=${token.access_token}`, SiteName: 'user.auth.xboxlive.com' }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, 'Xbox authentication', signal);
    if (typeof user?.Token !== 'string' || !user.Token) throw Error('Xbox returned an invalid user token.');
    const gssv = await this.json('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] }, RelyingParty: 'http://gssv.xboxlive.com/', TokenType: 'JWT' }, 'Xbox authorization', signal);
    if (typeof gssv?.Token !== 'string' || !gssv.Token) throw Error('Xbox Cloud Gaming authorization was incomplete.');
    let stream: any, offering = 'xgpuweb';
    const login = (id: string) => this.request('https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gssv-client': 'XboxComBrowser' }, body: JSON.stringify({ token: gssv.Token, offeringId: id }) }, 'Cloud Gaming access', signal);
    try { stream = await login(offering); }
    catch (error) {
      // Microsoft's free-to-play offering is useful for accounts without a subscription.
      if (!(error instanceof RemoteApiError) || ![400, 401, 403].includes(error.status) || signal.aborted) throw error;
      offering = 'xgpuwebf2p'; stream = await login(offering);
    }
    const regions = stream?.offeringSettings?.regions;
    const region = Array.isArray(regions) ? regions.find(v => v.isDefault) ?? regions[0] : undefined;
    if (typeof stream?.gsToken !== 'string' || !stream.gsToken || !region) throw Error('Xbox did not return a Cloud Gaming region. Check your subscription and supported region.');
    return { base: streamBaseUri(region.baseUri), token: stream.gsToken, webToken: '', userHash: '', streamType: 'cloud', offering,
      region: typeof region.name === 'string' ? region.name.slice(0, 80) : undefined, expiresAt: Date.now() + 5 * 60_000 };
  }
  async cloudTitles(auth: RemoteAuthorization, signal: AbortSignal,
    progress?: (games: CloudGame[], loading: { loaded: number; total: number }) => void,
  ): Promise<{ games: CloudGame[]; warning?: string }> {
    const result = await this.request(`${streamBaseUri(auth.base)}/v2/titles`, { headers: { Authorization: `Bearer ${auth.token}` } }, 'Cloud catalog', signal, 8_000_000);
    const games = normalizeCloudGames(result?.results);
    // Fetch playable games first, in pages matching the 40-card UI. Publish each
    // finished page independently; a slow later request must not hold earlier cards.
    const ids = [...new Set([...games.filter(g => g.entitled), ...games.filter(g => !g.entitled)].map(g => g.productId).filter(Boolean))];
    const batches: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += 40) batches.push(ids.slice(offset, offset + 40));
    const published: CloudGame[] = [], seen = new Set<string>();
    const publish = (batch: CloudGame[]) => {
      signal.throwIfAborted();
      for (const game of batch.sort((a, b) => a.title.localeCompare(b.title))) {
        if (!seen.has(game.id)) { seen.add(game.id); published.push(game); }
      }
      // Copy snapshots: subsequent hydration must not mutate an earlier IPC update.
      progress?.(structuredClone(published), { loaded: published.length, total: games.length });
    };
    progress?.([], { loaded: 0, total: games.length });
    let failed = false, editionsFailed = false;
    const artworkSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    const load = async (batch: string[]) => {
      try {
        const catalog = await this.request('https://catalog.gamepass.com/v3/products?market=US&language=en-US&hydration=RemoteHighSapphire0', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'ms-cv': '0.0', 'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': '21.0.0' }, body: JSON.stringify({ Products: batch }),
        }, 'Cloud game artwork', artworkSignal, 8_000_000);
        hydrateCloudGames(games, catalog?.Products);
        const wanted = new Set(batch);
        const page = games.filter(g => wanted.has(g.productId));
        publish(page);
        // Console generations are in the Store metadata, not the Game Pass
        // compatibility list. Enrich after publishing so the first page stays fast.
        await Promise.all([batch.slice(0, 20), batch.slice(20)].filter(ids => ids.length).map(async ids => {
          try {
            const details = await this.request(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.join(',')}&market=US&languages=en-us,neutral`, { headers: { Accept: 'application/json' } }, 'Console generation details', artworkSignal, 8_000_000);
            hydrateCloudEditions(page, details); publish([]);
          } catch (error) { if (signal.aborted) throw error; editionsFailed = true; }
        }));
      } catch (error) { if (signal.aborted) throw error; failed = true; }
    };
    // The first page gets the connection to itself rather than competing with
    // hundreds of offscreen titles. After it appears, three workers fill the rest.
    if (batches.length) await load(batches[0]);
    let next = 1;
    await Promise.all(Array.from({ length: Math.min(3, Math.max(0, batches.length - 1)) }, async () => {
      while (next < batches.length && !artworkSignal.aborted) await load(batches[next++]);
    }));
    signal.throwIfAborted();
    if (artworkSignal.aborted) failed = true;
    // Preserve the order already shown so newly loaded pages do not move cards
    // under the pointer or controller focus. Missing details never block play.
    publish(games.filter(g => !seen.has(g.id)));
    return { games: published, warning: failed ? 'Some game names or artwork could not load. Refresh the catalog to retry.' : editionsFailed ? 'Some console generation details could not load. Those games remain playable under All generations.' : undefined };
  }
  async xboxRecent(auth: RemoteAuthorization, signal: AbortSignal): Promise<PlayedGame[]> {
    const headers = { Authorization: `XBL3.0 x=${auth.userHash};${auth.webToken}`, 'x-xbl-contract-version': '2',
      'x-xbl-client-name': 'XboxApp', 'x-xbl-client-type': 'UWA', 'x-xbl-client-version': '39.39.22001.0', 'Accept-Language': 'en-US' };
    const profile = await this.request('https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag', { headers }, 'Xbox recent profile', signal);
    const xuid = profile?.profileUsers?.length === 1 ? profile.profileUsers[0]?.id : undefined;
    if (typeof xuid !== 'string' || !/^[0-9]{1,20}$/.test(xuid)) throw Error('Xbox did not return the account identity for recent games.');
    const recent: PlayedGame[] = []; let continuation: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = new URL(`https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/detail,image,productId`);
      url.searchParams.set('maxItems', '100'); if (continuation) url.searchParams.set('continuationToken', continuation);
      const data = await this.request(url.href, { headers }, 'Xbox recently played', signal);
      if (data?.xuid !== undefined && data.xuid !== xuid || !Array.isArray(data?.titles) || data.titles.length > 1000) throw Error('Xbox returned unreadable recent game history.');
      for (const title of data.titles) {
        if (title?.titleHistory?.visible === false || title?.type && String(title.type).toLowerCase() !== 'game' || typeof title?.name !== 'string' || !/^\d{1,12}$/.test(String(title.titleId))) continue;
        const played = title.titleHistory?.lastTimePlayed;
        if (typeof played !== 'string' || !Number.isFinite(Date.parse(played)) || Date.parse(played) < 0) continue;
        const productId = title.productId ?? title.detail?.productId;
        recent.push({ id: `xbox:${title.titleId}`, title: title.name.slice(0, 250), titleId: String(title.titleId),
          productId: typeof productId === 'string' && /^[A-Z0-9]{12}$/.test(productId) ? productId : undefined,
          coverUrl: xboxHistoryImage(title.displayImage ?? title.imageUrl) ?? (Array.isArray(title.images) ? title.images.slice(0, 30).map((image: any) => xboxHistoryImage(image?.url)).find(Boolean) : undefined), lastPlayed: new Date(played).toISOString(), mode: 'xbox', modes: ['xbox'] });
      }
      const next = data.pagingInfo?.continuationToken;
      if (typeof next !== 'string' || !next || next.length > 4096 || next === continuation) break;
      continuation = next;
    }
    return recent.slice(0, 500);
  }
  async consoles(auth: RemoteAuthorization, signal: AbortSignal): Promise<RemoteConsole[]> {
    const data = await this.request('https://xccs.xboxlive.com/lists/devices?queryCurrentDevice=false&includeStorageDevices=true', { headers: { Authorization: `XBL3.0 x=${auth.userHash};${auth.webToken}`, 'x-xbl-contract-version': '4', skillplatform: 'RemoteManagement' } }, 'Console discovery', signal);
    return normalizeConsoles(data?.result);
  }
  stream(auth: RemoteAuthorization, suffix: string, method: string, body: unknown, signal?: AbortSignal): Promise<any> {
    if (!/^\/(?:play|[a-zA-Z0-9-]+(?:\/(?:state|sdp|ice|connect|keepalive))?)$/.test(suffix)) throw Error('Invalid Remote Play session request.');
    return this.request(`${streamBaseUri(auth.base)}/v5/sessions/${auth.streamType ?? 'home'}${suffix}`, { method,
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', 'X-MS-Device-Info': JSON.stringify({ appInfo: { env: { clientAppId: 'Microsoft.GamingApp', clientAppType: 'native', clientAppVersion: '2203.1001.4.0', clientSdkVersion: '8.5.2', httpEnvironment: 'prod', sdkInstallId: '' } }, dev: { hw: { make: 'Microsoft', model: 'Surface Pro', sdktype: 'native' }, os: { name: 'Windows 11', ver: '22631.2715', platform: 'desktop' }, displayInfo: { dimensions: { widthInPixels: 1920, heightInPixels: 1080 }, pixelDensity: { dpiX: 1, dpiY: 1 } } } }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, 'Xbox streaming', signal);
  }
  async transferToken(token: RemoteUserToken, signal: AbortSignal): Promise<string> {
    const result = await this.form('https://login.live.com/oauth20_token.srf', { client_id: STREAM_CLIENT_ID, scope: 'service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN', grant_type: 'refresh_token', refresh_token: token.refresh_token }, 'Xbox console connection', signal);
    if (typeof result?.access_token !== 'string' || !result.access_token) throw Error('Xbox returned an invalid console transfer token.');
    return result.access_token;
  }
  async exchange(auth: RemoteAuthorization, id: string, kind: 'sdp' | 'ice', payload: unknown, signal: AbortSignal): Promise<any> {
    await this.stream(auth, `/${id}/${kind}`, 'POST', payload, signal);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await this.stream(auth, `/${id}/${kind}`, 'GET', undefined, signal);
      if (typeof result?.exchangeResponse === 'string') {
        try { return JSON.parse(result.exchangeResponse); } catch { throw Error('Xbox returned an unreadable streaming response.'); }
      }
      if (result?.errorDetails) throw Error('Xbox rejected streaming negotiation. Reconnect to the console.');
      await delay(500, undefined, { signal });
    }
    throw Error(auth.streamType === 'cloud' ? 'Cloud streaming negotiation timed out. Check your internet connection and retry.' : 'Xbox streaming negotiation timed out. Check that your console and Mac are on the same network.');
  }
}

export function normalizeCloudGames(value: unknown): CloudGame[] {
  if (!Array.isArray(value) || value.length > 5000) throw Error('Xbox returned an unreadable Cloud Gaming catalog.');
  const seen = new Set<string>();
  return value.flatMap(v => {
    if (!v || typeof v.titleId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(v.titleId) || seen.has(v.titleId)) return [];
    seen.add(v.titleId);
    const details = v.details ?? {};
    return [{ id: v.titleId, productId: typeof details.productId === 'string' && /^[A-Z0-9]{12}$/.test(details.productId) ? details.productId : '',
      xboxTitleId: /^\d{1,12}$/.test(String(details.xboxTitleId)) ? String(details.xboxTitleId) : undefined,
      title: typeof v.title === 'string' ? v.title.slice(0, 250) : v.titleId, genres: [], entitled: details.hasEntitlement === true || details.isFreeInStore === true }];
  });
}
// Title Hub still returns HTTP URLs for some Microsoft artwork. Upgrade them
// before applying the same exact-host allowlist used by the cloud catalog.
function xboxHistoryImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:'; return cloudImage(url.href); } catch { return; }
}
export function cloudImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['store-images.s-microsoft.com', 'store-images.microsoft.com', 'images-eds-ssl.xboxlive.com', 'images-eds.xboxlive.com'].includes(url.hostname)) return;
    url.searchParams.set('w', '400'); url.searchParams.set('h', '600'); return url.href;
  } catch { return; }
}
export function hydrateCloudGames(games: CloudGame[], products: any): void {
  if (!products || typeof products !== 'object' || Array.isArray(products)) return;
  for (const game of games) {
    const product = products[game.productId]; if (!product) continue;
    if (typeof product.ProductTitle === 'string') game.title = product.ProductTitle.slice(0, 250);
    if (typeof product.PublisherName === 'string') game.publisher = product.PublisherName.slice(0, 250);
    game.releaseDate = catalogDate(product.OriginalReleaseDate);
    game.addedDate = gamePassAddedDate(product.PassMetadataByPassProductId);
    game.playModes = catalogPlayModes(product.Attributes);
    game.coverUrl = cloudImage(product.Image_Poster?.URL ?? product.Image_Tile?.URL);
    game.genres = Array.isArray(product.Categories) ? product.Categories.filter((v: unknown): v is string => typeof v === 'string').slice(0, 10).map((v: string) => v.slice(0, 80)) : [];
  }
}
