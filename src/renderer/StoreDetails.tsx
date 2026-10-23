import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Gamepad2, Images, LoaderCircle, Search, X } from 'lucide-react';
import type { StoreGameTarget } from '../shared/game-hub';
import type { GameStoreDetails } from '../shared/types';
import { Gallery } from './GameDetails';
import './game-hub.css';
const OpenStore = createContext<(target: StoreGameTarget) => void>(() => {});
export const useStoreDetails = () => useContext(OpenStore);
export function StoreDetailsProvider({ children, searchStore }: { children: ReactNode; searchStore: (query: string) => void }) {
  const [target, setTarget] = useState<StoreGameTarget>();
  return <OpenStore.Provider value={setTarget}>{children}{target ? <StoreDetails key={`${target.productId}:${target.title}`} target={target} close={() => setTarget(undefined)} searchStore={query => { setTarget(undefined); searchStore(query); }} /> : null}</OpenStore.Provider>;
}
export function StoreDetails({ target, close, searchStore }: { target: StoreGameTarget; close: () => void; searchStore: (query: string) => void }) {
  const [details, setDetails] = useState<GameStoreDetails>(), [loading, setLoading] = useState(Boolean(target.productId)), [error, setError] = useState<string>(), [gallery, setGallery] = useState<number>();
  const dialog = useRef<HTMLElement>(null), closing = useRef(close); closing.current = close;
  useEffect(() => {
    let live = true;
    if (target.productId) void window.launcher.gameHub.getStoreDetails(target.productId).then(value => { if (live) setDetails(value); }, () => { if (live) setError('Store details could not load. Try the Xbox Store link below.'); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [target.productId]);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('.gd-lightbox-backdrop')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closing.current(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? [])];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  const screenshots = details?.screenshots ?? [];
  return <><div className="store-details-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="store-details" role="dialog" aria-modal="true" aria-label={`${target.title} Store details`} ref={dialog}>
    <header><span>MICROSOFT STORE</span><button className="secondary" onClick={close} aria-label="Close Store details"><X />Close</button></header>
    <div className="store-details-heading">{target.coverUrl || details?.heroUrl ? <img src={target.coverUrl ?? details?.heroUrl} alt="" /> : <Gamepad2 />}<div><h1>{details?.title ?? target.title}</h1><p>{details?.publisher}</p><div className="store-details-tags">{details?.categories.map(c => <span key={c}>{c}</span>)}</div>{details?.releaseDate ? <p>Released {new Date(details.releaseDate).toLocaleDateString()}</p> : null}</div></div>
    <div className="button-row">{target.productId ? <button className="primary" onClick={() => { void window.launcher.gameHub.openStore(target.productId!).catch(() => setError('The Xbox Store could not be opened.')); }}><ExternalLink />Open Xbox Store</button> : <button className="primary" onClick={() => searchStore(target.title)}><Search />Find in Store</button>}</div>
    {loading ? <p role="status"><LoaderCircle className="spin" />Loading game details and screenshots…</p> : null}{error ? <p role="alert">{error}</p> : null}
    <h2>About the game</h2><p className="store-details-description">{details?.description || (loading ? 'Loading…' : target.productId ? 'No description is available for this edition.' : 'Xbox did not provide a Store product ID for this game. Use Find in Store to locate its edition.')}</p>
    <div className="section-title"><h2>Screenshots</h2>{screenshots.length ? <button onClick={() => setGallery(0)}><Images />View all {screenshots.length}</button> : null}</div><div className="store-details-screenshots">{screenshots.slice(0, 4).map((src, index) => <button key={src} aria-label={`Open screenshot ${index + 1}`} onClick={() => setGallery(index)}><img src={src} alt={`${target.title} screenshot ${index + 1}`} loading="lazy" /></button>)}</div>{!loading && !screenshots.length ? <p>No screenshots are listed for this edition.</p> : null}
  </section></div>{gallery !== undefined && screenshots.length ? <Gallery title={target.title} images={screenshots} initial={gallery} close={() => setGallery(undefined)} /> : null}</>;
}
