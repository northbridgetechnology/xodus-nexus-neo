import type { RemoteController, RemoteControllerStatus } from '../shared/remote-play';
import type xCloudPlayer from 'xbox-xcloud-player';
import type { InputFrame } from 'xbox-xcloud-player/dist/Channel/Input';
const labels = ['A', 'B', 'X', 'Y', 'LeftShoulder', 'RightShoulder', 'LeftTrigger', 'RightTrigger', 'View', 'Menu', 'LeftThumb', 'RightThumb', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight', 'Nexus'] as const;
const keys: Record<string, typeof labels[number]> = { ArrowUp: 'DPadUp', ArrowDown: 'DPadDown', ArrowLeft: 'DPadLeft', ArrowRight: 'DPadRight', Enter: 'A', a: 'A', Backspace: 'B', b: 'B', x: 'X', y: 'Y', '[': 'LeftShoulder', ']': 'RightShoulder', '-': 'LeftTrigger', '=': 'RightTrigger', v: 'View', m: 'Menu', n: 'Nexus' };
let native: RemoteControllerStatus = { available: false, controllers: [], updatedAt: 0 };
let selection = '';
let swapFaceButtons = false;
export function updateNativeControllers(value: RemoteControllerStatus): void { native = value; }
export function remoteInputSettings() { return { selection, swapFaceButtons }; }
export function nativeControllerStatus(): RemoteControllerStatus { return native; }
export function remoteInputOptions(controllerId: string, swap: boolean): void { selection = controllerId; swapFaceButtons = swap; }
export function availableRemoteControllers(): RemoteController[] {
  const nativePads = native.available && Date.now() - native.updatedAt < 2000 ? native.controllers : [];
  const browserPads = [...navigator.getGamepads()].filter((pad): pad is Gamepad => Boolean(pad?.connected)).map(pad => ({
    id: `browser:${pad.index}`, name: pad.id, index: pad.index, source: 'browser' as const, mapping: pad.mapping,
    buttons: pad.buttons.map(button => button.value), axes: [...pad.axes],
  }));
  return [...nativePads, ...browserPads];
}
export function activeRemoteController(): RemoteController | undefined {
  const pads = availableRemoteControllers(); return pads.find(pad => pad.id === selection) ?? pads[0];
}
export function selectedControllerFrame(controller = activeRemoteController()): InputFrame {
  const frame = remoteGamepadFrame(controller ? { buttons: controller.buttons.map(value => ({ value } as GamepadButton)), axes: controller.axes } : undefined);
  if (swapFaceButtons) { [frame.A, frame.B] = [frame.B, frame.A]; [frame.X, frame.Y] = [frame.Y, frame.X]; }
  return frame;
}
export function remoteGamepadFrame(gamepad?: Pick<Gamepad, 'buttons' | 'axes'> | null): InputFrame {
  const frame = { GamepadIndex: 0 } as InputFrame;
  labels.forEach((label, index) => { frame[label] = Math.max(0, Math.min(1, Number(gamepad?.buttons[index]?.value) || 0)); });
  const axis = (index: number) => Math.max(-1, Math.min(1, Number(gamepad?.axes[index]) || 0));
  frame.LeftThumbXAxis = axis(0); frame.LeftThumbYAxis = axis(1); frame.RightThumbXAxis = axis(2); frame.RightThumbYAxis = axis(3);
  return frame;
}
/** macOS may expose the only controller at index 2. Map it to Xbox slot zero. */
export class RemoteGamepadDriver {
  private player?: xCloudPlayer;
  private timer?: ReturnType<typeof setInterval>;
  private enabled = true;
  private pressed: Partial<Record<typeof labels[number], number>> = {};
  private pulses = new Set<ReturnType<typeof setTimeout>>();
  setApplication(player: xCloudPlayer): void { this.player = player; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.pressed = {}; }
  private keyDown = (event: KeyboardEvent) => this.key(event, true);
  private keyUp = (event: KeyboardEvent) => this.key(event, false);
  private blur = () => { this.pressed = {}; };
  private key(event: KeyboardEvent, down: boolean): void {
    if (!this.enabled || event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement)?.closest?.('input, textarea, select, button')) return;
    const button = keys[event.key]; if (!button) return;
    event.preventDefault(); this.pressed[button] = down ? 1 : 0;
  }
  start(): void { window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp); window.addEventListener('blur', this.blur); }
  run(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const input = this.player?.getChannelProcessor('input');
      if (this.player?.getDataChannel('input')?.readyState !== 'open') return;
      input?._inputFps?.count(); input?.queueGamepadStates(this.requestStates());
    }, 1000 / 60);
  }
  requestStates(): InputFrame[] {
    const enabled = this.enabled && document.hasFocus() && !document.querySelector?.('[role="dialog"][aria-modal="true"]');
    const frame = enabled ? selectedControllerFrame() : remoteGamepadFrame();
    if (enabled) labels.forEach(label => { frame[label] = Math.max(frame[label], this.pressed[label] ?? 0); });
    return [frame];
  }
  pressButton(_index: number, button: string): void {
    if (!labels.includes(button as any)) return;
    this.pressed[button as typeof labels[number]] = 1;
    const timeout = setTimeout(() => { this.pressed[button as typeof labels[number]] = 0; this.pulses.delete(timeout); }, 100);
    this.pulses.add(timeout);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.pulses.forEach(clearTimeout); this.pulses.clear(); this.pressed = {};
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur);
  }
}
