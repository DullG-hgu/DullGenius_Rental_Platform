#!/usr/bin/env node
/**
 * BGG 값 동기화 — bgg_id 가 있는 게임의 인원·시간·난이도를 BGG 기준으로 맞춘다.
 *
 *   node scripts/bgg_sync.mjs            # dry-run: 변경 예정만 출력
 *   node scripts/bgg_sync.mjs --apply    # 실제 적용 (적용 전 database/bgg_sync/<날짜>_before.json 과 롤백 SQL 저장)
 *   node scripts/bgg_sync.mjs --only=numplayers [--apply]   # 추천 인원 3개 컬럼만 (다른 컬럼은 건드리지 않음)
 *
 * 규칙 (2026-09-10 확정):
 *  - bgg_id 항목 type 이 boardgame/boardgameexpansion 이 아니면 건드리지 않고 보고만 한다 (오연결 방지)
 *  - BGG 값 0 은 "미기재" → 기존 값 유지
 *  - playingtime 은 "30분" / "60~120분" 형식. 최소가 5분 미만이면 최대만 쓴다
 *  - difficulty 는 BGG 투표 5명 이상일 때만 갱신. 투표 부족인데 기존 값이 0 이면 NULL 로 (가짜 0 제거)
 *  - genres 는 운영자가 한글로 손질한 값을 덮어쓰지 않는다. 비어 있을 때만 GENRE_MAP 번역으로 채움
 *  - 추천 인원 (2026-10-11, 키오스크 룰렛): suggested_numplayers 투표로 best_players·recommended_players·numplayers_votes.
 *    인원 N 칸 (Best/Rec/Not): Best 가 Rec·Not 보다 많으면 best, 아니고 Best+Rec > Not 이면 recommended.
 *    'K+' 칸(BGG 최대 인원 초과)은 저장하지 않는다. 투표 0 이면 세 컬럼 모두 NULL (데이터 없음)
 *    근거: database/bgg_sync/2026-10-11_numplayers_report.md
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { GENRE_MAP } from '../src/constants/genreMap.js';
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length) || null;
if (ONLY && ONLY !== 'numplayers') throw new Error(`--only 는 numplayers 만 지원: ${ONLY}`);
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// 앱 식별 UA (bgg-proxy 와 같은 값). 브라우저 UA 로 위장하면 Cloudflare 가 403
const H = { Authorization: `Bearer ${env.BGG_API_TOKEN}`, 'User-Agent': 'dullgrental/1.0 (+https://dullgrental.netlify.app)', Accept: 'application/xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { data: games, error } = await sb.from('games').select('id,name,bgg_id,difficulty,min_players,max_players,min_playtime,max_playtime,playingtime,genres,best_players,recommended_players,numplayers_votes').not('bgg_id', 'is', null).neq('bgg_id', '').order('id');
if (error) throw error;

// 추천 인원 투표 → { best, rec, votes }. 투표가 없으면 전부 null
const numplayers = inner => {
  const poll = (inner.match(/<poll name="suggested_numplayers"[\s\S]*?<\/poll>/) || [])[0];
  const votes = poll ? +((poll.match(/totalvotes="(\d+)"/) || [])[1] || 0) : 0;
  if (!votes) return { best: null, rec: null, votes: null };
  const best = [], rec = [];
  for (const m of poll.matchAll(/<results numplayers="(\d+)">([\s\S]*?)<\/results>/g)) {
    const v = {}; for (const r of m[2].matchAll(/<result value="([^"]+)" numvotes="(\d+)"/g)) v[r[1]] = +r[2];
    const b = v['Best'] || 0, c = v['Recommended'] || 0, n = v['Not Recommended'] || 0;
    if (b > c && b > n) best.push(+m[1]); else if (b + c > n) rec.push(+m[1]);
  }
  return { best, rec, votes };
};
const sameArr = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ids = [...new Set(games.map(g => g.bgg_id))];
const bgg = {};
for (let i = 0; i < ids.length; i += 20) {
  const b = ids.slice(i, i + 20); process.stderr.write(`BGG ${i + 1}-${i + b.length}/${ids.length}\n`);
  let xml;
  for (let a = 0; a < 6; a++) { const r = await fetch(`https://boardgamegeek.com/xmlapi2/thing?id=${b.join(',')}&stats=1`, { headers: H }); if (r.status === 202 || r.status === 429) { await sleep(4000 * (a + 1)); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); xml = await r.text(); break; }
  const re = /<item[^>]*type="([^"]+)"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml))) {
    const inner = m[3]; const g = rx => { const x = inner.match(rx); return x ? x[1] : null; };
    const all = rx => { const o = []; let y; while ((y = rx.exec(inner))) o.push(y[1].replace(/&#039;/g, "'").replace(/&amp;/g, '&')); return o; };
    bgg[m[2]] = { type: m[1], name: (g(/<name[^>]*type="primary"[^>]*value="([^"]+)"/) || '').replace(/&#039;/g, "'").replace(/&amp;/g, '&'), minP: +g(/<minplayers[^>]*value="(\d+)"/), maxP: +g(/<maxplayers[^>]*value="(\d+)"/), minT: +g(/<minplaytime[^>]*value="(\d+)"/), maxT: +g(/<maxplaytime[^>]*value="(\d+)"/), weight: +(+g(/<averageweight[^>]*value="([^"]+)"/)).toFixed(2), votes: +g(/<numweights[^>]*value="(\d+)"/), genres: all(/<link[^>]*type="boardgamecategory"[^>]*value="([^"]+)"/g), np: numplayers(inner) };
  }
  await sleep(2500);
}
const fmt = (a, b) => { if (a && a < 5 && b >= 5) a = 0; return !a && !b ? null : (!b || a === b) ? `${a || b}분` : `${a}~${b}분`; };
const tr = g => GENRE_MAP[g] || g;
const updates = []; const problems = [];
for (const g of games) {
  const b = bgg[g.bgg_id];
  if (!b) { problems.push(`${g.id} ${g.name}: BGG ${g.bgg_id} 없음`); continue; }
  if (!['boardgame', 'boardgameexpansion'].includes(b.type)) { problems.push(`${g.id} ${g.name}: BGG ${g.bgg_id} type=${b.type} (${b.name}) → 제외`); continue; }
  const set = {};
  if (!sameArr(b.np.best, g.best_players)) set.best_players = b.np.best;
  if (!sameArr(b.np.rec, g.recommended_players)) set.recommended_players = b.np.rec;
  if (b.np.votes !== g.numplayers_votes) set.numplayers_votes = b.np.votes;
  if (ONLY === 'numplayers') { if (Object.keys(set).length) updates.push({ id: g.id, name: g.name, bggName: b.name, set }); continue; }
  if (b.minP > 0 && b.minP !== g.min_players) set.min_players = b.minP;
  if (b.maxP > 0 && b.maxP !== g.max_players) set.max_players = b.maxP;
  if (b.minT > 0 && b.minT !== g.min_playtime) set.min_playtime = b.minT;
  if (b.maxT > 0 && b.maxT !== g.max_playtime) set.max_playtime = b.maxT;
  const pt = fmt(b.minT, b.maxT); if (pt && pt !== g.playingtime) set.playingtime = pt;
  if (b.votes >= 5 && b.weight > 0) { if (+g.difficulty !== b.weight) set.difficulty = b.weight; }
  else if (g.difficulty !== null && +g.difficulty === 0) set.difficulty = null;
  if ((!g.genres || g.genres.length === 0) && b.genres.length) set.genres = b.genres.map(tr);
  if (Object.keys(set).length) updates.push({ id: g.id, name: g.name, bggName: b.name, set });
}
for (const u of updates) console.log(`${u.id} ${u.name} (${u.bggName}): ${Object.entries(u.set).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);
for (const p of problems) console.log(`⚠️  ${p}`);
console.log(`\n대상 ${games.length}, 변경 ${updates.length}, 문제 ${problems.length}`);
if (!APPLY) { console.log('dry-run — --apply 를 붙이면 적용'); process.exit(0); }
const day = new Date().toISOString().slice(0, 10);
fs.mkdirSync('database/bgg_sync', { recursive: true });
const tag = ONLY ? `_${ONLY}` : '';
fs.writeFileSync(path.join('database/bgg_sync', `${day}${tag}_before.json`), JSON.stringify(games, null, 1));
const q = v => v == null ? 'NULL' : Array.isArray(v) ? `ARRAY[${v.map(x => `'${x.replace(/'/g, "''")}'`).join(',')}]::text[]` : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`;
const qi = v => v == null ? 'NULL' : `ARRAY[${v.join(',')}]::int[]`;
const npSql = g => `best_players=${qi(g.best_players)}, recommended_players=${qi(g.recommended_players)}, numplayers_votes=${g.numplayers_votes ?? 'NULL'}`;
const rollbackSet = g => ONLY === 'numplayers' ? npSql(g)
  : `difficulty=${q(g.difficulty)}, min_players=${q(g.min_players)}, max_players=${q(g.max_players)}, min_playtime=${q(g.min_playtime)}, max_playtime=${q(g.max_playtime)}, playingtime=${q(g.playingtime)}, genres=${q(g.genres)}, ${npSql(g)}`;
fs.writeFileSync(path.join('database/bgg_sync', `${day}${tag}_rollback.sql`), ['BEGIN;', ...games.map(g => `UPDATE games SET ${rollbackSet(g)} WHERE id=${g.id};`), 'COMMIT;'].join('\n'));
let ok = 0, fail = 0;
// 운영 Nano 부하를 피해 10건씩 끊고 쉰다. 실패가 나오면 멈춘다 (원인 확인 전 재시도 금지)
for (let i = 0; i < updates.length; i++) {
  const u = updates[i];
  const { error } = await sb.from('games').update(u.set).eq('id', u.id);
  if (error) { fail++; console.error(`FAIL ${u.id}: ${error.message} — 중단`); break; }
  ok++;
  if ((i + 1) % 10 === 0) { process.stderr.write(`적용 ${i + 1}/${updates.length}\n`); await sleep(3000); }
}
console.log(`적용 완료 ok=${ok} fail=${fail} / ${updates.length} (롤백: database/bgg_sync/${day}${tag}_rollback.sql)`);
