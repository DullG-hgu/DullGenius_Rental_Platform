#!/usr/bin/env node
/**
 * BGG 값 동기화 — bgg_id 가 있는 게임의 인원·시간·난이도를 BGG 기준으로 맞춘다.
 *
 *   node scripts/bgg_sync.mjs            # dry-run: 변경 예정만 출력
 *   node scripts/bgg_sync.mjs --apply    # 실제 적용 (적용 전 database/bgg_sync/<날짜>_before.json 과 롤백 SQL 저장)
 *
 * 규칙 (2026-09-10 확정):
 *  - bgg_id 항목 type 이 boardgame/boardgameexpansion 이 아니면 건드리지 않고 보고만 한다 (오연결 방지)
 *  - BGG 값 0 은 "미기재" → 기존 값 유지
 *  - playingtime 은 "30분" / "60~120분" 형식. 최소가 5분 미만이면 최대만 쓴다
 *  - difficulty 는 BGG 투표 5명 이상일 때만 갱신. 투표 부족인데 기존 값이 0 이면 NULL 로 (가짜 0 제거)
 *  - genres 는 운영자가 한글로 손질한 값을 덮어쓰지 않는다. 비어 있을 때만 GENRE_MAP 번역으로 채움
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { GENRE_MAP } from '../src/constants/genreMap.js';
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const H = { Authorization: `Bearer ${env.BGG_API_TOKEN}`, 'User-Agent': 'DulGenius-Board-Game-Rental/1.0 (sync)', Accept: 'application/xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { data: games, error } = await sb.from('games').select('id,name,bgg_id,difficulty,min_players,max_players,min_playtime,max_playtime,playingtime,genres').not('bgg_id', 'is', null).neq('bgg_id', '').order('id');
if (error) throw error;

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
    bgg[m[2]] = { type: m[1], name: (g(/<name[^>]*type="primary"[^>]*value="([^"]+)"/) || '').replace(/&#039;/g, "'").replace(/&amp;/g, '&'), minP: +g(/<minplayers[^>]*value="(\d+)"/), maxP: +g(/<maxplayers[^>]*value="(\d+)"/), minT: +g(/<minplaytime[^>]*value="(\d+)"/), maxT: +g(/<maxplaytime[^>]*value="(\d+)"/), weight: +(+g(/<averageweight[^>]*value="([^"]+)"/)).toFixed(2), votes: +g(/<numweights[^>]*value="(\d+)"/), genres: all(/<link[^>]*type="boardgamecategory"[^>]*value="([^"]+)"/g) };
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
fs.writeFileSync(path.join('database/bgg_sync', `${day}_before.json`), JSON.stringify(games, null, 1));
const q = v => v == null ? 'NULL' : Array.isArray(v) ? `ARRAY[${v.map(x => `'${x.replace(/'/g, "''")}'`).join(',')}]::text[]` : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`;
fs.writeFileSync(path.join('database/bgg_sync', `${day}_rollback.sql`), ['BEGIN;', ...games.map(g => `UPDATE games SET difficulty=${q(g.difficulty)}, min_players=${q(g.min_players)}, max_players=${q(g.max_players)}, min_playtime=${q(g.min_playtime)}, max_playtime=${q(g.max_playtime)}, playingtime=${q(g.playingtime)}, genres=${q(g.genres)} WHERE id=${g.id};`), 'COMMIT;'].join('\n'));
let ok = 0, fail = 0;
for (const u of updates) { const { error } = await sb.from('games').update(u.set).eq('id', u.id); if (error) { fail++; console.error(`FAIL ${u.id}: ${error.message}`); } else ok++; }
console.log(`적용 완료 ok=${ok} fail=${fail} (롤백: database/bgg_sync/${day}_rollback.sql)`);
