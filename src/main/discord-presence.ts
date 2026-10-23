import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiscordSettings, DiscordStatus, PlayMode } from '../shared/game-hub.js';
export interface PresenceGame { id: string; title: string; mode: PlayMode; startedAt: number }
export function discordActivity(game?: PresenceGame): object | null {
  return game ? { details: game.title.slice(0, 128), state: { local: 'Playing locally', console: 'Xbox console streaming', cloud: 'Xbox Cloud Gaming', xbox: 'Xbox activity' }[game.mode], timestamps: { start: Math.floor(game.startedAt / 1000) }, instance: false } : null;
}
export function discordFrame(opcode: number, value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value)), result = Buffer.alloc(8 + payload.length);
  result.writeUInt32LE(opcode); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8); return result;
}
export class DiscordPresence {
  status: DiscordStatus = { state: 'disabled', message: 'Rich Presence is off.' };
  private config: DiscordSettings = { enabled: false, applicationId: '' };
  private socket?: net.Socket; private ready = false; private current?: PresenceGame; private sent = '';
  private reconnect?: ReturnType<typeof setTimeout>; private generation = 0; private stopped = false;
  constructor(private changed: () => void, private roots = [...new Set([os.tmpdir(), '/tmp', ...(process.env.XDG_RUNTIME_DIR ? [process.env.XDG_RUNTIME_DIR] : [])])]) {}
  configure(value: DiscordSettings): void {
    this.close(); this.config = value; this.stopped = false;
    if (!value.enabled) this.setStatus('disabled', 'Rich Presence is off.');
    else if (!/^\d{17,22}$/.test(value.applicationId)) this.setStatus('unconfigured', 'Enter your public Discord application ID.');
    else void this.connect(++this.generation);
  }
  update(value?: PresenceGame): void { this.current = value; this.sendActivity(); }
  private setStatus(state: DiscordStatus['state'], message: string): void { this.status = { state, message }; this.changed(); }
  private sendActivity(): void {
    if (!this.ready || !this.socket) return;
    const activity = discordActivity(this.current), serialized = JSON.stringify(activity); if (this.sent === serialized) return;
    this.sent = serialized; this.socket.write(discordFrame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() }));
  }
  private async connect(generation: number): Promise<void> {
    this.setStatus('waiting', 'Waiting for Discord desktop…');
    for (const root of this.roots) for (let index = 0; index < 10; index++) {
      if (generation !== this.generation || this.stopped) return;
      const socket = net.createConnection(path.join(root, `discord-ipc-${index}`));
      const connected = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
        socket.once('connect', () => { clearTimeout(timer); resolve(true); }); socket.once('error', () => { clearTimeout(timer); resolve(false); });
      });
      if (!connected) { socket.destroy(); continue; }
      if (generation !== this.generation || this.stopped) { socket.destroy(); return; }
      this.socket = socket; let pending = Buffer.alloc(0);
      const timeout = setTimeout(() => socket.destroy(), 5000);
      socket.on('data', bytes => {
        if (generation !== this.generation || this.socket !== socket) return;
        pending = Buffer.concat([pending, bytes]);
        while (pending.length >= 8) {
          const op = pending.readUInt32LE(0), size = pending.readUInt32LE(4);
          if (size > 65536) { socket.destroy(); return; } if (pending.length < size + 8) return;
          const body = pending.subarray(8, size + 8); pending = pending.subarray(size + 8);
          if (op === 3) { const reply = Buffer.alloc(8 + size); reply.writeUInt32LE(4); reply.writeUInt32LE(size, 4); body.copy(reply, 8); socket.write(reply); continue; }
          if (op === 2) { socket.destroy(); return; }
          if (op !== 1) continue;
          try {
            const event = JSON.parse(body.toString());
            if (event.evt === 'READY') { clearTimeout(timeout); this.ready = true; this.setStatus('connected', 'Connected to Discord desktop.'); this.sendActivity(); }
            if (event.evt === 'ERROR') this.setStatus('error', 'Discord rejected the activity. Check the application ID and Discord activity settings.');
          } catch { socket.destroy(); return; }
        }
      });
      socket.on('error', () => {});
      socket.once('close', () => {
        clearTimeout(timeout); if (this.socket === socket) { this.socket = undefined; this.ready = false; this.sent = ''; }
        if (generation === this.generation && !this.stopped) this.retry(generation);
      });
      socket.write(discordFrame(0, { v: 1, client_id: this.config.applicationId })); return;
    }
    if (generation === this.generation && !this.stopped) this.retry(generation);
  }
  private retry(generation: number): void {
    this.setStatus('waiting', 'Waiting for Discord desktop. Open Discord to share activity.');
    this.reconnect = setTimeout(() => { void this.connect(generation); }, 15000); this.reconnect.unref();
  }
  private close(): void {
    this.generation++; this.stopped = true; if (this.reconnect) clearTimeout(this.reconnect); this.reconnect = undefined;
    if (this.socket) { this.socket.end(discordFrame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })); this.socket.destroySoon(); }
    this.socket = undefined; this.ready = false; this.sent = '';
  }
  dispose(): void { this.close(); }
}
