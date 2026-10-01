// 성향검사 계산 (spec_fun_quiz.md §2·§3)
// 채점의 정본은 서버 fun_quiz_score() 다. 여기 scoreAnswers 는 테스트에서 서버·설계 원본과 대조하는 용도이고,
// 화면은 서버가 돌려준 four/eight/code 로 그린다.
import {
    AXES8, CUT, DISPLAY, EASY_MAX, FAMILY_NAME, ITEMS, LINEUP, MOD, NEUTRAL_TEXT, NOUN, POLE_TEXT, STRONG,
} from './quizData';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const scoreAnswers = (answers) => {
    if (answers.length !== ITEMS.length) throw new Error(`응답은 ${ITEMS.length}개여야 합니다.`);
    const eight = AXES8.map((_, k) => {
        const total = sum(ITEMS.map((it) => Math.abs(it.w[k])));
        // 응답이 −2…+2 라 2 × 가중치 총량으로 나눠야 −1~+1 이 된다
        return total === 0 ? 0 : sum(ITEMS.map((it, i) => answers[i] * it.w[k])) / (2 * total);
    });
    const four = DISPLAY.map((d) => sum(d.w.map((x, k) => x * eight[k])) / sum(d.w.map(Math.abs)));
    return { eight, four, code: toCode(four) };
};

// 결과 코드는 항상 네 글자: 0보다 조금이라도 크면 양수 쪽(D·B·V·C), 정가운데(0)이거나 작으면 음수 쪽(L·P·T·S).
// 부동소수 오차로 0이 1e-17 같은 값이 되는 걸 막으려고 EPS 안쪽은 0으로 본다. 서버 fun_quiz_score() 와 같은 규칙.
const EPS = 1e-9;
export const toCode = (four) => four.map((x, i) => (x > EPS ? DISPLAY[i].hi : DISPLAY[i].lo)).join('');

export const familyName = (code) => FAMILY_NAME[code] || `${MOD[code[0] + code[2]]} ${NOUN[code[1] + code[3]]}`;

// 강한 축 순서로 설명 문장 — [{ axis, letter|null, line, compare|null, strength }]
export const axisLines = (four, max = 3) => four
    .map((x, i) => ({ x, i }))
    .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
    .slice(0, max)
    .map(({ x, i }) => {
        if (Math.abs(x) < CUT) return { axis: DISPLAY[i].name, letter: null, line: NEUTRAL_TEXT[i], compare: null };
        const letter = x > 0 ? DISPLAY[i].hi : DISPLAY[i].lo;
        const strength = Math.abs(x) >= STRONG ? '확실히' : '조금 더';
        return {
            axis: DISPLAY[i].name, letter, line: POLE_TEXT[letter].line,
            compare: `${POLE_TEXT[letter].compare} ${strength} 가까워요.`,
        };
    });

// 이번 학기 라인업에서 내 가족 게임 — 입문용 3개 + 익숙해지면 1개 (설계 recommend.family 와 같은 규칙)
export const familyGames = (four) => {
    const strong = four.map((x) => Math.abs(x) >= CUT);
    const sign = four.map((x) => Math.sign(x));
    const dot = (g) => sum(g.d4.map((y, i) => y * four[i]));
    const ok = LINEUP
        .filter((g) => Math.min(...g.d4.map((y, i) => (strong[i] ? sign[i] * y : 0))) > -0.5)
        .sort((a, b) => dot(b) - dot(a) || Number(b.sure) - Number(a.sure));
    const picks = [];
    const seen = new Set();
    for (const g of ok) {
        if (g.easy && !seen.has(g.group) && picks.length < 3) {
            picks.push(g);
            seen.add(g.group);
        }
    }
    const heavy = ok.find((g) => !g.easy && !seen.has(g.group)) || null;
    return { picks, heavy };
};

// 조건부 블록 (spec §3-5): 사람/판은 4축, 몰입은 8축
export const extraBlocks = (four, eight) => {
    const immersion = eight[AXES8.indexOf('몰입')];
    const blocks = [];
    if (four[1] <= -CUT && immersion <= -CUT) blocks.push('murder');
    if (immersion <= -CUT && four[0] >= CUT) blocks.push('trpg');
    return blocks;
};

export { EASY_MAX, ITEMS, DISPLAY };
