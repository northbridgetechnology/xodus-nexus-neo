import type { CloudGame, CloudGeneration, CloudPlayMode } from '../shared/cloud-gaming';
export const generationLabels: Record<CloudGeneration, string> = { xbox: 'Original Xbox', xbox360: 'Xbox 360', xboxone: 'Xbox One', series: 'Xbox Series X|S' };
export const playModeLabels: Record<CloudPlayMode, string> = { single: 'Single player', coop: 'Co-op', online: 'Online multiplayer', local: 'Local multiplayer' };
export const cloudSortLabels = {
  catalog: 'Catalog order', az: 'Title: A–Z', za: 'Title: Z–A',
  'added-new': 'Added to Game Pass: newest', 'added-old': 'Added to Game Pass: oldest',
  'release-new': 'Release date: newest', 'release-old': 'Release date: oldest',
} as const;
export interface CloudCatalogFilters {
  generation: '' | CloudGeneration | 'unknown'; genre: string; publisher: string;
  mode: '' | CloudPlayMode; sort: keyof typeof cloudSortLabels;
}
export const defaultCloudFilters: CloudCatalogFilters = { generation: '', genre: '', publisher: '', mode: '', sort: 'catalog' };
export function loadCloudFilters(): CloudCatalogFilters {
  try {
    const value = JSON.parse(localStorage.getItem('xodus.cloud-catalog-filters.v1') ?? '{}');
    return { generation: [...Object.keys(generationLabels), 'unknown'].includes(value?.generation) ? value.generation : '',
      genre: typeof value?.genre === 'string' ? value.genre.slice(0, 80) : '', publisher: typeof value?.publisher === 'string' ? value.publisher.slice(0, 250) : '',
      mode: Object.hasOwn(playModeLabels, value?.mode) ? value.mode : '', sort: Object.hasOwn(cloudSortLabels, value?.sort) ? value.sort : 'catalog' };
  } catch { return { ...defaultCloudFilters }; }
}
export function saveCloudFilters(value: CloudCatalogFilters): void {
  try { localStorage.setItem('xodus.cloud-catalog-filters.v1', JSON.stringify(value)); } catch {}
}
export function filterCloudGames(games: CloudGame[], query: string, playable: boolean, filters: CloudCatalogFilters = defaultCloudFilters): CloudGame[] {
  const term = query.trim().toLocaleLowerCase();
  const result = games.filter(game => (!playable || game.entitled)
    && (!term || `${game.title} ${game.publisher ?? ''} ${game.genres.join(' ')}`.toLocaleLowerCase().includes(term))
    && (!filters.generation || (filters.generation === 'unknown' ? !game.generations?.length : game.generations?.includes(filters.generation)))
    && (!filters.genre || game.genres.includes(filters.genre)) && (!filters.publisher || game.publisher === filters.publisher)
    && (!filters.mode || game.playModes?.includes(filters.mode)));
  if (filters.sort === 'catalog') return result;
  const titleOrder = (a: CloudGame, b: CloudGame) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
  return result.sort((a, b) => {
    if (filters.sort === 'az') return titleOrder(a, b);
    if (filters.sort === 'za') return -titleOrder(a, b);
    const field = filters.sort.startsWith('added-') ? 'addedDate' : 'releaseDate';
    const aDate = a[field] ? Date.parse(a[field]!) : NaN, bDate = b[field] ? Date.parse(b[field]!) : NaN;
    // Missing dates always go last, in either direction. Never substitute today's date.
    if (!Number.isFinite(aDate) && !Number.isFinite(bDate)) return titleOrder(a, b);
    if (!Number.isFinite(aDate)) return 1; if (!Number.isFinite(bDate)) return -1;
    return (aDate - bDate) * (filters.sort.endsWith('new') ? -1 : 1) || titleOrder(a, b);
  });
}
export function cloudCardDate(game: CloudGame, sort: CloudCatalogFilters['sort']): string | undefined {
  if (!sort.startsWith('added-') && !sort.startsWith('release-')) return;
  const added = sort.startsWith('added-'), value = added ? game.addedDate : game.releaseDate;
  const date = value ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? `${added ? 'Game Pass' : 'Released'}: ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}` : `${added ? 'Added' : 'Release'} date not listed`;
}
