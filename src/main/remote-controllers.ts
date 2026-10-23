import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { RemoteController, RemoteControllerStatus } from '../shared/remote-play.js';
export function nativeControllerPacket(value: unknown): RemoteController[] {
  const controllers = (value as any)?.controllers;
  if (!Array.isArray(controllers) || controllers.length > 8) throw Error('Invalid controller packet.');
  return controllers.map((item: any, index: number) => {
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || typeof item.name !== 'string' || item.name.length > 150 || !Array.isArray(item.buttons) || item.buttons.length !== 17 || !Array.isArray(item.axes) || item.axes.length !== 4 || ![...item.buttons, ...item.axes].every(Number.isFinite)) throw Error('Invalid controller input.');
    return { id: `native:${item.id}`, name: item.name, index, source: 'macos', mapping: 'standard',
      buttons: item.buttons.map((v: number) => Math.min(1, Math.max(0, v))), axes: item.axes.map((v: number) => Math.min(1, Math.max(-1, v))) };
  });
}
/** Only gamepad data is read. No global key events or system controller settings. */
export class NativeRemoteControllers {
  private child?: ChildProcessWithoutNullStreams;
  private status: RemoteControllerStatus = { available: false, controllers: [], updatedAt: 0 };
  private buffered = '';
  private generation = 0;
  constructor(private executable: string, private changed: (value: RemoteControllerStatus) => void) {}
  get current(): RemoteControllerStatus { return structuredClone(this.status); }
  start(): void {
    if (process.platform !== 'darwin' || this.child) return;
    const generation = ++this.generation;
    const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false }); this.child = child;
    const unavailable = () => {
      if (this.generation !== generation) return;
      this.child = undefined; this.status = { available: false, controllers: [], updatedAt: Date.now(), error: 'Native controller input is unavailable. Browser gamepads and keyboard controls can still be used.' }; this.changed(this.current);
    };
    child.on('error', unavailable); child.on('exit', unavailable);
    child.stderr.resume();
    child.stdout.on('data', (data: Buffer) => {
      if (this.generation !== generation) return;
      this.buffered += data.toString('utf8');
      if (this.buffered.length > 65_536) { child.kill(); return; }
      const lines = this.buffered.split('\n'); this.buffered = lines.pop() ?? '';
      for (const line of lines) {
        try { this.status = { available: true, controllers: nativeControllerPacket(JSON.parse(line)), updatedAt: Date.now() }; this.changed(this.current); }
        catch { child.kill(); return; }
      }
    });
  }
  restart(): void { this.stop(); this.start(); }
  stop(): void {
    this.generation++; const child = this.child; this.child = undefined; child?.kill(); this.buffered = '';
    this.status = { available: false, controllers: [], updatedAt: Date.now() }; this.changed(this.current);
  }
}
