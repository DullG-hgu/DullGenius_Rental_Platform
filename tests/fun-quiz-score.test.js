// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { scoreAnswers, familyGames, familyName, axisLines, extraBlocks, toCode } from '../src/fun/quiz/quizLogic';
import { ITEMS } from '../src/fun/quiz/quizData';

// 설계 원본(boardgame/mbti/design, Python) 계산 결과 — export_web.py 가 만든다
const cases = JSON.parse(readFileSync(new URL('./fixtures/fun-quiz-cases.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../database/20261001_fun_quiz.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../database/20261001_fun_quiz_score_scale.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../database/20261001_fun_quiz_public_badges.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../database/20261001_fun_quiz_code_four_letters.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../database/20261001_fun_quiz_delete.sql', import.meta.url), 'utf8');

const close = (a, b) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(1e-3));

describe('성향검사 채점 — 설계 원본과 같은가', () => {
    it.each(cases.map((c, i) => [i, c]))('사례 %i', (_, c) => {
        const s = scoreAnswers(c.answers);
        close(s.eight, c.eight);
        close(s.four, c.four);
        expect(s.code).toBe(c.code);
        const { picks, heavy } = familyGames(s.four);
        expect(picks.map((g) => g.name)).toEqual(c.picks);
        expect(heavy?.name ?? null).toBe(c.heavy);
    });

    it('점수는 −1~+1 범위이고, 한쪽 끝까지 몰면 정확히 ±1 이 된다', () => {
        for (const c of cases) {
            const s = scoreAnswers(c.answers);
            [...s.eight, ...s.four].forEach((x) => expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9));
        }
        // 사람/판 축(정보·상호작용)을 끝까지 B 쪽으로: 그 축 문항만 가중치 부호대로 ±2
        const allB = ITEMS.map((it) => Math.sign(it.w[1] + it.w[2]) * 2);
        expect(scoreAnswers(allB).four[1]).toBeCloseTo(1, 6);
    });

    it('이름·문장·조건 블록', () => {
        expect(familyName('DBVS')).toBe('효율을 쫓는 설계자');
        expect(familyName('····')).toBe('뭐든 즐기는 보드게이머');
        expect(toCode([0, 0, 0, 0])).toBe('LPTS');
        expect(toCode([0.01, -0.01, 1e-17, 0.3])).toBe('DPTC');
        const lines = axisLines([0.9, -0.3, 0.1, 0]);
        expect(lines[0].letter).toBe('D');
        expect(lines[0].compare).toContain('확실히');
        expect(lines[1].compare).toContain('조금 더');
        expect(lines[2].letter).toBeNull();
        expect(extraBlocks([0.5, -0.5, 0, 0], [0, 0, 0, 0, 0, 0, -0.5, 0])).toEqual(['murder', 'trpg']);
    });
});

