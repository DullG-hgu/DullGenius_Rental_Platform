#!/usr/bin/env node
/**
 * 장르 정리 리포트 — 읽기 전용. DB에 아무것도 쓰지 않는다.
 *
 * bgg_id가 있는 게임마다 BGG 카테고리·메커니즘을 Jev에 보내 정규 장르 후보를 받고,
 * 현재 장르(영문 BGG 카테고리 혼입·정규 목록 밖 값)와 나란히 적는다.
 * 적용은 운영자가 관리자 게임 수정 폼(「AI 장르 제안」)에서 게임별로 한다.
 *
 *   node scripts/jev_genre_report.mjs            # 전체
 *   node scripts/jev_genre_report.mjs --limit=10 # 앞 10개만 (시험)
 *
 * 필요 키: .env.local 의 VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BGG_API_TOKEN, JEV_AI_API_KEY
 * 전송 데이터: 게임 한글명과 BGG 공개 정보뿐. 회원 정보는 보내지 않는다.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { GENRE_KEYS, fetchBggThings, scoreGenres, pickSuggestions } = require('../netlify/functions/_shared/jevGenres.js');

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
if (!env.JEV_AI_API_KEY) throw new Error('JEV_AI_API_KEY missing in .env.local — no request sent');
if (!env.BGG_API_TOKEN) throw new Error('BGG_API_TOKEN missing in .env.local');

const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || Infinity;
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: games, error } = await sb.from('games').select('id, name, bgg_id, genres').not('bgg_id', 'is', null).order('id');
if (error) throw error;
const targets = games.slice(0, limit);
console.log(`대상 ${targets.length}개 (bgg_id 있는 게임 ${games.length}개 중)`);

const bgg = {};
for (let i = 0; i < targets.length; i += 20) {
    const ids = targets.slice(i, i + 20).map(g => g.bgg_id);
    Object.assign(bgg, await fetchBggThings(ids, { token: env.BGG_API_TOKEN, timeoutMs: 20000 }));
}

const rows = [];
let inputTokens = 0;
let stopped = null;
const queue = [...targets];
const worker = async () => {
    while (queue.length && !stopped) {
        const game = queue.shift();
        const info = bgg[game.bgg_id];
        if (!info) { rows.push({ game, missing: true }); continue; }
        const result = await scoreGenres({ koreanName: game.name, bgg: info }, { apiKey: env.JEV_AI_API_KEY, timeoutMs: 15000 });
        if (!result.available) {
            // 잔액·키·한도 문제는 계속 보내봐야 같으므로 멈춘다 (재시도 없음).
            if (['unconfigured', 'quota', 'rate_limited'].includes(result.reason)) stopped = result.reason;
            rows.push({ game, failed: result.reason });
            continue;
        }
        inputTokens += result.inputTokens || 0;
        rows.push({ game, bggCategories: info.categories, suggestions: pickSuggestions(result.scores), model: result.model });
        process.stdout.write('.');
    }
};
await Promise.all(Array.from({ length: 4 }, worker));
console.log(stopped ? `\n중단: ${stopped}` : '\n완료');
rows.sort((a, b) => a.game.id - b.game.id);

const canonical = new Set(GENRE_KEYS);
const isEnglish = g => /[A-Za-z]/.test(g);
const date = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dir = 'database/genre_review';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/${date}_report.json`, JSON.stringify({ date, inputTokens, stopped, rows: rows.map(r => ({ ...r, game: { id: r.game.id, name: r.game.name, bgg_id: r.game.bgg_id, genres: r.game.genres } })) }, null, 1) + '\n');

const ok = rows.filter(r => r.suggestions);
const englishGames = ok.filter(r => (r.game.genres || []).some(isEnglish));
const lines = [
    `# 장르 정리 리포트 (${date})`,
    '',
    '읽기 전용 산출물. 적용은 관리자 게임 수정 폼의 「🤖 AI 장르 제안」에서 게임별로 운영자가 고른다.',
    'AI 후보(0.5 이상, 최대 4개)는 참고용이다. 2026-09-27 실측에서 테마를 장르로 착각하는 오답이 있었다.',
    '',
    `- 대상 ${rows.length}개 · 제안 성공 ${ok.length} · BGG 없음 ${rows.filter(r => r.missing).length} · 실패 ${rows.filter(r => r.failed).length}${stopped ? ` (중단: ${stopped})` : ''}`,
    `- 영문 장르가 섞인 게임 ${englishGames.length}개 · 입력 토큰 ${inputTokens.toLocaleString()}`,
    `- 정규 장르: ${GENRE_KEYS.join(', ')}`,
    '',
    '## 1. 영문 장르가 섞인 게임 (우선 정리)',
    '',
    '| id | 게임 | 현재 장르 | AI 후보 |',
    '|---|---|---|---|',
    ...englishGames.map(r => `| ${r.game.id} | ${r.game.name} | ${(r.game.genres || []).join(', ')} | ${r.suggestions.map(s => `${s.genre} ${Math.round(s.p * 100)}`).join(', ')} |`),
    '',
    '## 2. 전체',
    '',
    '「정규 밖」은 정규 목록에 없는 현재 장르(영문 포함). 「새 후보」는 현재 장르에 없는 AI 후보.',
    '',
    '| id | 게임 | 현재 장르 | 정규 밖 | AI 후보 | 새 후보 |',
    '|---|---|---|---|---|---|',
    ...rows.map(r => {
        const current = r.game.genres || [];
        if (!r.suggestions) return `| ${r.game.id} | ${r.game.name} | ${current.join(', ')} | | ${r.missing ? 'BGG 항목 없음' : `실패(${r.failed})`} | |`;
        const outside = current.filter(g => !canonical.has(g));
        const fresh = r.suggestions.filter(s => !current.includes(s.genre)).map(s => s.genre);
        return `| ${r.game.id} | ${r.game.name} | ${current.join(', ')} | ${outside.join(', ')} | ${r.suggestions.map(s => `${s.genre} ${Math.round(s.p * 100)}`).join(', ')} | ${fresh.join(', ')} |`;
    }),
    '',
];
fs.writeFileSync(`${dir}/${date}_report.md`, lines.join('\n'));
console.log(`리포트: ${dir}/${date}_report.md · 입력 토큰 ${inputTokens}`);
