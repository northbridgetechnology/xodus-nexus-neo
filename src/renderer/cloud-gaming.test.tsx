import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudGameCard, filterCloudGames } from './CloudGaming';
const game = { id: 'CLOUD_GAME', productId: '9ABCDEFGHIJK', title: 'A Cloud Adventure', publisher: 'Sample Studio', genres: ['Racing'], entitled: true };
it('searches cloud titles, publishers and genres and defaults to games the account can play', () => {
  const games = [game, { ...game, id: 'LOCKED', title: 'Locked game', entitled: false }];
  expect(filterCloudGames(games, 'studio', true)).toEqual([game]); expect(filterCloudGames(games, 'RACING', true)).toEqual([game]);
  expect(filterCloudGames(games, '', false)).toHaveLength(2); expect(filterCloudGames(games, 'missing', true)).toHaveLength(0);
});
it('enables play only for entitled cloud titles and does not treat downloads as streaming access', () => {
  const enabled = renderToStaticMarkup(<CloudGameCard game={game} busy={false} play={() => {}} />);
  expect(enabled).toContain('Ready to stream'); expect(enabled).not.toContain('disabled=""');
  const locked = renderToStaticMarkup(<CloudGameCard game={{ ...game, entitled: false }} busy={false} play={() => {}} />);
  expect(locked).toContain('disabled=""'); expect(locked).toContain('Access required');
});