describe('성향검사 DB (PGlite)', () => {
    let db;
    const me = '00000000-0000-0000-0000-000000000001';
    const other = '00000000-0000-0000-0000-000000000002';
    const admin = '00000000-0000-0000-0000-000000000003';
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
    const as = (uid) => db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    const submit = (answers, consent = true) =>
        one('SELECT fun_quiz_submit($1::smallint[], $2, $3) AS r', [answers, consent, 'test']).then((x) => x.r);

    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
            $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            CREATE TABLE public.user_roles (user_id uuid, role_key text);
            CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
            $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_key IN ('admin','executive')) $$;
            GRANT USAGE ON SCHEMA auth TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
        await db.exec(migration);
        await db.exec(migration); // 다시 실행해도 깨지지 않아야 한다
        await db.exec(`INSERT INTO public.user_roles VALUES ('${admin}', 'admin');`);
    }, 30000);

    beforeEach(async () => { await db.exec('RESET ROLE; TRUNCATE public.fun_quiz_responses, public.fun_quiz_public;'); });
    afterAll(async () => { await db?.close(); });

    it('서버 채점이 설계 원본과 같다', async () => {
        for (const c of cases) {
            const { r } = await one('SELECT fun_quiz_score($1::smallint[]) AS r', [c.answers]);
            close(r.eight, c.eight);
            close(r.four, c.four);
            expect(r.code).toBe(c.code);
        }
    });

    it('잘못된 응답은 거부한다', async () => {
        await expect(one('SELECT fun_quiz_score($1::smallint[])', [[0, 0]])).rejects.toThrow('19개');
        await expect(one('SELECT fun_quiz_score($1::smallint[])', [[...Array(18).fill(0), 3]])).rejects.toThrow('-2에서 2');
    });

    it('회원만, 동의해야 제출되고 서버 결과가 저장된다', async () => {
        await db.exec('RESET ROLE; SET ROLE anon;');
        await expect(submit(cases[3].answers)).rejects.toThrow();
        await as(me);
        await expect(submit(cases[3].answers, false)).rejects.toThrow('동의');
        const r = await submit(cases[3].answers);
        expect(r.code).toBe(cases[3].code);
        expect(r.previous).toBeNull();
        await expect(submit(cases[4].answers)).rejects.toThrow('잠시 후');
    });

    it('직접 채점 함수·테이블은 회원이 못 쓴다', async () => {
        await as(me);
        await expect(one('SELECT fun_quiz_score($1::smallint[])', [cases[0].answers])).rejects.toThrow();
        await expect(one('SELECT * FROM public.fun_quiz_responses')).rejects.toThrow();
    });

    it('결과는 본인만 보고, 직전 결과가 함께 온다', async () => {
        await as(me);
        const first = await submit(cases[3].answers);
        await db.exec(`RESET ROLE; UPDATE public.fun_quiz_responses SET created_at = now() - interval '1 day';`);
        await as(me);
        const second = await submit(cases[5].answers);
        expect(second.previous.code).toBe(first.code);
        expect((await one('SELECT fun_quiz_get_result($1) AS r', [first.id])).r.id).toBe(first.id);
        expect((await one('SELECT fun_quiz_my_results() AS r')).r).toHaveLength(2);
        await as(other);
        expect((await one('SELECT fun_quiz_get_result($1) AS r', [first.id])).r).toBeNull();
        expect((await one('SELECT fun_quiz_my_results() AS r')).r).toEqual([]);
    });

    it('리뷰 배지: 기본 비공개, 켠 회원의 최신 코드만, 비회원도 조회', async () => {
        await as(me);
        await submit(cases[3].answers);
        await db.exec(`RESET ROLE; UPDATE public.fun_quiz_responses SET created_at = now() - interval '1 day';`);
        await as(me);
        const latest = await submit(cases[5].answers);
        await as(other);
        await submit(cases[6].answers);
        const badges = async () => (await one('SELECT fun_quiz_public_badges($1::uuid[]) AS r', [[me, other]])).r;

        await db.exec('RESET ROLE; SET ROLE anon;');
        expect(await badges()).toEqual({});
        await expect(one('SELECT fun_quiz_set_public(true)')).rejects.toThrow();

        await as(me);
        expect((await one('SELECT fun_quiz_my_public() AS r')).r.is_public).toBe(false);
        expect((await one('SELECT fun_quiz_set_public(true) AS r')).r).toBe(true);
        const mine = (await one('SELECT fun_quiz_my_public() AS r')).r;
        expect(mine.is_public).toBe(true);
        expect(mine.latest.code).toBe(latest.code);

        await db.exec('RESET ROLE; SET ROLE anon;');
        const b = await badges();
        expect(Object.keys(b)).toEqual([me]);
        expect(b[me].code).toBe(latest.code);
        expect(b[me].answers).toBeUndefined();
        expect(b[me].eight).toBeUndefined();

        await as(me);
        await one('SELECT fun_quiz_set_public(false)');
        expect(await badges()).toEqual({});
        await expect(one('SELECT fun_quiz_public_badges($1::uuid[])', [Array(101).fill(me)])).rejects.toThrow('100명');
        await expect(one('SELECT * FROM public.fun_quiz_public')).rejects.toThrow();
    });

    it('본인 결과만 지울 수 있고, 지우면 배지는 그다음 최신 결과로 바뀐다', async () => {
        await as(me);
        const older = await submit(cases[3].answers);
        await db.exec(`RESET ROLE; UPDATE public.fun_quiz_responses SET created_at = now() - interval '1 day';`);
        await as(me);
        const newer = await submit(cases[5].answers);
        await one('SELECT fun_quiz_set_public(true)');
        const badge = async () => (await one('SELECT fun_quiz_public_badges($1::uuid[]) AS r', [[me]])).r[me];

        await as(other);
        expect((await one('SELECT fun_quiz_delete_result($1) AS r', [newer.id])).r).toBe(false);
        expect((await one('SELECT fun_quiz_delete_all_mine() AS r')).r).toBe(0);
        await db.exec('RESET ROLE; SET ROLE anon;');
        await expect(one('SELECT fun_quiz_delete_result($1)', [newer.id])).rejects.toThrow();

        await as(me);
        expect((await badge()).code).toBe(newer.code);
        expect((await one('SELECT fun_quiz_delete_result($1) AS r', [newer.id])).r).toBe(true);
        expect((await badge()).code).toBe(older.code);
        expect((await one('SELECT fun_quiz_my_results() AS r')).r).toHaveLength(1);

        expect((await one('SELECT fun_quiz_delete_all_mine() AS r')).r).toBe(1);
        expect(await badge()).toBeUndefined();
        expect((await one('SELECT fun_quiz_my_public() AS r')).r).toEqual({ is_public: false, latest: null });
    });

    it('통계는 운영진만, 회원별 최신 1건 기준', async () => {
        await as(me);
        await submit(cases[3].answers);
        await db.exec(`RESET ROLE; UPDATE public.fun_quiz_responses SET created_at = now() - interval '1 day';`);
        await as(me);
        await submit(cases[5].answers);
        await as(other);
        await submit(cases[5].answers);
        await expect(one('SELECT fun_quiz_admin_stats() AS r')).rejects.toThrow('관리자');
        await as(admin);
        const { r } = await one('SELECT fun_quiz_admin_stats() AS r');
        expect(r.responses).toBe(3);
        expect(r.members).toBe(2);
        expect(r.by_code[cases[5].code]).toBe(2);
        expect(r.four_avg).toHaveLength(4);
    });
});
