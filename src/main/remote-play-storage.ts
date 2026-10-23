import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RemoteUserToken } from './remote-play-api.js';
export interface RemotePlayCredentials {
  read(): Promise<RemoteUserToken | undefined>;
  write(token: RemoteUserToken): Promise<void>;
  clear(): Promise<void>;
}
interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** A separate credential file; never touches the Rust backend's Keychain records. */
export class EncryptedRemotePlayCredentials implements RemotePlayCredentials {
  private file: string;
  constructor(userData: string, private encryption: Encryption) { this.file = path.join(userData, 'remote-play', 'account.enc'); }
  async read(): Promise<RemoteUserToken | undefined> {
    let data: Buffer;
    try { data = await fs.readFile(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw Error('Remote Play credentials could not be read.'); }
    if (!this.encryption.isEncryptionAvailable()) throw Error('macOS credential encryption is unavailable. Unlock your Keychain and try again.');
    try {
      const value = JSON.parse(this.encryption.decryptString(data));
      if (typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || !Number.isFinite(value.expiresAt)) throw Error();
      return value;
    } catch { throw Error('Remote Play credentials could not be unlocked. Sign out of Remote Play, then sign in again.'); }
  }
  async write(token: RemoteUserToken): Promise<void> {
    if (!this.encryption.isEncryptionAvailable()) throw Error('Secure credential storage is unavailable. Sign in with Remember account turned off.');
    const encrypted = this.encryption.encryptString(JSON.stringify(token));
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, this.file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async clear(): Promise<void> { await fs.rm(this.file, { force: true }); }
}
