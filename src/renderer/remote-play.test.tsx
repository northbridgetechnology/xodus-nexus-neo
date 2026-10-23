import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleCard } from './RemotePlay';
import { RemoteGamepadDriver, remoteGamepadFrame, updateNativeControllers, remoteInputOptions, activeRemoteController } from './remote-gamepad';
afterEach(() => { vi.unstubAllGlobals(); updateNativeControllers({ available: false, controllers: [], updatedAt: 0 }); remoteInputOptions('', false); });
describe('Remote Play controls', () => {
  it('shows a console action only when Remote features are enabled', () => {
    const console = { id: 'F123456789012345', name: 'Living room Series X', model: 'XboxSeriesX', powerState: 'On', streamingEnabled: true };
    expect(renderToStaticMarkup(<ConsoleCard console={console} busy={false} connect={() => {}} />)).toContain('Xbox Series X');
    const disabled = renderToStaticMarkup(<ConsoleCard console={{ ...console, streamingEnabled: false }} busy={false} connect={() => {}} />);
    expect(disabled).toMatch(/disabled=""/); expect(disabled).toContain('Enable Remote features');
  });
  it('sends a controller at browser index 2 through Xbox slot zero and clears input while the page is hidden', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [null, null, { connected: true, mapping: 'standard', index: 2, buttons: [{ value: 1 }], axes: [] }] });
    vi.stubGlobal('document', { hasFocus: () => true });
    const driver = new RemoteGamepadDriver();
    expect(driver.requestStates()[0]).toMatchObject({ GamepadIndex: 0, A: 1 });
    driver.setEnabled(false); expect(driver.requestStates()[0]).toMatchObject({ GamepadIndex: 0, A: 0 });
  });
  it('uses native Switch Pro input even when the browser exposes no gamepad, and supports Nintendo face-label swapping', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [] }); vi.stubGlobal('document', { hasFocus: () => true });
    updateNativeControllers({ available: true, updatedAt: Date.now(), controllers: [{ id: 'native:switch', name: 'Pro Controller', index: 0, source: 'macos', mapping: 'standard', buttons: [1, 0, 0, 0, ...Array(13).fill(0)], axes: [0.2, -0.4, 0, 0] }] });
    expect(activeRemoteController()?.name).toBe('Pro Controller');
    const driver = new RemoteGamepadDriver();
    expect(driver.requestStates()[0]).toMatchObject({ A: 1, B: 0, LeftThumbXAxis: 0.2, LeftThumbYAxis: -0.4 });
    remoteInputOptions('', true); expect(driver.requestStates()[0]).toMatchObject({ A: 0, B: 1 });
    updateNativeControllers({ available: true, controllers: [], updatedAt: Date.now() });
    expect(driver.requestStates()[0]).toMatchObject({ A: 0, B: 0 });
  });
  it('rejects stale native controller states instead of leaving a button held', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [] }); vi.stubGlobal('document', { hasFocus: () => true });
    updateNativeControllers({ available: true, updatedAt: Date.now() - 5000, controllers: [{ id: 'native:switch', name: 'Pro Controller', index: 0, source: 'macos', mapping: 'standard', buttons: Array(17).fill(1), axes: [1, 1, 1, 1] }] });
    expect(new RemoteGamepadDriver().requestStates()[0]).toMatchObject({ A: 0, B: 0, LeftThumbXAxis: 0 });
  });
  it('maps a controller to Xbox slot zero and safely defaults absent axes/buttons', () => {
    const frame = remoteGamepadFrame({ buttons: [{ value: 1 }] as GamepadButton[], axes: [0.5, -0.7, 9, NaN] });
    expect(frame).toMatchObject({ GamepadIndex: 0, A: 1, B: 0, LeftThumbXAxis: 0.5, LeftThumbYAxis: -0.7, RightThumbXAxis: 1, RightThumbYAxis: 0 });
    const neutral = remoteGamepadFrame(); expect(Object.values(neutral).every(value => value === 0)).toBe(true);
  });
});
