import { afterEach, expect, it, vi } from 'vitest';
import { defaultCloudFilters, filterCloudGames, loadCloudFilters, saveCloudFilters, cloudCardDate } from './cloud-catalog-filters';
import type { CloudGame } from '../shared/cloud-gaming';
const first: CloudGame = { id: 'A', productId: '', title: 'Game 2', entitled: true, genres: ['Shooter'], publisher: 'Studio', generations: ['xboxone', 'series'], playModes: ['single', 'coop'], releaseDate: '2020-01-01T00:00:00Z', addedDate: '2024-06-01T00:00:00Z' };
const second: CloudGame = { ...first, id: 'B', title: 'Game 10', generations: ['xbox360'], playModes: ['online'], releaseDate: '2023-01-01T00:00:00Z', addedDate: '2021-01-01T00:00:00Z' };
const unknown: CloudGame = { id: 'C', productId: '', title: 'Unknown', entitled: false, genres: [] };
afterEach(() => vi.unstubAllGlobals());
it('combines generation, genre, publisher, play style, search and access filters', () => {
  const games = [first, second, unknown];
  expect(filterCloudGames(games, 'Game', true, { ...defaultCloudFilters, generation: 'series', genre: 'Shooter', publisher: 'Studio', mode: 'coop' })).toEqual([first]);
  expect(filterCloudGames(games, '', true, { ...defaultCloudFilters, generation: 'xboxone' })).toEqual([first]);
  expect(filterCloudGames(games, '', true, { ...defaultCloudFilters, generation: 'xbox360' })).toEqual([second]);
  expect(filterCloudGames(games, '', false, { ...defaultCloudFilters, generation: 'unknown' })).toEqual([unknown]);
  expect(filterCloudGames(games, '', true, { ...defaultCloudFilters, generation: 'unknown' })).toEqual([]);
});
it('sorts by entry date separately from release date, leaving unknown dates last in both directions', () => {
  const games = [unknown, second, first];
  expect(filterCloudGames(games, '', false, { ...defaultCloudFilters, sort: 'added-new' }).map(g => g.id)).toEqual(['A', 'B', 'C']);
  expect(filterCloudGames(games, '', false, { ...defaultCloudFilters, sort: 'added-old' }).map(g => g.id)).toEqual(['B', 'A', 'C']);
  expect(filterCloudGames(games, '', false, { ...defaultCloudFilters, sort: 'release-new' }).map(g => g.id)).toEqual(['B', 'A', 'C']);
  expect(filterCloudGames(games, '', false, { ...defaultCloudFilters, sort: 'release-old' }).map(g => g.id)).toEqual(['A', 'B', 'C']);
  expect(games.map(g => g.id)).toEqual(['C', 'B', 'A']);
});
it('preserves batch order by default and supports natural alphabetical ordering with deterministic ties', () => {
  const games = [second, first]; expect(filterCloudGames(games, '', true)).toEqual(games);
  expect(filterCloudGames(games, '', true, { ...defaultCloudFilters, sort: 'az' })).toEqual([first, second]);
  expect(filterCloudGames(games, '', true, { ...defaultCloudFilters, sort: 'za' })).toEqual([second, first]);
  expect(cloudCardDate(unknown, 'added-new')).toBe('Added date not listed');
});
it('validates saved filter choices and tolerates blocked or corrupt local storage', () => {
  const setItem = vi.fn(); vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ generation: 'bad', mode: 'invalid', sort: '__proto__', genre: 'Shooter' }), setItem });
  expect(loadCloudFilters()).toEqual({ ...defaultCloudFilters, genre: 'Shooter' }); saveCloudFilters(defaultCloudFilters); expect(setItem).toHaveBeenCalledOnce();
  vi.stubGlobal('localStorage', { getItem: () => '{bad', setItem: () => { throw Error('blocked'); } });
  expect(loadCloudFilters()).toEqual(defaultCloudFilters); expect(() => saveCloudFilters(defaultCloudFilters)).not.toThrow();
});
