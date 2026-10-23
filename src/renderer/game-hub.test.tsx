import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { combineRecentGames } from './GameHub';
import { CloudGameCard } from './CloudGaming';
import { RemoteGamepadDriver } from './remote-gamepad';
const first = { id: 'cloud', productId: '9NP1P1WFS0LB', title: 'Halo Infinite', titleId: '12345', cloudId: 'HALOINFINITE', mode: 'cloud' as const, modes: ['cloud' as const], lastPlayed: '2026-10-21T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());
it('combines remote account history with Xodus sessions without requiring installations or inventing a play method', () => {
  const games = combineRecentGames([first], [{ ...first, id: 'xbox:12345', productId: undefined, mode: 'xbox', modes: ['xbox'], lastPlayed: '2026-10-21T01:00:00Z' }]);
  expect(games).toHaveLength(1); expect(games[0]).toMatchObject({ productId: first.productId, cloudId: first.cloudId, mode: 'xbox', modes: ['cloud', 'xbox'] });
});
it('gives cloud covers and titles their own details actions without disabling game details for locked games', () => {
  const html = renderToStaticMarkup(<CloudGameCard game={{ id: 'g', productId: first.productId, title: 'Halo', genres: [], entitled: false }} busy={false} play={() => {}} />);
  expect(html).toContain('View Halo Store details'); expect(html).toContain('cloud-title-button'); expect(html).toMatch(/disabled=""[^>]*aria-label="Play Halo"/);
});
it('sends neutral controller input while a Store details or screenshot dialog is open', () => {
  vi.stubGlobal('document', { hasFocus: () => true, querySelector: () => ({}) });
  vi.stubGlobal('navigator', { getGamepads: () => [{ id: 'pad', index: 0, connected: true, mapping: 'standard', buttons: [{ value: 1 }], axes: [] }] });
  expect(new RemoteGamepadDriver().requestStates()[0].A).toBe(0);
});
it('keeps identically named editions separate when their product and Xbox title IDs differ', () => {
  expect(combineRecentGames([first], [{ ...first, id: 'different-edition', productId: '9ABCDEFGHIJK', titleId: '67890', mode: 'xbox', modes: ['xbox'] }])).toHaveLength(2);
});
