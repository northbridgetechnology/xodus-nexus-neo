import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CloudGame } from '../shared/cloud-gaming.js';
import type { PlayedGame } from '../shared/game-hub.js';
import { cloudImage } from './remote-play-api.js';
import { cleanPlayedGame } from './game-hub-store.js';
export interface BrowseSnapshot { cloud?: { at: number; games: CloudGame[] }; recent?: { at: number; games: PlayedGame[] } }
export interface StreamingBrowseCache {
  read(owner: string): Promise<BrowseSnapshot>;
  write(owner: string, snapshot: BrowseSnapshot): Promise<void>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}
interface Encryption { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
const MAX_AGE = 7 * 24 * 3600_000, MAX_BYTES = 12 * 1024 * 1024;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined;
function cleanCloud(value: any): CloudGame | undefined {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(value.id) || typeof value.title !== 'string' || !value.title || typeof value.entitled !== 'boolean') return;
  return { id: value.id, productId: typeof value.productId === 'string' && /^[A-Z0-9]{12}$/.test(value.productId) ? value.productId : '',
    title: value.title.slice(0, 250), publisher: text(value.publisher, 250), coverUrl: cloudImage(value.coverUrl), entitled: value.entitled,
    xboxTitleId: typeof value.xboxTitleId === 'string' && /^\d{1,12}$/.test(value.xboxTitleId) ? value.xboxTitleId : undefined,
    genres: Array.isArray(value.genres) ? value.genres.slice(0, 30).flatMap((v: unknown) => text(v, 100) ?? []) : [],
    generations: Array.isArray(value.generations) ? value.generations.filter((v: string) => ['xbox', 'xbox360', 'xboxone', 'series'].includes(v)).slice(0, 4) : undefined,
    playModes: Array.isArray(value.playModes) ? value.playModes.filter((v: string) => ['single', 'coop', 'online', 'local'].includes(v)).slice(0, 4) : undefined,
    addedDate: text(value.addedDate, 40), releaseDate: text(value.releaseDate, 40) };
}
export function cleanBrowse(value: any): BrowseSnapshot {
  const result: BrowseSnapshot = {};
  for (const key of ['cloud', 'recent'] as const) {
    const entry = value?.[key];
    if (!entry || !Number.isFinite(entry.at) || entry.at > Date.now() + 60_000 || Date.now() - entry.at > MAX_AGE || !Array.isArray(entry.games)) continue;
    if (key === 'cloud') result.cloud = { at: entry.at, games: entry.games.slice(0, 10000).flatMap((game: unknown) => cleanCloud(game) ?? []) };
    else result.recent = { at: entry.at, games: entry.games.slice(0, 500).flatMap((game: unknown) => cleanPlayedGame(game) ?? []) };
  }
  return result;
}
/** Descriptive snapshots only. Account scope is a random ID held inside the encrypted credential file. */
export class EncryptedStreamingBrowseCache implements StreamingBrowseCache {
  private file: string; private writes = Promise.resolve();
  constructor(root: string, private encryption: Encryption) { this.file = path.join(root, 'remote-play', 'browse-cache.enc'); }
  async read(owner: string): Promise<BrowseSnapshot> {
    try {
      if (!this.encryption.isEncryptionAvailable() || (await fs.stat(this.file)).size > MAX_BYTES) return {};
      const value = JSON.parse(this.encryption.decryptString(await fs.readFile(this.file)));
      return value.version === 1 && value.owner === owner ? cleanBrowse(value) : {};
    } catch { return {}; } // Missing, corrupt or locked caches never block sign-in.
  }
  write(owner: string, snapshot: BrowseSnapshot): Promise<void> {
    // Snapshot now, before a later refresh or sign-out can mutate the manager.
    const data = JSON.stringify({ version: 1, owner, ...cleanBrowse(snapshot) });
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (!this.encryption.isEncryptionAvailable() || Buffer.byteLength(data) > MAX_BYTES) return;
      const encrypted = this.encryption.encryptString(data);
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, this.file); }
      finally { await fs.rm(temporary, { force: true }); }
    });
    return this.writes;
  }
  async clear(): Promise<void> { await this.writes.catch(() => {}); await fs.rm(this.file, { force: true }); }
  async flush(): Promise<void> { await this.writes.catch(() => {}); }
}
