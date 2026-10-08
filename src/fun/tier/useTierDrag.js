// 티어표 드래그 — 라이브러리 없이 포인터 이벤트로.
// 마우스: 5px 움직이면 바로 드래그. 터치: 꾹 누르기(250ms) 뒤 드래그 — 그 전에 움직이면 스크롤로 양보(트레이 가로 스크롤 유지)
// 놓을 곳은 data-tier-drop="S|A|B|C|D|tray" 를 단 요소, 자리 계산은 그 안의 data-game-id 카드
import { useCallback, useEffect, useRef, useState } from 'react';

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 250;
const EDGE = 70; // 화면 위·아래 이 안쪽으로 끌면 자동 스크롤

// 포인터 아래의 줄과, 그 줄에서 끼워 넣을 자리(끌고 있는 카드 제외한 순번)
const dropTargetAt = (x, y, dragId) => {
    const rowEl = document.elementFromPoint(x, y)?.closest('[data-tier-drop]');
    if (!rowEl) return { over: null, index: null };
    const cards = [...rowEl.querySelectorAll('[data-game-id]')].filter((c) => c.dataset.gameId !== String(dragId));
    let index = cards.length;
    for (let i = 0; i < cards.length; i += 1) {
        const r = cards[i].getBoundingClientRect();
        // 줄바꿈된 아랫줄 카드이거나, 같은 높이에서 카드 가운데보다 왼쪽이면 그 앞
        if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) { index = i; break; }
    }
    return { over: rowEl.dataset.tierDrop, index, beforeId: cards[index]?.dataset.gameId ?? null };
};

export default function useTierDrag({ onDrop, bottomInset = 0 }) {
    const [drag, setDrag] = useState(null); // { game, from, x, y, over }
    const pending = useRef(null);
    const dragRef = useRef(null);
    const suppressClick = useRef(false);
    const scrollRaf = useRef(null);
    const activePointer = useRef(null); // 첫 손가락만 따라간다

    dragRef.current = drag;

    const stopAutoScroll = () => {
        if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = null;
    };

    const autoScroll = useCallback(() => {
        const d = dragRef.current;
        if (!d) { stopAutoScroll(); return; }
        const bottomEdge = window.innerHeight - bottomInset - EDGE;
        let dy = 0;
        if (d.y < EDGE) dy = -Math.ceil((EDGE - d.y) / 6);
        else if (d.y > bottomEdge && d.over !== 'tray') dy = Math.ceil((d.y - bottomEdge) / 6);
        if (dy) {
            window.scrollBy(0, dy);
            setDrag((cur) => (cur ? { ...cur, ...dropTargetAt(cur.x, cur.y, cur.game.id) } : cur));
        }
        scrollRaf.current = requestAnimationFrame(autoScroll);
    }, [bottomInset]);

    const begin = useCallback((p, x, y) => {
        pending.current = null;
        suppressClick.current = true;
        navigator.vibrate?.(10);
        setDrag({ game: p.game, from: p.from, x, y, ...dropTargetAt(x, y, p.game.id) });
        stopAutoScroll();
        scrollRaf.current = requestAnimationFrame(autoScroll);
    }, [autoScroll]);

    useEffect(() => {
        const onMove = (e) => {
            if (activePointer.current != null && e.pointerId !== activePointer.current) return;
            const p = pending.current;
            if (p) {
                const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
                if (p.touch) {
                    if (dist > TOUCH_SLOP) { clearTimeout(p.timer); pending.current = null; }
                } else if (dist > MOUSE_SLOP) {
                    begin(p, e.clientX, e.clientY);
                }
                return;
            }
            if (!dragRef.current) return;
            setDrag((cur) => (cur ? { ...cur, x: e.clientX, y: e.clientY, ...dropTargetAt(e.clientX, e.clientY, cur.game.id) } : cur));
        };
        const finish = (e, cancelled) => {
            if (e && activePointer.current != null && e.pointerId !== activePointer.current) return;
            activePointer.current = null;
            if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
            const d = dragRef.current;
            if (!d) return;
            stopAutoScroll();
            setDrag(null);
            const { over, index } = cancelled || !e ? {} : dropTargetAt(e.clientX, e.clientY, d.game.id);
            // 같은 줄 안 이동도 받는다 (순서 바꾸기). 「안 해봄」 안에서는 순서가 없으니 무시
            if (over && !(over === 'tray' && d.from === 'tray')) onDrop(d.game, over === 'tray' ? null : over, index);
            // 드래그 뒤 따라오는 click 한 번 무시
            setTimeout(() => { suppressClick.current = false; }, 0);
        };
        const onUp = (e) => finish(e, false);
        const onCancel = (e) => finish(e, true);
        const onBlur = () => finish(null, true); // 창 밖에서 버튼을 떼는 등 놓기 신호를 못 받을 때
        // 드래그 중엔 터치 스크롤을 막는다 (꾹 누른 뒤라 스크롤이 아직 시작 안 됨)
        const onTouchMove = (e) => { if (dragRef.current) e.preventDefault(); };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('blur', onBlur);
            if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            document.removeEventListener('touchmove', onTouchMove);
            stopAutoScroll();
        };
    }, [begin, onDrop]);

    const cardHandlers = useCallback((game, from) => ({
        onPointerDown: (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (activePointer.current != null) return; // 이미 다른 손가락이 잡고 있음
            activePointer.current = e.pointerId;
            // 마우스는 캡처 — 창 밖으로 나가도 놓기(pointerup)를 받는다
            if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId);
            const touch = e.pointerType !== 'mouse';
            const p = { game, from, x0: e.clientX, y0: e.clientY, touch };
            if (touch) p.timer = setTimeout(() => { if (pending.current === p) begin(p, p.x0, p.y0); }, LONG_PRESS_MS);
            pending.current = p;
        },
        onContextMenu: (e) => e.preventDefault(),
        onDragStart: (e) => e.preventDefault(),
    }), [begin]);

    const shouldIgnoreClick = () => suppressClick.current;

    return { drag, cardHandlers, shouldIgnoreClick };
}
