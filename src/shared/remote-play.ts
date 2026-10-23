export interface RemoteConsole {
  id: string;
  name: string;
  model: string;
  powerState: string;
  streamingEnabled: boolean;
}
export interface RemotePlayState {
  auth: 'signed-out' | 'signing-in' | 'signed-in';
  deviceCode?: { code: string; verificationUri: string; expiresAt: number };
  consoles: RemoteConsole[];
  refreshing: boolean;
  error?: string;
  session?: { id: string; consoleId: string; consoleName: string; phase: 'starting' | 'connecting' | 'connected' };
}
export interface RemoteIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}
export type RemotePlayMenuAction = 'show' | 'refresh' | 'disconnect' | 'fullscreen';
export interface RemotePlayApi {
  getControllers(): Promise<RemoteControllerStatus>;
  rescanControllers(): Promise<void>;
  onControllers(callback: (state: RemoteControllerStatus) => void): () => void;
  getState(): Promise<RemotePlayState>;
  signIn(remember: boolean): Promise<void>;
  openSignInPage(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  refreshConsoles(): Promise<void>;
  connect(consoleId: string): Promise<{ id: string }>;
  disconnect(): Promise<void>;
  exchangeSdp(id: string, sdp: string): Promise<{ sdp: string }>;
  exchangeIce(id: string, candidates: RemoteIceCandidate[]): Promise<RemoteIceCandidate[]>;
  connectionState(id: string, state: 'connected' | 'disconnected' | 'failed'): Promise<void>;
  onState(callback: (state: RemotePlayState) => void): () => void;
  onMenuAction(callback: (action: RemotePlayMenuAction) => void): () => void;
}

export interface RemoteController {
  id: string;
  name: string;
  index: number;
  source: 'macos' | 'browser';
  mapping: string;
  buttons: number[];
  axes: number[];
}
export interface RemoteControllerStatus {
  available: boolean;
  controllers: RemoteController[];
  updatedAt: number;
  error?: string;
}
