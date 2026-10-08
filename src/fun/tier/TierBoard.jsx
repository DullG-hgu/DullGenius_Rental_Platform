// 티어표 공용 표시 — S~D 5행 + 게임 카드. 내 표·커뮤니티·공개 표가 같은 모양을 쓴다
import React from 'react';
import { TIERS } from './tierData';

export const TierCard = ({ game, selected, dragging, insertBefore, onClick, sub, handlers }) => (
    <button type="button"
        className={`tier-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${insertBefore ? ' is-insert-before' : ''}${handlers ? ' is-draggable' : ''}`}
        data-game-id={game.id} onClick={onClick} aria-pressed={selected || undefined} {...handlers}>
        {game.image
            ? <img className="tier-card-img" src={game.image} alt="" loading="lazy" draggable={false} />
            : <span className="tier-card-img is-empty" aria-hidden="true">🔍</span>}
        <span className="tier-card-name">{game.name}</span>
        {sub && <span className="tier-card-sub">{sub}</span>}
    </button>
);

// 끌고 있는 카드 — 손가락 위로 띄워 가려지지 않게
export const TierDragGhost = ({ drag }) => drag && (
    <div className="tier-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
        {drag.game.image
            ? <img src={drag.game.image} alt="" draggable={false} />
            : <span className="tier-card-img is-empty">🔍</span>}
    </div>
);

// rows: { S: [{ game, sub? }], ... }
// extraRow: D 아래 한 줄 더 — 내 표의 「안 해봄」 { key: 'tray', label, items, empty }
const TierBoard = ({ rows, labels, extraRow, selectedId, armed, onRowClick, onCardClick, cardHandlers, drag }) => {
    const defs = TIERS.map((t, i) => ({ key: t, label: labels?.[i] || t, base: labels?.[i] ? t : null, items: rows[t] ?? [] }));
    if (extraRow) defs.push({ ...extraRow, base: null, isExtra: true });

    return (
        <div className="tier-board">
            {defs.map((row) => (
                <div key={row.key} data-tier-drop={cardHandlers ? row.key : undefined}
                    className={`tier-row${row.isExtra ? ' is-extra' : ''}${armed ? ' is-armed' : ''}${drag?.over === row.key ? ' is-over' : ''}`}
                    onClick={armed ? () => onRowClick?.(row.key) : undefined}>
                    <div className={`tier-head tier-${row.key}`}>
                        <span className="tier-head-letter">{row.label}</span>
                        {row.base && <span className="tier-head-base">{row.base}</span>}
                    </div>
                    <div className="tier-row-cards">
                        {row.items.map(({ game, sub }) => (
                            <TierCard key={game.id} game={game} sub={sub} selected={selectedId === game.id}
                                dragging={drag?.game.id === game.id}
                                insertBefore={!row.isExtra && drag?.over === row.key && drag.beforeId === String(game.id)}
                                handlers={cardHandlers?.(game, row.key)}
                                onClick={(e) => { e.stopPropagation(); onCardClick?.(game, row.key); }} />
                        ))}
                        {row.items.length === 0 && row.empty && <span className="tier-drop-hint">{row.empty}</span>}
                        {(armed || drag) && row.items.length > 0 && (
                            <span className={`tier-drop-hint${drag?.over === row.key && !drag.beforeId && !row.isExtra ? ' is-insert-end' : ''}`}>여기에 놓기</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default TierBoard;
