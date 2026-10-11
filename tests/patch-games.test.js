import { describe, expect, it } from 'vitest';
import { canPatchGames, mergePatchedGames, MAX_PATCH_IDS } from '../src/lib/patchGames';

const games = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];

describe('patchGames', () => {
  it('patches only known ids within the limit (ids may be strings)', () => {
    expect(canPatchGames([1, '2'], games)).toBe(true);
    expect(canPatchGames(null, games)).toBe(false);
    expect(canPatchGames([], games)).toBe(false);
    expect(canPatchGames([9], games)).toBe(false);
    expect(canPatchGames(Array.from({ length: MAX_PATCH_IDS + 1 }, () => 1), games)).toBe(false);
  });
  it('replaces changed games in place and keeps order', () => {
    const merged = mergePatchedGames(games, [{ id: '3', name: 'C2' }]);
    expect(merged.map(g => g.name)).toEqual(['A', 'B', 'C2']);
    expect(merged[0]).toBe(games[0]);
  });
});
