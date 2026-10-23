import type { GameStoreDetails } from './types.js';
export type PlayMode = 'local' | 'console' | 'cloud' | 'xbox';
export interface PlayedGame { id: string; title: string; productId?: string; titleId?: string; gameId?: string; cloudId?: string; coverUrl?: string; lastPlayed: string; mode: PlayMode; modes: PlayMode[] }
export interface DiscordSettings { enabled: boolean; applicationId: string }
export interface DiscordStatus { state: 'disabled' | 'unconfigured' | 'waiting' | 'connected' | 'error'; message: string }
export interface GameHubState { xboxRecent?: PlayedGame[]; recent: PlayedGame[]; discord: DiscordSettings; presence: DiscordStatus }
export interface StoreGameTarget { productId?: string; title: string; coverUrl?: string }
export interface GameHubApi {
  getState(): Promise<GameHubState>;
  onState(callback: (state: GameHubState) => void): () => void;
  refreshXboxRecent(force?: boolean): Promise<PlayedGame[]>;
  getStoreDetails(productId: string): Promise<GameStoreDetails | undefined>;
  openStore(productId: string): Promise<void>;
  setDiscord(settings: DiscordSettings): Promise<void>;
}
