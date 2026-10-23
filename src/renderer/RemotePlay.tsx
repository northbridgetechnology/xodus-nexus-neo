import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, MonitorPlay, RefreshCw, Tv, Wifi, X } from 'lucide-react';
import type { RemoteConsole, RemotePlayState } from '../shared/remote-play';
import { updateNativeControllers } from './remote-gamepad';
import { StreamPlayer } from './StreamPlayer';
import { StreamingAccount } from './StreamingAccount';
import { ControllerPanel } from './RemoteControllerPanel';
import './remote-play.css';
const empty: RemotePlayState = { auth: 'signed-out', consoles: [], refreshing: false };
const message = (error: unknown) => (error instanceof Error ? error.message : 'Remote Play failed. Please try again.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
export function ConsoleCard({ console, busy, connect }: { console: RemoteConsole; busy: boolean; connect: () => void }) {
  const on = /^(on|connected|standby)$/i.test(console.powerState);
  return <article className="remote-console" data-gamepad-card>
    <div className="remote-console-icon"><Tv /></div>
    <div className="remote-console-copy"><h3>{console.name}</h3><p>{console.model.replace(/XboxSeriesX/i, 'Xbox Series X').replace(/XboxSeriesS/i, 'Xbox Series S')}</p>
      <span className={`remote-power ${on ? 'online' : ''}`}><i />{console.powerState || 'Unknown power state'}</span>
      {!console.streamingEnabled ? <p className="remote-warning">Enable Remote features on this console, then refresh.</p> : null}
    </div>
    <button className="primary" disabled={busy || !console.streamingEnabled} onClick={connect}><MonitorPlay />Connect</button>
  </article>;
}
export function RemotePlay({ hidden, sessionChanged }: { hidden: boolean; sessionChanged: (active: boolean) => void }) {
  const [state, setState] = useState<RemotePlayState>(empty);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState<string>();
  const [bitrate, setBitrate] = useState(0);
  const [busy, setBusy] = useState(false);
  const autoRefresh = useRef(false);
  const api = window.launcher.remotePlay;
  const invoke = useCallback(async (action: () => Promise<unknown>) => {
    setError(undefined); setBusy(true);
    try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let live = true;
    const controllerOff = api.onControllers(updateNativeControllers);
    void api.getControllers().then(updateNativeControllers).catch(() => {});
    const off = api.onState(value => { if (live) { setState(value); setLoaded(true); } });
    void api.getState().then(value => { if (live) { setState(value); setLoaded(true); } }, e => { if (live) { setError(message(e)); setLoaded(true); } });
    const menuOff = api.onMenuAction(action => { if (action === 'refresh') void invoke(() => api.refreshConsoles()); });
    return () => { live = false; off(); menuOff(); controllerOff(); };
  }, [api]);
  useEffect(() => { sessionChanged(Boolean(state.session)); }, [state.session?.id, sessionChanged]);
  useEffect(() => {
    if (state.auth === 'signed-out') autoRefresh.current = false;
    if (!hidden && loaded && state.auth === 'signed-in' && !state.refreshing && !autoRefresh.current && !state.consoles.length) {
      autoRefresh.current = true; void invoke(() => api.refreshConsoles());
    }
  }, [hidden, loaded, state.auth, state.refreshing, state.consoles.length, api, invoke]);
  return <main className="page remote-page" hidden={hidden}>
    <header className="page-header"><div><h1>Xbox Remote Play</h1><p className="remote-subtitle">Your console. Your games. On this Mac.</p></div>
      <span className="remote-source"><Wifi />Home console streaming</span></header>
    {error || state.error ? <div className="alert amber" role="alert"><CircleAlert /><span>{error ?? state.error}</span><button aria-label="Dismiss Remote Play error" onClick={() => setError(undefined)}><X /></button></div> : null}
    <StreamPlayer hidden={hidden} kind="home" session={state.session && { ...state.session, name: state.session.consoleName }} bitrate={bitrate} api={api} onError={setError} />
    <StreamingAccount state={state} busy={busy} loaded={loaded} invoke={invoke} sessionActive={Boolean(state.session)} />
    <section className="remote-console-section"><div className="section-title"><h2>Your consoles</h2><div className="remote-list-tools"><label>Video bitrate<select value={bitrate} disabled={Boolean(state.session)} onChange={e => setBitrate(Number(e.target.value))}><option value={0}>Automatic</option><option value={10000}>10 Mbps</option><option value={20000}>20 Mbps</option></select></label><button className="secondary" disabled={state.auth !== 'signed-in' || state.refreshing || busy} onClick={() => { void invoke(() => api.refreshConsoles()); }}><RefreshCw className={state.refreshing ? 'spin' : ''} />Refresh consoles</button></div></div>
      {state.refreshing && !state.consoles.length ? <div className="remote-empty"><LoaderCircle className="spin" /><h3>Finding your consoles…</h3></div> : state.consoles.length ? <div className="remote-console-grid">{state.consoles.map(console => <ConsoleCard key={console.id} console={console} busy={busy || Boolean(state.session)} connect={() => { void invoke(() => api.connect(console.id)); }} />)}</div> : <div className="remote-empty"><Tv /><h3>{state.auth === 'signed-in' ? 'No consoles found yet' : 'Your Xbox will appear here'}</h3><p>{state.auth === 'signed-in' ? 'Use the same Microsoft account as your Xbox. Enable Remote features on the console, then refresh.' : 'Sign in above to discover the Xbox consoles linked to your account.'}</p></div>}
    </section>
    <ControllerPanel rescan={() => api.rescanControllers()} />
    <section className="remote-setup"><h2>Set up your Xbox for local streaming</h2><div className="remote-setup-grid"><div><b>1</b><h3>Enable Remote features</h3><p>On Xbox: Settings → Devices &amp; connections → Remote features. Enable remote features and run the remote play test.</p></div><div><b>2</b><h3>Use your home network</h3><p>Connect this Mac and your Xbox to the same network. Ethernet for the console and 5 GHz Wi-Fi for the Mac work best.</p></div><div><b>3</b><h3>Connect a controller</h3><p>Pair an Xbox, PlayStation or Nintendo Switch Pro controller with your Mac, then press a button. Native macOS controller input is supported. Allow Xodus Nexus Neo Local Network access if macOS asks.</p></div></div>
      <details><summary>Keyboard controls and connection help</summary><p>Arrow keys: D-pad · A / Enter: A · B / Backspace: B · X, Y: X, Y · [ and ]: bumpers · − and =: triggers · V: View · M: Menu · N: Xbox button.</p><p>Keep the console on while testing. To wake it remotely, use a power mode that permits Remote Play. Microsoft sign-in and session setup require internet. This connects to your own Xbox; it does not use the cloud gaming catalog. Voice chat and controller vibration are not included in this version.</p></details>
    </section>
  </main>;
}
