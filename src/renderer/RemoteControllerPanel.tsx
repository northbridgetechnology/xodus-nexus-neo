import { useEffect, useState } from 'react';
import { CircleAlert, Gamepad2, RefreshCw } from 'lucide-react';
import { activeRemoteController, availableRemoteControllers, nativeControllerStatus, remoteInputOptions, selectedControllerFrame, remoteInputSettings } from './remote-gamepad';
import type { RemoteController } from '../shared/remote-play';
const buttons = ['A', 'B', 'X', 'Y', 'LeftShoulder', 'RightShoulder', 'LeftTrigger', 'RightTrigger', 'View', 'Menu', 'LeftThumb', 'RightThumb', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight', 'Nexus'] as const;
const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'Xbox'];
export function ControllerPanel({ rescan }: { rescan: () => Promise<void> }) {
  const [selection, setSelection] = useState(() => remoteInputSettings().selection);
  const [swap, setSwap] = useState(() => remoteInputSettings().swapFaceButtons);
  const [snapshot, setSnapshot] = useState<{ pads: RemoteController[]; active?: RemoteController; pressed: string[]; axes: number[]; nativeAvailable: boolean }>({ pads: [], pressed: [], axes: [], nativeAvailable: false });
  const [error, setError] = useState<string>();
  useEffect(() => {
    const update = () => {
      const options = remoteInputSettings(); setSelection(options.selection); setSwap(options.swapFaceButtons);
      const pads = availableRemoteControllers(), active = activeRemoteController();
      const frame = selectedControllerFrame(active);
      const value = { pads: pads.map(pad => ({ ...pad, buttons: [], axes: [] })), active: active ? { ...active, buttons: [], axes: [] } : undefined,
        pressed: buttons.filter(button => frame[button] > 0.15), axes: [frame.LeftThumbXAxis, frame.LeftThumbYAxis, frame.RightThumbXAxis, frame.RightThumbYAxis].map(v => Math.round(v * 100) / 100), nativeAvailable: nativeControllerStatus().available };
      setSnapshot(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
    };
    update(); const timer = setInterval(update, 100); return () => clearInterval(timer);
  }, []);
  function configure(id: string, swapButtons: boolean) { setSelection(id); setSwap(swapButtons); remoteInputOptions(id, swapButtons); }
  return <section className="remote-controller-panel" aria-label="Controller input">
    <header><div><Gamepad2 /><h2>Controller</h2><span>{snapshot.active ? `${snapshot.active.name} · ${snapshot.active.source === 'macos' ? 'Native macOS' : 'Browser'}` : 'No controller detected'}</span></div><button className="secondary" onClick={() => { setError(undefined); void rescan().catch(() => setError('Controller input could not be refreshed. Reconnect the controller in macOS Bluetooth settings.')); }}><RefreshCw />Rescan controllers</button></header>
    <div className="remote-controller-options"><label>Controller<select aria-label="Remote Play controller" value={snapshot.pads.some(p => p.id === selection) ? selection : ''} onChange={e => configure(e.target.value, swap)}><option value="">Automatic · Prefer native macOS</option>{snapshot.pads.map(pad => <option key={pad.id} value={pad.id}>{pad.name} ({pad.source === 'macos' ? 'macOS' : `browser slot ${pad.index}`})</option>)}</select></label><label>Face buttons<select value={swap ? 'labels' : 'positions'} onChange={e => configure(selection, e.target.value === 'labels')}><option value="positions">Xbox positions · Switch B is Xbox A</option><option value="labels">Nintendo labels · A is A, B is B</option></select></label></div>
    {snapshot.active ? <><div className="remote-button-test" aria-label="Live controller buttons">{buttons.map((button, index) => <span key={button} className={snapshot.pressed.includes(button) ? 'pressed' : ''}>{names[index]}</span>)}</div><p className="remote-axis-values">Left stick: {snapshot.axes.slice(0, 2).map(v => v.toFixed(2)).join(', ')} <span>Right stick: {snapshot.axes.slice(2, 4).map(v => v.toFixed(2)).join(', ')}</span></p><p className="fine-print" role="status">{snapshot.pressed.length ? `Input detected: ${snapshot.pressed.map(button => names[buttons.indexOf(button as any)]).join(', ')}` : 'Press buttons or move the sticks. The indicators show the Xbox input mapping.'}</p></> : <p className="remote-controller-help"><CircleAlert />Press a controller button while this app is active. For Switch Pro, use macOS Bluetooth to pair Pro Controller, then click Rescan controllers. {snapshot.nativeAvailable ? 'Native macOS input is ready.' : 'Checking native macOS input…'}</p>}
    {error ? <p role="alert">{error}</p> : null}
    <p className="fine-print">Controller input is sent only while the active streaming page is visible and the app has focus. Click the video before playing.</p>
  </section>;
}
