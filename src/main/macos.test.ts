import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { BackendManager } from './backend.js';
import { RuntimeManager } from './runtime.js';
import { LauncherUpdater } from './launcher-update.js';
import { KeyringSupport } from './keyring.js';
import { DownloadCleanup } from './download-cleanup.js';
import { gameLaunchArguments } from './game-launch.js';
import { findAuthBrowser } from './auth-browser.js';

afterEach(() => vi.restoreAllMocks());
describe.skipIf(process.platform !== 'darwin')('macOS preview boundaries', () => {
  it('does not discover or install Linux backend releases', async () => {
    const fetcher = vi.fn();
    const backend = new BackendManager('/unused', '', () => {}, () => false, fetcher);
    const status = await backend.checkUpdate();
    expect(status.releaseAvailable).toBe(false);
    expect(status.blockReason).toContain('native macOS backend');
    await expect(backend.update(() => {})).rejects.toThrow('backend:mac');
    await expect(backend.rebuild(() => {})).rejects.toThrow('backend:mac');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not discover or install Linux Proton runtimes', async () => {
    const fetcher = vi.fn();
    const runtime = new RuntimeManager('/unused', () => {}, () => false, fetcher);
    expect((await runtime.refresh()).installed).toBe(false);
    expect((await runtime.check()).artifactAvailable).toBe(false);
    expect((await runtime.checkNexus()).nexusAvailable).toBe(false);
    await expect(runtime.install(() => {})).rejects.toThrow('cannot run on macOS');
    await expect(runtime.installNexus(() => {})).rejects.toThrow('cannot run on macOS');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not offer Linux AppImage updates', async () => {
    const fetcher = vi.fn();
    const updater = new LauncherUpdater('0.3.9', undefined, '/unused', () => {}, fetcher);
    await updater.check();
    expect(updater.state.canInstall).toBe(false);
    expect(updater.state.latestVersion).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses macOS Keychain without executing D-Bus commands', async () => {
    const execute = vi.fn();
    const status = await new KeyringSupport({}, execute, 'darwin').check();
    expect(status.state).toBe('ready');
    expect(status.message).toContain('Sign-in verifies');
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects game playback before invoking a Wine runner', () => {
    expect(() => gameLaunchArguments({ path: '/game', executable: 'Game.exe' }, '/wine', 'US', 'linux-run-v22')).toThrow('macOS preview');
  });
  it('keeps cancelled files when Linux descriptor-safe cleanup is unavailable', async () => {
    const cleanup = new DownloadCleanup('/unused');
    const task = { kind: 'install', destination: '/game' } as any;
    expect((await cleanup.options(task, [], [])).deleteFilesAllowed).toBe(false);
    await expect(cleanup.remove(task, [], [])).rejects.toThrow('keeps cancelled download files');
  });
  it('finds Chrome inside an application bundle for isolated browser sign-in', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ isFile: () => true } as any);
    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    expect(await findAuthBrowser({}, 'darwin')).toEqual({ kind: 'native', binary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  });
});

describe('portable tar listing validation', () => {
  it('accepts GNU and BSD owner/size columns and rejects links or oversized files', async () => {
    const { backendPackageName, validateBackendArchive } = await import('./backend-package.js');
    const name = backendPackageName('0.2.9');
    const entries = [`${name}/`, ...['LICENSE', 'xodus-cli', 'xodus-service'].map(file => `${name}/${file}`)];
    const gnu = entries.map((file, i) => `${i ? '-rwxr-xr-x' : 'drwxr-xr-x'} user/group 64 2026-10-20 00:00 ${file}`);
    const bsd = entries.map((file, i) => `${i ? '-rwxr-xr-x' : 'drwxr-xr-x'} 0 user group 64 Oct 20 00:00 ${file}`);
    expect(() => validateBackendArchive(entries, gnu, name)).not.toThrow();
    expect(() => validateBackendArchive(entries, bsd, name)).not.toThrow();
    for (const listing of [gnu, bsd]) {
      expect(() => validateBackendArchive(entries, [listing[0], listing[1].replace(/^-/, 'l'), ...listing.slice(2)], name)).toThrow('Unsafe');
      expect(() => validateBackendArchive(entries, listing.map(line => line.replace(' 64 ', ' 999999999 ')), name)).toThrow('Unsafe');
    }
  });
});
