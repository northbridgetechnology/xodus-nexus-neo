import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { StreamingBrowseCache, BrowseSnapshot } from './streaming-browse-cache.js';
import type { PlayedGame } from '../shared/game-hub.js';
import type { CloudGamingState } from '../shared/cloud-gaming.js';
import type { RemoteIceCandidate, RemotePlayState } from '../shared/remote-play.js';
import { RemotePlayTransport, normalizeIce, consoleIce, verificationUri, type RemoteAuthorization, type RemoteUserToken } from './remote-play-api.js';
import type { RemotePlayCredentials } from './remote-play-storage.js';
interface ActiveSession { kind: 'home' | 'cloud'; id: string; remoteId?: string; auth?: RemoteAuthorization; abort: AbortController; keepalive?: ReturnType<typeof setInterval> }
export class RemotePlayManager {
  private state: RemotePlayState = { auth: 'signed-out', consoles: [], refreshing: false };
  private cloud: CloudGamingState = { games: [], refreshing: false };
  private cloudAuth?: RemoteAuthorization;
  private cloudAuthorizationJob?: Promise<RemoteAuthorization>;
  private tokenJob?: Promise<RemoteUserToken>;
  private cloudRefreshJob?: Promise<void>;
  private browse: BrowseSnapshot = {};
  private recentJob?: Promise<PlayedGame[]>;
  private token?: RemoteUserToken;
  private auth?: RemoteAuthorization;
  private authorizationJob?: Promise<RemoteAuthorization>;
  private accountAbort = new AbortController();
  private loginAbort?: AbortController;
  private loginJob?: Promise<void>;
  private remember = false;
  private active?: ActiveSession;
  private refreshJob?: Promise<void>;
  constructor(private credentials: RemotePlayCredentials, private changed: (state: RemotePlayState) => void,
    private api = new RemotePlayTransport(), private displaySleep: (active: boolean) => void = () => {},
    private cloudChanged: (state: CloudGamingState) => void = () => {},
    private browseCache?: StreamingBrowseCache, private recentChanged: () => void = () => {}) {}
  get recentCurrent(): PlayedGame[] { return structuredClone(this.browse.recent?.games ?? []); }
  private saveBrowse(): void { if (this.remember && this.token?.cacheId) void this.browseCache?.write(this.token.cacheId, this.browse).catch(() => {}); }
  get current(): RemotePlayState { return structuredClone(this.state); }
  get cloudCurrent(): CloudGamingState { return structuredClone(this.cloud); }
  get hasActivity(): boolean { return Boolean(this.active || this.loginAbort || this.loginJob || this.authorizationJob || this.state.refreshing || this.cloudRefreshJob || this.cloudAuthorizationJob || this.tokenJob || this.recentJob); }
  private emit(): void { this.changed(this.current); this.cloudChanged(this.cloudCurrent); }
  private message(error: unknown): string { return error instanceof Error && error.name !== 'AbortError' ? error.message : 'Remote Play was cancelled.'; }
  async initialize(): Promise<void> {
    try {
      this.token = await this.credentials.read(); this.remember = Boolean(this.token);
      if (this.token && this.browseCache) {
        if (!this.token.cacheId) { this.token = { ...this.token, cacheId: randomUUID() }; await this.credentials.write(this.token); }
        this.browse = await this.browseCache.read(this.token.cacheId!);
        if (this.browse.cloud) this.cloud = { games: structuredClone(this.browse.cloud.games), refreshing: false, cachedAt: this.browse.cloud.at };
      }
      this.state.auth = this.token ? 'signed-in' : 'signed-out';
    }
    catch (error) { this.state.error = this.message(error); }
    this.emit();
  }
  signInUrl(): string {
    if (!this.state.deviceCode || this.state.deviceCode.expiresAt < Date.now()) throw Error('Start Remote Play sign-in to get a new code.');
    return verificationUri(this.state.deviceCode.verificationUri);
  }
  async signIn(remember: boolean): Promise<void> {
    if (this.state.auth === 'signed-in') throw Error('Sign out of Remote Play before switching its account.');
    if (this.loginAbort) return;
    const abort = new AbortController(); this.loginAbort = abort;
    this.state.auth = 'signing-in'; this.state.error = undefined; this.emit();
    try {
      const code = await this.api.deviceCode(abort.signal);
      if (abort.signal.aborted) return;
      this.state.deviceCode = { code: code.user_code, verificationUri: verificationUri(code.verification_uri), expiresAt: Date.now() + code.expires_in * 1000 }; this.emit();
      const job = (async () => {
        try {
          const token = { ...await this.api.pollDeviceCode(code, abort.signal), cacheId: randomUUID() };
          if (abort.signal.aborted) return;
          if (remember) await this.credentials.write(token);
          if (abort.signal.aborted) { if (remember) await this.credentials.clear(); return; }
          this.token = token; this.remember = remember;
          this.auth = undefined; this.cloudAuth = undefined; this.state.auth = 'signed-in'; this.state.deviceCode = undefined; this.emit();
          await this.refreshConsoles();
        } catch (error) {
          if (!abort.signal.aborted) { this.state.auth = this.token ? 'signed-in' : 'signed-out'; this.state.deviceCode = undefined; this.state.error = this.message(error); this.emit(); }
        } finally { if (this.loginAbort === abort) this.loginAbort = undefined; }
      })();
      this.loginJob = job;
      void job.finally(() => { if (this.loginJob === job) this.loginJob = undefined; });
    } catch (error) {
      if (this.loginAbort === abort) this.loginAbort = undefined;
      if (!abort.signal.aborted) { this.state.auth = 'signed-out'; this.state.error = this.message(error); this.emit(); throw Error(this.state.error); }
    }
  }
  cancelSignIn(): void {
    this.loginAbort?.abort(); this.loginAbort = undefined;
    this.state.deviceCode = undefined; this.state.auth = this.token ? 'signed-in' : 'signed-out'; this.emit();
  }
  async signOut(): Promise<void> {
    this.cancelSignIn(); this.accountAbort.abort();
    await Promise.allSettled([this.loginJob, this.authorizationJob, this.refreshJob, this.cloudAuthorizationJob, this.cloudRefreshJob, this.tokenJob, this.recentJob]);
    await this.disconnect(); this.accountAbort = new AbortController();
    this.token = undefined; this.auth = undefined; this.authorizationJob = undefined; this.refreshJob = undefined; this.remember = false;
    this.cloudAuth = undefined; this.cloudAuthorizationJob = undefined; this.tokenJob = undefined; this.cloud = { games: [], refreshing: false };
    this.browse = {}; this.recentChanged();
    this.state = { auth: 'signed-out', consoles: [], refreshing: false }; this.emit();
    try { await this.credentials.clear(); await this.browseCache?.clear(); } catch { this.state.error = 'Remote Play signed out for this session, but its saved credentials could not be removed. Try signing out again.'; this.emit(); throw Error(this.state.error); }
  }
  private async freshToken(): Promise<RemoteUserToken> {
    if (!this.token) throw Error('Sign in to your Xbox streaming account first.');
    if (this.tokenJob) return this.tokenJob;
    const signal = this.accountAbort.signal;
    const job = (async () => {
      const token = { ...await this.api.refresh(this.token!, signal), ...(this.token!.cacheId ? { cacheId: this.token!.cacheId } : {}) }; signal.throwIfAborted();
      if (this.remember) await this.credentials.write(token);
      signal.throwIfAborted(); this.token = token; return token;
    })();
    this.tokenJob = job;
    try { return await job; } finally { if (this.tokenJob === job) this.tokenJob = undefined; }
  }
  private async authorize(kind: 'home' | 'cloud' = 'home'): Promise<RemoteAuthorization> {
    if (!this.token) throw Error('Sign in to Xbox Remote Play first.');
    const cached = kind === 'cloud' ? this.cloudAuth : this.auth;
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
    const pending = kind === 'cloud' ? this.cloudAuthorizationJob : this.authorizationJob;
    if (pending) return pending;
    const signal = this.accountAbort.signal;
    const job = (async () => {
      const token = await this.freshToken(); signal.throwIfAborted();
      const auth = await (kind === 'cloud' ? this.api.authorizeCloud(token, signal) : this.api.authorize(token, signal));
      signal.throwIfAborted();
      if (kind === 'cloud') this.cloudAuth = auth; else this.auth = auth;
      return auth;
    })();
    if (kind === 'cloud') this.cloudAuthorizationJob = job; else this.authorizationJob = job;
    try { return await job; } finally {
      if (kind === 'cloud' && this.cloudAuthorizationJob === job) this.cloudAuthorizationJob = undefined;
      if (kind === 'home' && this.authorizationJob === job) this.authorizationJob = undefined;
    }
  }
  async recentlyPlayed(force = false): Promise<PlayedGame[]> {
    if (!this.token) throw Error('Sign in for Remote Play or Cloud Gaming to load Xbox history.');
    const cached = this.browse.recent;
    if (!force && cached) {
      if (Date.now() - cached.at >= 5 * 60_000 && !this.recentJob) void this.recentlyPlayed(true).catch(() => {});
      return structuredClone(cached.games);
    }
    if (this.recentJob) return this.recentJob;
    const signal = this.accountAbort.signal;
    const job = (async () => {
      const auth = await this.authorize(); signal.throwIfAborted();
      const games = await this.api.xboxRecent(auth, signal); signal.throwIfAborted();
      const enriched = games.map(game => {
        const named = this.cloud.games.filter(g => g.title.toLowerCase() === game.title.toLowerCase());
        const cloud = this.cloud.games.find(g => game.titleId && g.xboxTitleId === game.titleId)
          ?? (named.length === 1 ? named[0] : undefined);
        return cloud ? { ...game, productId: game.productId ?? cloud.productId, coverUrl: cloud.coverUrl ?? game.coverUrl, cloudId: cloud.id } : game;
      });
      this.browse.recent = { at: Date.now(), games: enriched }; this.saveBrowse(); this.recentChanged();
      return structuredClone(enriched);
    })();
    this.recentJob = job;
    try { return await job; } finally { if (this.recentJob === job) this.recentJob = undefined; }
  }
  async refreshCloudCatalog(force = true): Promise<void> {
    if (this.cloudRefreshJob) return this.cloudRefreshJob;
    if (!this.token) throw Error('Sign in to your Xbox streaming account first.');
    if (!force && this.browse.cloud && Date.now() - this.browse.cloud.at < 6 * 3600_000) return;
    const signal = this.accountAbort.signal;
    const previous = this.cloud.games;
    this.cloud.refreshing = true; this.cloud.loading = { loaded: 0, total: 0 }; this.cloud.error = undefined; this.cloud.warning = undefined; this.emit();
    const job = (async () => {
      try {
        const auth = await this.authorize('cloud');
        this.cloud.region = auth.region; this.cloud.offering = auth.offering;
        const result = await this.api.cloudTitles(auth, signal, (games, loading) => {
          if (signal.aborted) return;
          // Keep a previous catalog usable until the first refreshed page arrives.
          if (games.length) { const loaded = new Set(games.map(game => game.id)); this.cloud.games = [...games, ...previous.filter(game => !loaded.has(game.id))]; }
          this.cloud.loading = loading; this.emit();
        }); signal.throwIfAborted();
        this.browse.cloud = { at: Date.now(), games: structuredClone(result.games) }; this.cloud.cachedAt = this.browse.cloud.at; this.saveBrowse();
        this.cloud.games = result.games; this.cloud.warning = result.warning; this.cloud.region = auth.region; this.cloud.offering = auth.offering;
      } catch (error) { if (!signal.aborted) { this.cloud.error = this.message(error); throw Error(this.cloud.error); } }
      finally { if (!signal.aborted) { this.cloud.refreshing = false; this.cloud.loading = undefined; this.emit(); } }
    })();
    this.cloudRefreshJob = job;
    try { await job; } finally { if (this.cloudRefreshJob === job) this.cloudRefreshJob = undefined; }
  }
  async connectCloud(gameId: string): Promise<{ id: string }> {
    if (this.active) throw Error('Disconnect the current Xbox stream first.');
    const game = this.cloud.games.find(g => g.id === gameId);
    if (!game) throw Error('Refresh the cloud catalog and select a game.');
    if (!game.entitled) throw Error('This account does not have streaming access to this game. Check your Game Pass plan or ownership.');
    return this.startSession('cloud', gameId, game.title);
  }
  async refreshConsoles(): Promise<void> {
    if (this.refreshJob) return this.refreshJob;
    if (!this.token) throw Error('Sign in to Xbox Remote Play first.');
    const signal = this.accountAbort.signal;
    this.state.refreshing = true; this.state.error = undefined; this.emit();
    const job = (async () => {
      try { const auth = await this.authorize(); const consoles = await this.api.consoles(auth, signal); signal.throwIfAborted(); this.state.consoles = consoles; }
      catch (error) { if (!signal.aborted) { this.state.error = this.message(error); throw Error(this.state.error); } }
      finally { if (!signal.aborted) { this.state.refreshing = false; this.emit(); } }
    })();
    this.refreshJob = job;
    try { await job; } finally { if (this.refreshJob === job) this.refreshJob = undefined; }
  }
  async connect(consoleId: string): Promise<{ id: string }> {
    if (this.active) throw Error('Disconnect the current Xbox stream first.');
    const console = this.state.consoles.find(item => item.id === consoleId);
    if (!console) throw Error('Refresh consoles and select an Xbox from your account.');
    if (!console.streamingEnabled) throw Error('Enable Remote features on this Xbox, then refresh consoles.');
    return this.startSession('home', consoleId, console.name);
  }
  private async startSession(kind: 'home' | 'cloud', target: string, name: string): Promise<{ id: string }> {
    const active: ActiveSession = { kind, id: randomUUID(), abort: new AbortController() };
    this.active = active;
    if (kind === 'cloud') { this.cloud.error = undefined; this.cloud.session = { id: active.id, gameId: target, name, phase: 'starting' }; }
    else { this.state.error = undefined; this.state.session = { id: active.id, consoleId: target, consoleName: name, phase: 'starting' }; }
    this.emit();
    const signal = AbortSignal.any([active.abort.signal, this.accountAbort.signal]);
    try {
      const auth = await this.authorize(kind); active.auth = auth; signal.throwIfAborted();
      const play = await this.api.stream(auth, '/play', 'POST', { titleId: kind === 'cloud' ? target : '', systemUpdateGroup: '', clientSessionId: active.id,
        settings: { nanoVersion: 'V3;WebrtcTransport.dll', enableTextToSpeech: false, highContrast: 0, locale: 'en-US', useIceConnection: false, timezoneOffsetMinutes: new Date().getTimezoneOffset(), sdkType: 'web', osName: 'windows' },
        serverId: kind === 'home' ? target : '', fallbackRegionNames: [] }, signal);
      const remoteId = play?.sessionId ?? String(play?.sessionPath ?? '').split('/').filter(Boolean).at(-1);
      if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(remoteId)) throw Error('Xbox returned an invalid streaming session.');
      active.remoteId = remoteId; signal.throwIfAborted();
      const until = Date.now() + (kind === 'cloud' ? 20 * 60_000 : 120_000); let transferred = false;
      while (Date.now() < until) {
        const info = await this.api.stream(auth, `/${remoteId}/state`, 'GET', undefined, signal);
        if (info?.state === 'Provisioned') {
          signal.throwIfAborted(); if (this.active !== active) throw Error('Remote Play was cancelled.');
          const view = kind === 'cloud' ? this.cloud.session! : this.state.session!;
          view.phase = 'connecting'; this.emit();
          let misses = 0;
          active.keepalive = setInterval(() => { void this.api.stream(auth, `/${remoteId}/keepalive`, 'POST', {}, signal).then(() => { misses = 0; }, () => {
            if (++misses >= 3 && this.active === active) void this.failSession(active.id, kind === 'cloud' ? 'Cloud Gaming stopped responding. Start the game again.' : 'The Xbox connection stopped responding. Reconnect to your console.');
          }); }, 25_000);
          return { id: active.id };
        }
        if (info?.state === 'ReadyToConnect' && !transferred) {
          const userToken = await this.api.transferToken(this.token!, signal);
          await this.api.stream(auth, `/${remoteId}/connect`, 'POST', { userToken }, signal); transferred = true;
        } else if (info?.state === 'Failed' || info?.state === 'Cancelled') {
          throw Error(kind === 'cloud' ? 'Xbox could not start this cloud game. Check your subscription, regional availability and streaming access, then retry.' : 'The Xbox could not start Remote Play. Check Remote features, power mode and the console network, then retry.');
        }
        if (kind === 'cloud' && ['Queued', 'WaitingForResources'].includes(info?.state)) {
          signal.throwIfAborted();
          if (this.active !== active) throw Error('Cloud Gaming was cancelled.');
          this.cloud.session!.phase = 'queued';
          const seconds = info.waitTimeDetails?.estimatedTotalWaitTimeInSeconds;
          this.cloud.session!.queueSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 86400) : undefined;
          this.emit();
        }
        await delay(kind === 'cloud' ? 2000 : 1000, undefined, { signal });
      }
      throw Error(kind === 'cloud' ? 'The cloud session did not become ready within 20 minutes. Try again later.' : 'The Xbox did not become ready within two minutes. Turn it on and try again.');
    } catch (error) {
      const failure = signal.aborted ? 'The Xbox connection was cancelled.' : this.message(error);
      if (this.active === active) { await this.disconnect(); if (kind === 'cloud') this.cloud.error = failure; else this.state.error = failure; this.emit(); }
      else if (active.auth && active.remoteId) {
        // Cancellation can race a successful play response. Close that exact late session too.
        try { await this.api.stream(active.auth, `/${active.remoteId}`, 'DELETE', undefined, AbortSignal.timeout(10_000)); } catch {}
      }
      throw Error(failure);
    }
  }
  private session(id: string): ActiveSession & { auth: RemoteAuthorization; remoteId: string } {
    const active = this.active;
    if (!active || active.id !== id || !active.auth || !active.remoteId || active.abort.signal.aborted) throw Error('This Xbox streaming session is no longer active.');
    return active as ActiveSession & { auth: RemoteAuthorization; remoteId: string };
  }
  async exchangeSdp(id: string, sdp: string): Promise<{ sdp: string }> {
    if (typeof sdp !== 'string' || sdp.length < 10 || sdp.length > 256_000 || !sdp.startsWith('v=0')) throw Error('Invalid streaming offer.');
    const active = this.session(id);
    const result = await this.api.exchange(active.auth, active.remoteId, 'sdp', { messageType: 'offer', sdp, configuration: {
      chatConfiguration: { bytesPerSample: 2, expectedClipDurationMs: 20, format: { codec: 'opus', container: 'webm' }, numChannels: 1, sampleFrequencyHz: 24000 },
      chat: { minVersion: 1, maxVersion: 1 }, control: { minVersion: 1, maxVersion: 3 }, input: { minVersion: 1, maxVersion: 8 }, message: { minVersion: 1, maxVersion: 1 },
    } }, active.abort.signal);
    this.session(id);
    if (typeof result?.sdp !== 'string' || !result.sdp.startsWith('v=0') || result.sdp.length > 256_000) throw Error('Xbox returned an invalid streaming answer.');
    return { sdp: result.sdp };
  }
  async exchangeIce(id: string, candidates: RemoteIceCandidate[]): Promise<RemoteIceCandidate[]> {
    const active = this.session(id);
    const result = await this.api.exchange(active.auth, active.remoteId, 'ice', { messageType: 'iceCandidate', candidate: normalizeIce(candidates) }, active.abort.signal);
    this.session(id); return consoleIce(result);
  }
  connectionState(id: string, state: 'connected' | 'disconnected' | 'failed'): void {
    const active = this.session(id);
    if (state === 'connected') { const view = this.active!.kind === 'cloud' ? this.cloud.session! : this.state.session!; view.phase = 'connected'; this.displaySleep(true); this.emit(); }
    else if (state === 'disconnected' || state === 'failed') void this.failSession(id, state === 'failed' ? (active.kind === 'cloud' ? 'Cloud video connection failed. Check your internet connection and retry.' : 'The Xbox video connection failed. Check that both devices are on the same network and reconnect.') : 'The Xbox stream disconnected. You can reconnect below.');
    else throw Error('Invalid Xbox connection state.');
  }
  private async failSession(id: string, message: string): Promise<void> {
    if (this.active?.id !== id) return;
    const cloud = this.active?.kind === 'cloud';
    await this.disconnect(); if (cloud) this.cloud.error = message; else this.state.error = message; this.emit();
  }
  async disconnectKind(kind: 'home' | 'cloud'): Promise<void> { if (this.active?.kind === kind) await this.disconnect(); }
  async disconnect(): Promise<void> {
    const active = this.active; if (!active) return;
    this.active = undefined; active.abort.abort();
    if (active.keepalive) clearInterval(active.keepalive);
    this.state.session = undefined; this.cloud.session = undefined; this.displaySleep(false); this.emit();
    if (active.auth && active.remoteId) {
      try { await this.api.stream(active.auth, `/${active.remoteId}`, 'DELETE', undefined, AbortSignal.timeout(10_000)); }
      catch { /* Local media/input have stopped; Xbox also expires abandoned sessions. */ }
    }
  }
  async dispose(): Promise<void> {
    this.cancelSignIn(); this.accountAbort.abort();
    await this.disconnect();
    await Promise.allSettled([this.loginJob, this.authorizationJob, this.refreshJob, this.cloudAuthorizationJob, this.cloudRefreshJob, this.tokenJob, this.recentJob]);
    await this.browseCache?.flush();
  }
}
