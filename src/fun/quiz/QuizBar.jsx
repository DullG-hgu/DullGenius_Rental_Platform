// 성향 막대 — 양 끝 이름 + 가운데 기준선 + 위치 점 (점수 −1~+1). other 를 주면 비교용 두 번째 점(테두리만)을 그린다.
import React from 'react';

const pos = (v) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;

const QuizBar = ({ lo, hi, name, value, other = null }) => (
    <li>
        <span className="quiz-bar-end">{lo}</span>
        <span className="quiz-bar" role="img"
            aria-label={`${name}: ${lo} ↔ ${hi}, ${value.toFixed(2)}${other == null ? '' : ` (비교 ${other.toFixed(2)})`}`}>
            <span className="quiz-bar-mid" />
            {other != null && <span className="quiz-bar-dot is-other" style={{ left: pos(other) }} />}
            <span className="quiz-bar-dot" style={{ left: pos(value) }} />
        </span>
        <span className="quiz-bar-end">{hi}</span>
        <span className="quiz-bar-name">{name}</span>
    </li>
);

export default QuizBar;
