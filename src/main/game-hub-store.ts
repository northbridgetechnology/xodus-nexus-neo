import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiscordSettings, PlayedGame, PlayMode } from '../shared/game-hub.js';
import { cloudImage } from './remote-play-api.js';
export function cleanPlayedGame(value: any): PlayedGame | undefined {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || !['local', 'console', 'cloud', 'xbox'].includes(value.mode) || typeof value.lastPlayed !== 'string' || !Number.isFinite(Date.parse(value.lastPlayed))) return;
  const productId = typeof value.productId === 'string' && /^[A-Z0-9]{12}$/.test(value.productId) ? value.productId : undefined;
  const titleId = typeof value.titleId === 'string' && /^\d{1,12}$/.test(value.titleId) ? value.titleId : undefined;
  const localId = typeof value.gameId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.gameId) ? value.gameId : undefined;
  const title = value.title.trim().slice(0, 250);
  return { id: productId ?? (titleId ? `xbox:${titleId}` : localId ? `local:${localId}` : `name:${title.toLowerCase()}`), title, productId, titleId, gameId: localId,
    cloudId: typeof value.cloudId === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value.cloudId) ? value.cloudId : undefined,
    coverUrl: cloudImage(value.coverUrl), lastPlayed: new Date(value.lastPlayed).toISOString(), mode: value.mode,
    modes: [...new Set<PlayMode>([value.mode, ...(Array.isArray(value.modes) ? value.modes.filter((v: PlayMode) => ['local', 'console', 'cloud', 'xbox'].includes(v)) : [])])],
  };
}
export function mergePlayedGames(...lists: PlayedGame[][]): PlayedGame[] {
  const entries = new Map<string, PlayedGame>();
  for (const list of lists) for (const raw of list) {
    const game = cleanPlayedGame(raw); if (!game) continue;
    const old = entries.get(game.id);
    if (!old) entries.set(game.id, game);
    else {
      const latest = Date.parse(game.lastPlayed) > Date.parse(old.lastPlayed) ? game : old;
      entries.set(game.id, { ...old, ...latest, gameId: game.gameId ?? old.gameId, titleId: game.titleId ?? old.titleId, cloudId: game.cloudId ?? old.cloudId, coverUrl: latest.coverUrl ?? old.coverUrl ?? game.coverUrl, modes: [...new Set([...old.modes, ...game.modes])] });
    }
  }
  return [...entries.values()].sort((a, b) => Date.parse(b.lastPlayed) - Date.parse(a.lastPlayed)).slice(0, 500);
}
export function validateDiscord(value: any): DiscordSettings {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.applicationId !== 'string' || value.applicationId.length > 22 || value.applicationId && !/^\d{17,22}$/.test(value.applicationId) || value.enabled && !value.applicationId) throw Error('Enter a valid public Discord application ID before enabling Rich Presence.');
  return { enabled: value.enabled, applicationId: value.applicationId };
}
export class GameHubStore {
  recent: PlayedGame[] = [];
  discord: DiscordSettings = { enabled: false, applicationId: '' };
  private writes = Promise.resolve(); private pending = 0;
  private file: string;
  constructor(root: string, private changed: () => void) { this.file = path.join(root, 'game-hub.json'); }
  get pendingWrites(): boolean { return this.pending > 0; }
  async load(): Promise<void> {
    try {
      const stat = await fs.stat(this.file); if (stat.size > 2_000_000) return;
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.recent = mergePlayedGames(Array.isArray(data.recent) ? data.recent.slice(0, 500) : []);
      try { this.discord = validateDiscord(data.discord); } catch {}
    } catch { /* New or unreadable history must not affect sign-in or installed games. */ }
  }
  async record(value: Omit<PlayedGame, 'id' | 'modes'>): Promise<void> {
    const game = cleanPlayedGame(value); if (!game) return;
    this.recent = mergePlayedGames([game], this.recent); this.changed(); await this.save();
  }
  async configure(value: DiscordSettings): Promise<void> { this.discord = validateDiscord(value); await this.save(); this.changed(); }
  private async save(): Promise<void> {
    const data = JSON.stringify({ recent: this.recent, discord: this.discord }); this.pending++;
    const job = this.writes.then(async () => { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(`${this.file}.tmp`, data, { mode: 0o600 }); await fs.rename(`${this.file}.tmp`, this.file); });
    this.writes = job.catch(() => {});
    try { await job; } finally { this.pending--; }
  }
  async flush(): Promise<void> { await this.writes; }
}
