// 골라 지우기 진행 상태 (2026-10-12) — 놀이터(/play/pick)용. 추첨 규칙은 roulette.js 의 drawCards 한 곳.
// 키오스크에 있던 같은 기능(PickEliminateModal)은 2026-10-26 제거 — 이제 이 훅만 쓴다.
import { useMemo, useState } from 'react';
import { PICK_COUNT, SPLIT_MODE, drawCards, hasNumplayersData } from './roulette';

const sameId = (a, b) => String(a) === String(b);

/**
 * @param games 전체 게임 목록 (status 가 '대여가능' 인 것만 후보)
 * @returns 인원(mode) 선택·카드·지우기·되돌리기·처음으로·다시 뽑기와 결정 여부
 */
export default function usePickEliminate(games, { count = PICK_COUNT, rng } = {}) {
    const [mode, setMode] = useState(null); // null = 인원 고르는 중 | 3~8 | SPLIT_MODE
    const [cards, setCards] = useState([]);
    const [removed, setRemoved] = useState([]); // 지운 순서 (되돌리기용)

    const available = useMemo(() => (games || []).filter((g) => g.status === '대여가능'), [games]);
    const useNumplayers = hasNumplayersData(games || []);
    const target = mode === SPLIT_MODE ? 2 : 1;

    const deal = (nextMode, avoid = []) => {
        setCards(drawCards(available, nextMode, { count, avoid, useNumplayers, rng }));
        setRemoved([]);
    };

    const remaining = cards.filter((c) => !removed.some((id) => sameId(id, c.id)));
    // 처음부터 목표 장수 이하로만 깔렸으면(후보 부족) 지울 것 없이 바로 결과
    const tooFew = cards.length > 0 && cards.length <= target;
    const decided = tooFew || (cards.length > target && remaining.length <= target);

    return {
        mode,
        cards,
        remaining,
        removed,
        target,
        decided,
        tooFew,
        start: (nextMode) => { setMode(nextMode); deal(nextMode); },
        backToChoose: () => { setMode(null); setCards([]); setRemoved([]); },
        remove: (id) => {
            if (decided || removed.some((x) => sameId(x, id))) return;
            setRemoved((prev) => [...prev, id]);
        },
        undo: () => setRemoved((prev) => prev.slice(0, -1)),
        reset: () => setRemoved([]),
        redraw: () => deal(mode, cards),
        /** 깐 뒤 다른 곳에서 대여돼 지금은 못 빌리는 카드 */
        isGone: (card) => !available.some((g) => sameId(g.id, card.id)),
    };
}
