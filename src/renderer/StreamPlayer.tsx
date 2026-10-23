import { useCallback, useEffect, useRef, useState } from 'react';
import { Gamepad2, LoaderCircle, Maximize, Volume2, VolumeX, X } from 'lucide-react';
import type xCloudPlayer from 'xbox-xcloud-player';
import type { StreamingApi } from '../shared/cloud-gaming';
import type { RemotePlayMenuAction } from '../shared/remote-play';
import { RemoteGamepadDriver, activeRemoteController } from './remote-gamepad';
let playerModule: ReturnType<typeof importPlayer> | undefined;
function importPlayer() { return import('xbox-xcloud-player'); }
export function loadPlayer() { return playerModule ??= importPlayer(); }
const message = (error: unknown) => (error instanceof Error ? error.message : 'Streaming failed. Please try again.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
function sleep(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }
async function gatherIce(peer: RTCPeerConnection, cancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!cancelled() && peer.iceGatheringState !== 'complete' && Date.now() < deadline) await sleep(100);
}
interface StreamSession { id: string; name: string; phase: 'starting' | 'queued' | 'connecting' | 'connected'; queueSeconds?: number }
export function StreamPlayer({ hidden, session, bitrate, api, kind, onError }: {
  hidden: boolean; session?: StreamSession; bitrate: number; kind: 'home' | 'cloud'; onError: (message: string) => void;
  api: StreamingApi & { onMenuAction(callback: (action: RemotePlayMenuAction) => void): () => void };
}) {
  const [muted, setMuted] = useState(false), [fps, setFps] = useState(0), [rtt, setRtt] = useState<number>();
  const [controller, setController] = useState('No controller detected'), [resolution, setResolution] = useState('');
  const [stage, setStage] = useState('Preparing video connection…');
  const player = useRef<xCloudPlayer>(); const driver = useRef<RemoteGamepadDriver>();
  const panel = useRef<HTMLDivElement>(null), media = useRef<HTMLDivElement>(null);
  const visible = useRef(!hidden); visible.current = !hidden;
  const mediaId = `xodus-${kind}-media`;
  const activeId = session && ['connecting', 'connected'].includes(session.phase) ? session.id : undefined;
  const disconnect = useCallback(() => { void api.disconnect().catch(e => onError(message(e))); }, [api, onError]);
  const fullscreen = useCallback(() => {
    if (!panel.current || !session) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(e => onError(message(e)));
    else void panel.current.requestFullscreen().catch(e => onError(message(e)));
  }, [session]);
  const commands = useRef({ disconnect, fullscreen }); commands.current = { disconnect, fullscreen };
  useEffect(() => api.onMenuAction(action => { if (action === 'disconnect' || action === 'fullscreen') commands.current[action](); }), [api]);
  useEffect(() => {
    driver.current?.setEnabled(!hidden);
    if (!hidden) void loadPlayer().catch(() => onError('The streaming player could not load. Reopen Xodus Nexus Neo and try again.'));
  }, [hidden]);
  useEffect(() => {
    if (!session) return;
    const update = () => {
      const pad = activeRemoteController();
      setController(pad ? `${pad.name.slice(0, 60)} · ${pad.source === 'macos' ? 'macOS' : 'Browser'}` : 'No controller detected · Keyboard available');
      const video = media.current?.querySelector('video'); if (video?.videoWidth) setResolution(`${video.videoWidth} × ${video.videoHeight}`);
      if (player.current?._webrtcClient) void player.current._webrtcClient.getStats().then(stats => {
        stats.forEach(report => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated && Number.isFinite(report.currentRoundTripTime)) setRtt(Math.round(report.currentRoundTripTime * 1000)); });
      }).catch(() => {});
    };
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [session?.id]);
  useEffect(() => {
    if (!activeId) return;
    let disposed = false; let instance: xCloudPlayer | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined, disconnectGrace: ReturnType<typeof setTimeout> | undefined;
    const input = new RemoteGamepadDriver(); driver.current = input; input.setEnabled(visible.current);
    setFps(0); setRtt(undefined); setResolution(''); setMuted(false); setStage('Negotiating the video connection…');
    const fail = async (reason: unknown) => {
      if (disposed) return; onError(message(reason));
      await api.disconnect().catch(() => {});
    };
    void (async () => {
      try {
        const module = await loadPlayer(); if (disposed) return;
        const Player = typeof module.default === 'function' ? module.default : (module.default as any).default;
        instance = new Player(mediaId, { ui_systemui: [], input_driver: input, input_touch: false, input_mousekeyboard: false, input_legacykeyboard: false });
        const engine = instance!; player.current = engine; engine.bind();
        engine.setControllerRumble(false); // Slot-zero remapping must not vibrate an unrelated physical controller.
        if (bitrate > 0) engine.setVideoBitrate(bitrate);
        engine.setCodecPreferences('video/H264', { profiles: [] });
        const peer = engine._webrtcClient!;
        // The stream is receive-only; no microphone or camera permission is requested.
        engine.getEventBus().on('fps_video', (event: { fps: number }) => { if (!disposed) setFps(event.fps); });
        engine.getEventBus().on('connectionstate', (event: { state: string }) => {
          if (disposed) return;
          if (event.state === 'connected') { if (timeout) clearTimeout(timeout); setStage('Connected'); void api.connectionState(activeId, 'connected').catch(e => fail(e)); }
          if (event.state === 'closed') void api.connectionState(activeId, 'disconnected').catch(() => {});
        });
        peer.addEventListener('connectionstatechange', () => {
          if (disposed) return;
          if (peer.connectionState === 'failed') void fail(new Error(kind === 'cloud' ? 'Cloud video connection failed. Check your internet connection and retry.' : 'Video connection failed. Check your console and Mac network, then reconnect.'));
          if (peer.connectionState === 'disconnected' && !disconnectGrace) disconnectGrace = setTimeout(() => {
            disconnectGrace = undefined; if (!disposed && peer.connectionState === 'disconnected') void fail(new Error('The Xbox video connection was lost. Reconnect to continue.'));
          }, 8000);
        });
        const offer = await engine.createOffer() as RTCSessionDescriptionInit; if (disposed) return;
        const answer = await api.exchangeSdp(activeId, offer.sdp!); if (disposed) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        setStage(kind === 'cloud' ? 'Connecting to the cloud gaming server…' : 'Finding a network path to your Xbox…');
        await gatherIce(peer, () => disposed); if (disposed) return;
        const candidates = engine.getIceCandidates().map(value => ({ candidate: value.candidate, sdpMid: value.sdpMid, sdpMLineIndex: value.sdpMLineIndex }));
        const remote = await api.exchangeIce(activeId, candidates); if (disposed) return;
        for (const candidate of remote) { if (disposed) return; await peer.addIceCandidate(candidate); }
        setStage(kind === 'cloud' ? 'Waiting for cloud game video…' : 'Waiting for console video…');
        if (engine.getDataChannel('input')?.readyState !== 'open') timeout = setTimeout(() => { void fail(new Error(kind === 'cloud' ? 'Cloud video timed out. Check your internet connection and retry.' : 'The video connection timed out. Allow Local Network access for Xodus Nexus Neo in macOS Settings and reconnect.')); }, 45_000);
      } catch (e) { await fail(e); }
    })();
    return () => {
      disposed = true; if (timeout) clearTimeout(timeout); if (disconnectGrace) clearTimeout(disconnectGrace);
      input.stop(); instance?.getEventBus().removeAllListeners();
      try { instance?.close(); } catch { instance?._webrtcClient?.close(); }
      if (player.current === instance) player.current = undefined;
      if (driver.current === input) driver.current = undefined;
      media.current?.replaceChildren();
      if (document.fullscreenElement === panel.current) void document.exitFullscreen().catch(() => {});
    };
  }, [activeId, api]);
  const toggleMute = () => { const value = !muted; media.current?.querySelectorAll('audio,video').forEach(element => { (element as HTMLMediaElement).muted = value; }); setMuted(value); };
  if (!session) return null;
  return <section className="remote-session" ref={panel} aria-label="Xbox stream">
      <div className="remote-streambar"><div><i className={`remote-indicator ${session.phase}`} /><strong>{session.name}</strong><span>{session.phase === 'connected' ? 'Connected' : session.phase === 'queued' ? 'In cloud queue' : session.phase === 'starting' ? 'Starting…' : 'Connecting…'}</span></div>
        <div className="remote-stream-actions"><button title="Xbox button (N)" aria-label="Xbox button" disabled={session.phase !== 'connected'} onClick={() => driver.current?.pressButton(0, 'Nexus')}><Gamepad2 /><span>Xbox</span></button>
          <button title="View button" disabled={session.phase !== 'connected'} onClick={() => driver.current?.pressButton(0, 'View')}>View</button><button title="Menu button" disabled={session.phase !== 'connected'} onClick={() => driver.current?.pressButton(0, 'Menu')}>Menu</button>
          <button title={muted ? 'Unmute audio' : 'Mute audio'} aria-label={muted ? 'Unmute audio' : 'Mute audio'} onClick={toggleMute}>{muted ? <VolumeX /> : <Volume2 />}</button><button title="Fullscreen" aria-label="Stream fullscreen" onClick={fullscreen}><Maximize /></button>
          <button className="remote-disconnect" onClick={disconnect}><X />Disconnect</button></div></div>
      <div className="remote-screen" onClick={() => { media.current?.querySelectorAll('video,audio').forEach(element => { void (element as HTMLMediaElement).play().catch(() => {}); }); }}>
        <div id={mediaId} className="remote-media" ref={media} />
        {session.phase !== 'connected' ? <div className="remote-connecting" role="status"><LoaderCircle className="spin" /><h2>{session.phase === 'queued' ? 'Waiting for a cloud gaming server' : session.phase === 'starting' ? (kind === 'cloud' ? 'Starting your cloud game' : 'Getting your Xbox ready') : stage}</h2><p>{kind === 'cloud' ? (session.queueSeconds !== undefined ? `Xbox estimates about ${Math.max(1, Math.ceil(session.queueSeconds / 60))} minute(s) in the queue.` : 'Cloud games may take a moment to load. You can cancel at any time.') : 'Your Xbox may take a moment to wake up.'}</p><button className="secondary" onClick={disconnect}>Cancel connection</button></div> : null}
      </div>
      <div className="remote-stats"><span><Gamepad2 />{controller}</span>{resolution ? <span>{resolution}</span> : null}{fps > 0 ? <span>{fps} fps</span> : null}{rtt !== undefined ? <span>{rtt} ms network RTT</span> : null}<span className="remote-stats-hint">Click video if audio is paused · Esc exits fullscreen</span></div>
    </section>;
}
