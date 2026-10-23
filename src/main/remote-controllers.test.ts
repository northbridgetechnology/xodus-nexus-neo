import { describe, expect, it } from 'vitest';
import { nativeControllerPacket } from './remote-controllers';
describe('native macOS controller bridge', () => {
  it('accepts Switch Pro inputs in Xbox order and clamps axis/button ranges', () => {
    const buttons = Array(17).fill(0); buttons[0] = 1; buttons[6] = 4;
    const controllers = nativeControllerPacket({ controllers: [{ id: 'test-id', name: 'Pro Controller', buttons, axes: [0.5, -0.3, 5, -5] }] });
    expect(controllers).toEqual([{ id: 'native:test-id', name: 'Pro Controller', source: 'macos', mapping: 'standard', index: 0, buttons: buttons.map(v => Math.min(1, v)), axes: [0.5, -0.3, 1, -1] }]);
  });
  it.each([{ controllers: Array(9).fill({}) }, { controllers: [{ id: 'test', name: 'Pad', buttons: [], axes: [] }] }, { controllers: [{ id: 'test', name: 'Pad', buttons: Array(17).fill(NaN), axes: [0, 0, 0, 0] }] }])('rejects invalid or oversized native input: %j', packet => {
    expect(() => nativeControllerPacket(packet)).toThrow();
  });
});
