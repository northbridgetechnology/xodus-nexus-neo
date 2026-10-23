import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Cloud, Gamepad2, LoaderCircle, Play, RefreshCw, Search, X } from 'lucide-react';
import type { CloudGame, CloudGamingState } from '../shared/cloud-gaming';
import type { RemotePlayState } from '../shared/remote-play';
import { useStoreDetails } from './StoreDetails';
import { StreamPlayer } from './StreamPlayer';
import { StreamingAccount } from './StreamingAccount';
import { ControllerPanel } from './RemoteControllerPanel';
import { filterCloudGames, defaultCloudFilters, generationLabels, playModeLabels, cloudSortLabels, loadCloudFilters, saveCloudFilters, cloudCardDate, type CloudCatalogFilters } from './cloud-catalog-filters';
export { filterCloudGames } from './cloud-catalog-filters';
import './remote-play.css';
const empty: CloudGamingState = { games: [], refreshing: false };
const emptyAccount: RemotePlayState = { auth: 'signed-out', consoles: [], refreshing: false };
const message = (error: unknown) => (error instanceof Error ? error.message : 'Cloud Gaming failed. Please try again.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
export function CloudGameCard({ game, busy, play, dateLabel }: { game: CloudGame; busy: boolean; play: () => void; dateLabel?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const openDetails = useStoreDetails();
  const details = () => openDetails({ productId: game.productId || undefined, title: game.title, coverUrl: game.coverUrl });
  return <article className="cloud-game" data-gamepad-card>
    <button className="cloud-cover-button" aria-label={`View ${game.title} Store details`} onClick={details}><div className="cloud-cover">{game.coverUrl && !imageFailed ? <img src={game.coverUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <Gamepad2 />}
      <span className={`cloud-access ${game.entitled ? 'playable' : ''}`}>{game.entitled ? 'Ready to stream' : 'Access required'}</span></div></button>
    <div className="cloud-game-copy"><button className="cloud-title-button" onClick={details}><h3 title={game.title}>{game.title}</h3></button><p>{game.publisher || 'Xbox Cloud Gaming'}</p><div className="cloud-card-meta">{game.generations?.length ? game.generations.map(g => <span key={g}>{generationLabels[g]}</span>) : <span>Generation not listed</span>}</div>{dateLabel ? <p className="cloud-card-date">{dateLabel}</p> : null}<button className={game.entitled ? 'primary' : 'secondary'} disabled={busy || !game.entitled} onClick={play} aria-label={`Play ${game.title}`}><Play />{game.entitled ? 'Play' : 'Subscription or purchase required'}</button></div>
  </article>;
}
export function CloudGaming({ hidden, sessionChanged, showConsole }: { hidden: boolean; sessionChanged: (active: boolean) => void; showConsole: () => void }) {
  const api = window.launcher.cloudGaming;
  const [state, setState] = useState<CloudGamingState>(empty), [account, setAccount] = useState<RemotePlayState>(emptyAccount);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [query, setQuery] = useState(''), [playable, setPlayable] = useState(true), [limit, setLimit] = useState(40), [bitrate, setBitrate] = useState(0);
  const [filters, setFilters] = useState(loadCloudFilters);
  const changeFilter = <K extends keyof CloudCatalogFilters>(key: K, value: CloudCatalogFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }));
  useEffect(() => saveCloudFilters(filters), [filters]);
  const autoRefresh = useRef(false);
  const invoke = useCallback(async (action: () => Promise<unknown>) => {
    setError(undefined); setBusy(true);
    try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, []);
  const refreshCatalog = useCallback(() => {
    setError(undefined);
    void api.refreshCatalog().catch(e => setError(message(e)));
  }, [api]);
  useEffect(() => {
    let live = true;
    const off = api.onState(value => { if (live) setState(value); });
    const accountOff = window.launcher.remotePlay.onState(value => { if (live) { setAccount(value); setLoaded(true); } });
    void api.getState().then(value => { if (live) setState(value); }, e => { if (live) setError(message(e)); });
    void window.launcher.remotePlay.getState().then(value => { if (live) { setAccount(value); setLoaded(true); } }, e => { if (live) setError(message(e)); });
    const menuOff = api.onMenuAction(action => { if (action === 'refresh') refreshCatalog(); });
    return () => { live = false; off(); accountOff(); menuOff(); };
  }, [api, refreshCatalog]);
  useEffect(() => { sessionChanged(Boolean(state.session)); }, [state.session?.id, sessionChanged]);
  useEffect(() => {
    if (account.auth === 'signed-out') autoRefresh.current = false;
    if (!hidden && loaded && account.auth === 'signed-in' && !state.refreshing && !autoRefresh.current) {
      autoRefresh.current = true; void api.refreshCatalog(false).catch(e => setError(message(e)));
    }
  }, [hidden, loaded, account.auth, state.refreshing, api]);
  useEffect(() => { setLimit(40); }, [query, playable, filters]);
  const results = useMemo(() => filterCloudGames(state.games, query, playable, filters), [state.games, query, playable, filters]);
  const options = useMemo(() => {
    const games = playable ? state.games.filter(game => game.entitled) : state.games;
    return { genres: [...new Set(games.flatMap(game => game.genres))].sort(), publishers: [...new Set(games.flatMap(game => game.publisher ?? []))].sort() };
  }, [state.games, playable]);
  const resetFilters = () => { setFilters({ ...defaultCloudFilters }); setQuery(''); setPlayable(true); };
  return <main className="page remote-page cloud-page" hidden={hidden}>
    <header className="page-header"><div><h1>Cloud Gaming</h1><p className="remote-subtitle">Game Pass and supported games. Stream directly to your Mac.</p></div><span className="remote-source"><Cloud />Xbox Cloud Gaming{state.region ? ` · ${state.region}` : ''}</span></header>
    {error || state.error ? <div className="alert amber" role="alert"><CircleAlert /><span>{error ?? state.error}</span>{error ? <button aria-label="Dismiss Cloud Gaming error" onClick={() => setError(undefined)}><X /></button> : null}</div> : null}
    {account.session ? <div className="alert amber" role="status"><CircleAlert /><span>Your console stream is active. Disconnect Remote Play before starting a cloud game.</span><button className="secondary" onClick={showConsole}>Open Remote Play</button></div> : null}
    <StreamPlayer hidden={hidden} kind="cloud" session={state.session} bitrate={bitrate} api={api} onError={setError} />
    <StreamingAccount cloud state={account} busy={busy} loaded={loaded} invoke={invoke} sessionActive={Boolean(state.session || account.session)} />
    <section className="cloud-catalog" aria-label="Cloud games">
      {state.cachedAt ? <p className="fine-print">Catalog updated {new Date(state.cachedAt).toLocaleString()}{state.refreshing ? " · refreshing in the background" : " · Refresh catalog checks for changes"}</p> : null}
      <div className="section-title"><h2>Cloud games {state.games.length ? <small>{results.length}</small> : null}</h2><div className="remote-list-tools"><label>Video bitrate<select value={bitrate} disabled={Boolean(state.session)} onChange={e => setBitrate(Number(e.target.value))}><option value={0}>Automatic</option><option value={10000}>10 Mbps</option><option value={20000}>20 Mbps</option></select></label><button className="secondary" disabled={account.auth !== 'signed-in' || state.refreshing || busy} onClick={refreshCatalog}><RefreshCw className={state.refreshing ? 'spin' : ''} />Refresh catalog</button></div></div>
      <div className="cloud-filters"><label className="cloud-search"><Search /><input aria-label="Search cloud games" placeholder="Search games, publishers or genres" value={query} onChange={e => setQuery(e.target.value)} />{query ? <button aria-label="Clear cloud search" onClick={() => setQuery('')}><X /></button> : null}</label><label className="remote-remember"><input type="checkbox" checked={playable} onChange={e => setPlayable(e.target.checked)} />Show games I can play</label></div>
      <div className="cloud-refinements" aria-label="Filter and sort cloud games">
        <label>Console generation<select aria-label="Console generation" value={filters.generation} onChange={e => changeFilter('generation', e.target.value as CloudCatalogFilters['generation'])}><option value="">All generations</option>{Object.entries(generationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="unknown">Generation not listed</option></select></label>
        <label>Genre<select value={filters.genre} onChange={e => changeFilter('genre', e.target.value)}><option value="">All genres</option>{[...new Set([...options.genres, ...filters.genre ? [filters.genre] : []])].sort().map(genre => <option key={genre}>{genre}</option>)}</select></label>
        <label>Publisher<select value={filters.publisher} onChange={e => changeFilter('publisher', e.target.value)}><option value="">All publishers</option>{[...new Set([...options.publishers, ...filters.publisher ? [filters.publisher] : []])].sort().map(publisher => <option key={publisher}>{publisher}</option>)}</select></label>
        <label>Play style<select value={filters.mode} onChange={e => changeFilter('mode', e.target.value as CloudCatalogFilters['mode'])}><option value="">All play styles</option>{Object.entries(playModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Sort by<select value={filters.sort} onChange={e => changeFilter('sort', e.target.value as CloudCatalogFilters['sort'])}>{Object.entries(cloudSortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="secondary" onClick={resetFilters}>Reset filters</button>
      </div>
      <p className="cloud-filter-help">{Math.min(limit, results.length)} shown · {results.length} matching games{state.refreshing ? ' · Results update as more metadata loads.' : '.'}</p><details className="cloud-filter-notes"><summary>About generations and added dates</summary><p>Generation describes the streamed edition, so remasters may be newer and cross-generation games can match both One and Series. Added dates are the earliest Game Pass entry Microsoft lists across plans; cloud availability can differ. Missing dates sort last. Local multiplayer and co-op labels describe the game; Xodus currently sends one controller.</p></details>
      {state.warning ? <p className="cloud-notice" role="status">{state.warning}</p> : null}
      {state.offering === 'xgpuwebf2p' ? <p className="cloud-notice">This account has free-to-play cloud access. Game Pass titles require an eligible subscription.</p> : null}
      {state.refreshing ? <p className="cloud-loading" role="status"><LoaderCircle className="spin" />{state.loading?.loaded ? `${state.loading.loaded} of ${state.loading.total} games loaded · Loading more in the background…` : 'Loading the first batch of games…'}</p> : null}
      {results.length ? <><div className="cloud-game-grid">{results.slice(0, limit).map(game => <CloudGameCard key={game.id} game={game} dateLabel={cloudCardDate(game, filters.sort)} busy={busy || Boolean(state.session || account.session)} play={() => { void invoke(() => api.connect(game.id)); }} />)}</div>{results.length > limit ? <div className="cloud-more"><button className="secondary" onClick={() => setLimit(v => v + 40)}>Show more games ({results.length - limit} remaining)</button></div> : null}</> : !state.refreshing ? <div className="remote-empty"><Cloud /><h3>{account.auth !== 'signed-in' ? 'Your cloud library starts here' : state.games.length ? 'No matching games' : 'No cloud games loaded yet'}</h3><p>{account.auth !== 'signed-in' ? 'Sign in above to browse cloud games available to your Xbox account.' : state.games.length ? 'Change the filters, reset them, or turn off “Show games I can play” to browse other titles.' : 'Refresh the catalog. Cloud access depends on your Game Pass plan and supported region.'}</p></div> : null}
    </section>
    <ControllerPanel rescan={() => window.launcher.remotePlay.rescanControllers()} />
    <section className="remote-setup"><h2>Play from the cloud</h2><p>Games run on Xbox Cloud Gaming servers. Your home Xbox can stay off. Availability, queues and session limits follow your Microsoft account, region and plan. Streaming access is checked by Xbox when a game starts.</p><p>Use the same controller and fullscreen controls as Remote Play. Click the video before playing. Disconnect ends this cloud session; games handle saving in their usual way. Microphone chat and controller vibration are not included.</p></section>
  </main>;
}
