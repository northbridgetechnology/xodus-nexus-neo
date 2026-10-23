import { describe, expect, it } from 'vitest';
import { catalogDate, catalogPlayModes, editionGenerations, gamePassAddedDate, hydrateCloudEditions } from './cloud-catalog-metadata';
import { hydrateCloudGames } from './remote-play-api';
import type { CloudGame } from '../shared/cloud-gaming';
const game: CloudGame = { id: 'GAME', productId: '9NP1P1WFS0LB', title: 'Halo Infinite', genres: [], entitled: true };
describe('Cloud catalog metadata', () => {
  it('distinguishes original Xbox and Xbox 360 editions from modern compatibility tags without guessing from release dates', () => {
    const legacy = { PackageFamilyName: 'Xbox360BackwardCompatibil.PrimaryGame_test', XboxConsoleGenOptimized: ['ConsoleGen8'], XboxConsoleGenCompatible: ['ConsoleGen8', 'ConsoleGen9'] };
    expect(editionGenerations('Psychonauts', legacy)).toEqual(['xbox']);
    expect(editionGenerations('Crimson Skies®: High Road to Revenge™', legacy)).toEqual(['xbox']);
    expect(editionGenerations('Fable II', legacy)).toEqual(['xbox360']);
    expect(editionGenerations('Tom Clancy’s Splinter Cell: Double Agent', legacy)).toEqual([]);
  });
  it('keeps remasters under their streamed edition and supports cross-generation games and missing metadata', () => {
    expect(editionGenerations('Destroy All Humans!', { PackageFamilyName: 'ModernRemake_test', XboxConsoleGenOptimized: ['ConsoleGen8'] })).toEqual(['xboxone']);
    expect(editionGenerations('Halo Infinite', { XboxConsoleGenOptimized: ['ConsoleGen8', 'ConsoleGen9'] })).toEqual(['xboxone', 'series']);
    expect(editionGenerations('Series game', { XboxConsoleGenCompatible: ['ConsoleGen9'] })).toEqual(['series']);
    expect(editionGenerations('Unknown', {})).toEqual([]);
  });
  it('uses the earliest valid Game Pass plan entry and never substitutes release dates or discovery time', () => {
    expect(gamePassAddedDate({ CONSOLE: { EntryDateUTC: '2021-12-08T18:00:00Z' }, PC: { EntryDateUTC: '2021-12-08T18:00:00Z' }, STANDARD: { EntryDateUTC: '2024-08-12T14:00:00Z' }, BAD: { EntryDateUTC: 'not-a-date' } })).toBe('2021-12-08T18:00:00.000Z');
    expect(gamePassAddedDate({ PLAN: { ReleaseDate: '2020-01-01T00:00:00Z' } })).toBeUndefined();
    expect(catalogDate('9999-01-01T00:00:00Z')).toBeUndefined(); expect(catalogDate(null)).toBeUndefined();
  });
  it('reads player modes only from explicit capabilities and enriches only matching products', () => {
    expect(catalogPlayModes([{ Name: 'SinglePlayer' }, { Name: 'XblOnlineCoop' }])).toEqual(['single', 'coop', 'online']);
    expect(catalogPlayModes([{ Name: 'XblLocalMultiPlayer' }])).toEqual(['local']); expect(catalogPlayModes('SinglePlayer')).toEqual([]);
    const games = [structuredClone(game)];
    hydrateCloudGames(games, { [game.productId]: { ProductTitle: game.title, OriginalReleaseDate: '2021-12-08T00:00:00Z', PassMetadataByPassProductId: { PLAN: { EntryDateUTC: '2022-01-01T00:00:00Z' } }, Attributes: [{ Name: 'SinglePlayer' }], Categories: ['Shooter'] } });
    expect(games[0]).toMatchObject({ releaseDate: '2021-12-08T00:00:00.000Z', addedDate: '2022-01-01T00:00:00.000Z', playModes: ['single'], genres: ['Shooter'] });
    hydrateCloudEditions(games, { Products: [{ ProductId: game.productId, Properties: { XboxConsoleGenOptimized: ['ConsoleGen9'] } }] });
    expect(games[0].generations).toEqual(['series']);
    expect(() => hydrateCloudEditions(games, { Products: {} })).toThrow('unreadable');
  });
});
