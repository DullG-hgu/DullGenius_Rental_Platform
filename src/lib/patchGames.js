// Realtime 변경 신호로 목록 전체 대신 바뀐 게임만 다시 읽어 끼워 넣을 때 쓰는 공용 판단 (2026-10-11)
// 홈(GameDataContext)과 키오스크(useKioskData)가 같이 쓴다.

// 한 번에 이보다 많이 바뀌면(크론 일괄 재계산 등) 건별 조회를 동시에 여럿 보내기보다 전체 목록 한 번으로
export const MAX_PATCH_IDS = 3;

const sameId = (a, b) => String(a) === String(b);

/** 건별로 끼워 넣을 수 있는 변경인지. id 를 모르거나, 목록에 없는 게임(새 게임)이거나, 너무 많으면 false */
export const canPatchGames = (ids, games) =>
    Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_PATCH_IDS &&
    ids.every((id) => games.some((g) => sameId(g.id, id)));

/** 목록 순서는 그대로 두고 바뀐 게임 객체만 바꿔 끼운다 */
export const mergePatchedGames = (games, patched) =>
    games.map((g) => patched.find((p) => sameId(p.id, g.id)) ?? g);
