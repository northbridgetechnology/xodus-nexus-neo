import { useCallback, useEffect, useState } from 'react';
import { Clock3, Gamepad2, LoaderCircle, RefreshCw } from 'lucide-react';
import type { DiscordSettings, GameHubState, PlayedGame, PlayMode } from '../shared/game-hub';
import type { Page } from '../shared/types';
import { useStoreDetails } from './StoreDetails';
export const playModeLabels: Record<PlayMode, string> = { local: 'Local play', cloud: 'Cloud Gaming', console: 'Console stream', xbox: 'Xbox activity' };
const empty: GameHubState = { recent: [], discord: { enabled: false, applicationId: '' }, presence: { state: 'disabled', message: 'Rich Presence is off.' } };
export function combineRecentGames(local: PlayedGame[], xbox: PlayedGame[]): PlayedGame[] {
  const entries = new Map<string, PlayedGame>();
  // Xbox history may not have Store IDs. Merge an exact Xbox title ID first;
  // an unambiguous exact title match is the fallback for local recordings.
  for (const game of [...local, ...xbox]) {
    const matching = [...entries.values()].filter(v => v.id === game.id || game.productId && v.productId === game.productId || game.titleId && v.titleId === game.titleId || (!v.productId || !game.productId) && (!v.titleId || !game.titleId) && v.title.toLowerCase() === game.title.toLowerCase());
    const old = matching.length === 1 ? matching[0] : undefined;
    if (!old) { entries.set(game.id, game); continue; }
    const latest = Date.parse(game.lastPlayed) > Date.parse(old.lastPlayed) ? game : old;
    entries.set(old.id, { ...old, ...latest, id: old.id, productId: old.productId ?? game.productId, gameId: old.gameId ?? game.gameId, cloudId: old.cloudId ?? game.cloudId, coverUrl: old.coverUrl ?? game.coverUrl, modes: [...new Set([...old.modes, ...game.modes])] });
  }
  return [...entries.values()].sort((a, b) => Date.parse(b.lastPlayed) - Date.parse(a.lastPlayed));
}
function useHub() {
  const [state, setState] = useState(empty);
  useEffect(() => {
    const api = window.launcher.gameHub; if (!api) return;
    let live = true; const off = api.onState(value => { if (live) setState(value); });
    void api.getState().then(value => { if (live) setState(value); }).catch(() => {});
    return () => { live = false; off(); };
  }, []);
  return state;
}
export function RecentlyPlayed({ go, compact = false }: { go: (page: Page) => void; compact?: boolean }) {
  const state = useHub(), openDetails = useStoreDetails();
  const [xbox, setXbox] = useState<PlayedGame[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [auth, setAuth] = useState('signed-out');
  const [query, setQuery] = useState(''), [mode, setMode] = useState(''), [limit, setLimit] = useState(40);
  useEffect(() => {
    let live = true; const api = window.launcher.remotePlay;
    void api.getState().then(s => { if (live) setAuth(s.auth); }).catch(() => {});
    const off = api.onState(s => { if (live) setAuth(s.auth); }); return () => { live = false; off(); };
  }, []);
  useEffect(() => { if (state.xboxRecent) setXbox(state.xboxRecent); }, [state.xboxRecent]);
  const refresh = useCallback((force = false) => {
    let live = true; setBusy(true); setError(undefined);
    void window.launcher.gameHub.refreshXboxRecent(force).then(value => { if (live) setXbox(value); }, e => { if (live) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') : 'Xbox history could not load.'); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (auth !== 'signed-in') { setXbox([]); setBusy(false); return; } return refresh(); }, [auth, refresh]);
  useEffect(() => setLimit(40), [mode, query]);
  const games = combineRecentGames(state.recent, xbox).filter(g => (!mode || g.modes.includes(mode as PlayMode)) && g.title.toLowerCase().includes(query.toLowerCase()));
  const visible = games.slice(0, compact ? 6 : limit);
  return <section className={`recently-played ${compact ? 'compact' : ''}`} aria-label="Recently Played">
    <div className="section-title"><h2><Clock3 />Recently Played</h2>{compact ? <button onClick={() => go('recent')}>See all</button> : <button className="secondary" disabled={busy || auth !== 'signed-in'} onClick={() => refresh(true)}><RefreshCw className={busy ? 'spin' : ''} />Refresh Xbox history</button>}</div>
    {!compact ? <div className="recent-filters"><input aria-label="Search recently played games" placeholder="Search recently played games" value={query} onChange={e => setQuery(e.target.value)} /><label>Played via<select value={mode} onChange={e => setMode(e.target.value)}><option value="">All sources</option>{Object.entries(playModeLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label></div> : null}
    {busy ? <p role="status"><LoaderCircle className="spin" />Loading Xbox account history…</p> : null}{error ? <p role="alert">{error}</p> : null}
    <div className="recent-game-grid">{visible.map(game => <article key={game.id}><button className="recent-game-details" aria-label={`View ${game.title} Store details`} onClick={() => openDetails({ productId: game.productId, title: game.title, coverUrl: game.coverUrl })}>{game.coverUrl ? <img src={game.coverUrl} alt="" loading="lazy" /> : <span className="recent-placeholder"><Gamepad2 /></span>}<strong>{game.title}</strong></button><div className="recent-game-info"><small>{game.modes.map(mode => playModeLabels[mode]).join(' · ')}</small><time dateTime={game.lastPlayed}>{new Date(game.lastPlayed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></div></article>)}</div>
    {!busy && !games.length ? <p>No matching play history yet. Xodus records cloud and local sessions when they start; Xbox history includes console and other games, even when they aren’t installed here.</p> : null}
    {auth !== 'signed-in' ? <p>Sign in through <button className="hub-text-button" onClick={() => go('cloud-gaming')}>Cloud Gaming</button> or Remote Play to include Xbox account history.</p> : null}
    {!compact && games.length > limit ? <button className="secondary" onClick={() => setLimit(v => v + 40)}>Show more recent games</button> : null}
  </section>;
}
export function DiscordSettingsPanel() {
  const state = useHub(); const [form, setForm] = useState<DiscordSettings>(state.discord), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  useEffect(() => setForm(state.discord), [state.discord.enabled, state.discord.applicationId]);
  return <section className="settings-card discord-settings"><h2>Discord Rich Presence</h2><p>Share the game and play method with Discord desktop. Off by default; no Discord account token is needed.</p><label className="remote-remember"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Share activity with Discord</label><label className="discord-id">Discord application ID<input aria-label="Discord application ID" value={form.applicationId} inputMode="numeric" maxLength={22} placeholder="Public application/client ID" onChange={e => setForm({ ...form, applicationId: e.target.value.trim() })} /></label><p className="fine-print">Create a Discord application named Xodus Nexus Neo in the Discord Developer Portal and paste its application ID here. Discord must be running with activity sharing enabled. Console streams show the console name; cloud and local sessions show the game title.</p><p role="status">{state.presence.message}</p>{error ? <p role="alert">{error}</p> : null}<button className="secondary" disabled={busy} onClick={() => { setBusy(true); setError(undefined); void window.launcher.gameHub.setDiscord(form).catch(e => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') : 'Discord settings could not be saved.')).finally(() => setBusy(false)); }}>Save Discord settings</button></section>;
}
