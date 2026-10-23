import { useState } from 'react';
import { ArrowRight, Check, LoaderCircle, LogIn, LogOut, MonitorPlay } from 'lucide-react';
import type { RemotePlayState } from '../shared/remote-play';
export function StreamingAccount({ state, busy, loaded, invoke, sessionActive, cloud = false }: {
  state: RemotePlayState; busy: boolean; loaded: boolean; invoke: (action: () => Promise<unknown>) => Promise<void>; sessionActive: boolean; cloud?: boolean;
}) {
  const [remember, setRemember] = useState(true);
  const api = window.launcher.remotePlay;
  return <>
    <section className="remote-account">
      <div className="remote-account-icon"><MonitorPlay /></div><div className="remote-account-copy"><h2>{state.auth === 'signed-in' ? (cloud ? 'Cloud Gaming account connected' : 'Remote Play account connected') : 'Connect your Xbox account'}</h2><p>{state.auth === 'signed-in' ? (cloud ? 'Uses the same streaming account as Remote Play. Your console can stay off.' : 'Consoles linked to this Microsoft account appear below.') : 'Authorize Xbox streaming once. Your existing Store sign-in stays separate.'}</p>
        {state.auth === 'signed-out' ? <label className="remote-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Remember this account securely on this Mac</label> : null}
      </div>
      {state.auth === 'signed-out' ? <button className="primary" disabled={!loaded || busy} onClick={() => { void invoke(() => api.signIn(remember)); }}><LogIn />{cloud ? 'Sign in for Cloud Gaming' : 'Sign in for Remote Play'}</button> : state.auth === 'signed-in' ? <><span className="remote-connected"><Check />Signed in</span><button className="secondary" disabled={busy || sessionActive} onClick={() => { void invoke(() => api.signOut()); }}><LogOut />Sign out streaming</button></> : <button className="secondary" onClick={() => { void invoke(() => api.cancelSignIn()); }}>Cancel sign-in</button>}
    </section>
    {state.auth === 'signing-in' ? <section className="remote-device-code" role="status"><LogIn /><div><h2>Finish sign-in with Microsoft</h2>{state.deviceCode ? <><p>Open the Microsoft sign-in page and enter this code:</p><strong className="remote-code">{state.deviceCode.code}</strong><p>{state.deviceCode.verificationUri}</p><div className="button-row"><button className="primary" onClick={() => { void invoke(() => api.openSignInPage()); }}>Open Microsoft sign-in<ArrowRight /></button></div><p className="fine-print">Waiting for sign-in. This code expires at {new Date(state.deviceCode.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p></> : <p><LoaderCircle className="spin" />Getting a sign-in code…</p>}</div></section> : null}
  </>;
}
