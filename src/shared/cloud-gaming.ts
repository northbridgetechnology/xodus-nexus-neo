import type { RemoteIceCandidate, RemotePlayMenuAction } from './remote-play.js';
export type CloudGeneration = 'xbox' | 'xbox360' | 'xboxone' | 'series';
export type CloudPlayMode = 'single' | 'coop' | 'online' | 'local';
export interface CloudGame {
  id: string;
  productId: string;
  xboxTitleId?: string;
  title: string;
  publisher?: string;
  coverUrl?: string;
  genres: string[];
  entitled: boolean;
  generations?: CloudGeneration[];
  playModes?: CloudPlayMode[];
  releaseDate?: string;
  addedDate?: string;
}
export interface CloudGamingState {
  cachedAt?: number;
  games: CloudGame[];
  refreshing: boolean;
  loading?: { loaded: number; total: number };
  region?: string;
  offering?: string;
  warning?: string;
  error?: string;
  session?: { id: string; gameId: string; name: string; phase: 'starting' | 'queued' | 'connecting' | 'connected'; queueSeconds?: number };
}
export interface StreamingApi {
  disconnect(): Promise<void>;
  exchangeSdp(id: string, sdp: string): Promise<{ sdp: string }>;
  exchangeIce(id: string, candidates: RemoteIceCandidate[]): Promise<RemoteIceCandidate[]>;
  connectionState(id: string, state: 'connected' | 'disconnected' | 'failed'): Promise<void>;
}
export interface CloudGamingApi extends StreamingApi {
  getState(): Promise<CloudGamingState>;
  refreshCatalog(force?: boolean): Promise<void>;
  connect(gameId: string): Promise<{ id: string }>;
  onState(callback: (state: CloudGamingState) => void): () => void;
  onMenuAction(callback: (action: RemotePlayMenuAction) => void): () => void;
}
