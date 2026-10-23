import type { CloudGame, CloudGeneration, CloudPlayMode } from '../shared/cloud-gaming.js';
// Original Xbox backward-compatible editions, sourced from Xbox's compatibility
// announcements. See assets/cloud-console-generations.json for provenance.
const normalizedTitle = (value: string) => value.replace(/[®™]/g, '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const originalXbox = new Set(["Advent Rising", "Armed and Dangerous", "Black", "Blinx: The Time Sweeper", "BloodRayne 2", "Breakdown", "Chicken Little", "Disney's Chicken Little", "Conker: Live and Reloaded", "Crimson Skies: High Road to Revenge", "Dead or Alive Ultimate", "Dead or Alive 1 Ultimate", "Dead or Alive 2 Ultimate", "Dead or Alive 3", "Dead to Rights", "Destroy All Humans!", "Full Spectrum Warrior", "Fuzion Frenzy", "Gladius", "Grabbed by the Ghoulies", "Gunvalkyrie", "Hunter: The Reckoning", "Indiana Jones and the Emperor\u2019s Tomb", "Jade Empire", "The King of Fighters Neowave", "Manhunt", "Max Payne", "Max Payne 2: The Fall of Max Payne", "Mercenaries: Playground of Destruction", "MX Unleashed", "Ninja Gaiden Black", "Oddworld: Munch\u2019s Oddysee", "Otogi: Myth of Demons", "Otogi 2: Immortal Warriors", "Panzer Dragoon Orta", "Prince of Persia: The Sands of Time", "Psychonauts", "Red Dead Revolver", "Red Faction II", "Secret Weapons Over Normandy", "Sid Meier\u2019s Pirates!", "Sphinx and the Cursed Mummy", "SSX 3", "Star Wars Battlefront", "Star Wars Battlefront II", "Star Wars Jedi Knight II Jedi Outcast", "Star Wars Jedi Knight Jedi Academy", "Star Wars Jedi Starfighter", "Star Wars Knights of the Old Republic", "Star Wars Knights of the Old Republic II The Sith Lords", "Star Wars Republic Commando", "Star Wars Starfighter Special Edition", "The Elder Scrolls III: Morrowind", "Tom Clancy\u2019s Splinter Cell", "Tom Clancy\u2019s Splinter Cell Pandora Tomorrow", "Tom Clancy\u2019s Splinter Cell Chaos Theory", "Tom Clancy\u2019s Splinter Cell Double Agent", "TimeSplitters 2", "TimeSplitters Future Perfect", "Unreal II The Awakening", "Unreal Championship 2: The Liandri Conflict", "Thrillville", "Tak: The Great Juju Challenge"].map(normalizedTitle));
export function catalogDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2200) return;
  return date.toISOString();
}
export function gamePassAddedDate(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  // Earliest reported entry across plans; this is a Game Pass date, not an
  // invented cloud arrival date or the date this Mac first saw the game.
  return Object.values(value).slice(0, 100).flatMap(v => catalogDate((v as any)?.EntryDateUTC) ?? []).sort()[0];
}
export function catalogPlayModes(value: unknown): CloudPlayMode[] {
  if (!Array.isArray(value)) return [];
  const names = new Set(value.slice(0, 200).flatMap(v => typeof v?.Name === 'string' ? v.Name.toLowerCase() : []));
  const modes: CloudPlayMode[] = [];
  if (names.has('singleplayer')) modes.push('single');
  if (names.has('xblonlinecoop') || names.has('xbllocalcoop')) modes.push('coop');
  if (names.has('xblonlinemultiplayer') || names.has('xblonlinecoop')) modes.push('online');
  if (names.has('xbllocalmultiplayer') || names.has('xbllocalcoop') || names.has('sharedsplitscreen')) modes.push('local');
  return modes;
}
export function editionGenerations(title: string, properties: any): CloudGeneration[] {
  if (!properties || typeof properties !== 'object') return [];
  const family = typeof properties.PackageFamilyName === 'string' ? properties.PackageFamilyName : '';
  if (/^Xbox360BackwardCompatibil[.]/i.test(family)) {
    // Double Agent has separate Xbox and Xbox 360 editions with the same name.
    // Its 360 edition uses this product package; leave the original-only name
    // index out of that ambiguous case until an explicit platform is available.
    if (normalizedTitle(title).includes('splintercelldoubleagent')) return [];
    return [originalXbox.has(normalizedTitle(title)) ? 'xbox' : 'xbox360'];
  }
  const optimized = Array.isArray(properties.XboxConsoleGenOptimized) ? properties.XboxConsoleGenOptimized : [];
  const result: CloudGeneration[] = [];
  if (optimized.includes('ConsoleGen8')) result.push('xboxone');
  if (optimized.includes('ConsoleGen9')) result.push('series');
  if (!result.length && Array.isArray(properties.XboxConsoleGenCompatible)) {
    if (properties.XboxConsoleGenCompatible.includes('ConsoleGen8')) result.push('xboxone');
    else if (properties.XboxConsoleGenCompatible.includes('ConsoleGen9')) result.push('series');
  }
  return result;
}
export function hydrateCloudEditions(games: CloudGame[], response: unknown): void {
  const products = (response as any)?.Products;
  if (!Array.isArray(products)) throw Error('Microsoft returned unreadable console generation data.');
  const byId = new Map(products.slice(0, 100).map((p: any) => [p?.ProductId, p]));
  for (const game of games) {
    const product = byId.get(game.productId); if (!product) continue;
    game.generations = editionGenerations(game.title, product.Properties);
    if (!game.releaseDate) game.releaseDate = catalogDate(product.MarketProperties?.[0]?.OriginalReleaseDate);
  }
}
