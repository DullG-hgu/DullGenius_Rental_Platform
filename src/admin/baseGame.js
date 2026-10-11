// 확장판 → 본판 연결 (games.base_game_id, NULL = 본판/단독 게임)
// 연결된 확장판은 월드컵 후보·랭킹에서 빠진다. 2026-10-11 전에는 SQL로만 채웠다.
// 한 단계만 둔다: 본판 후보는 base_game_id 가 없는 게임, 확장판이 딸린 게임은 확장판이 될 수 없다.

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** 이 게임에 연결된 확장판들 */
export const expansionsOf = (games, gameId) =>
  gameId == null ? [] : games.filter((g) => sameId(g.base_game_id, gameId));

/** 본판으로 고를 수 있는 게임: 자기 자신·다른 확장판 제외 */
export const baseGameCandidates = (games, selfId) =>
  games.filter((g) => g.base_game_id == null && !sameId(g.id, selfId));

/** 이름만으로 확장판 같아 보이는지 (BGG 연결이 없을 때의 힌트) */
export const looksLikeExpansion = (name) => /확장|expansion|:/i.test(name || '');

// 본판 이름 바로 뒤가 확장판 표시로 이어지는지.
// 공백만으로는 부족하다 — 「The」가 「The Resistance: Avalon」의, 「Go」가 「Golem」의 본판으로 잡히면 안 된다.
// 인정: 「:」「-」「(」 같은 부제 구분자, 또는 (띄어 쓰든 붙여 쓰든) 「확장」「expansion」
const isBoundary = (rest) => /^\s*[:\-–—(（[「『]/.test(rest) || /^\s*(확장|expansion)/i.test(rest);

/**
 * 이름이 다른 게임 이름 + 경계로 시작하면 그 게임을 본판 후보로 (가장 긴 이름 우선).
 * 「카탄: 항해사」 → 「카탄」. 이름이 같은 게임, 카테고리가 다른 게임은 후보가 아니다.
 */
export const suggestBaseGame = (games, { id, name, category } = {}) => {
  const me = (name || '').trim().toLowerCase();
  let best = null;
  for (const g of baseGameCandidates(games, id)) {
    if (category && g.category && g.category !== category) continue;
    const n = (g.name || '').trim().toLowerCase();
    if (n.length < 2 || n.length >= me.length || !me.startsWith(n)) continue;
    const rest = me.slice(n.length);
    if (!isBoundary(rest) || !rest.replace(/[\s:·\-–—_()[\]「」『』<>《》'"!?.,/]/g, '')) continue;
    if (!best || n.length > best.name.trim().length) best = g;
  }
  return best;
};
