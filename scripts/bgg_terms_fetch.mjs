#!/usr/bin/env node
/**
 * BGG 원본 태그 수집 — bgg_id 가 있는 게임의 category·mechanic·family 를 bgg_terms / game_bgg_terms 에 보관한다.
 *
 *   node scripts/bgg_terms_fetch.mjs            # dry-run: BGG 조회 + 변경 예정·빈도 리포트만
 *   node scripts/bgg_terms_fetch.mjs --apply    # 실제 적용
 *
 * 규칙 (2026-10-04):
 *  - games 테이블(genres 포함)은 건드리지 않는다. 장르 정리는 이 데이터를 근거로 후속 단계에서 한다
 *  - bgg_id 항목 type 이 boardgame/boardgameexpansion 이 아니면 넣지 않고 보고만 한다 (오연결 방지)
 *  - family 는 전부 받아 두고 family_group(접두어)으로 나중에 쓸 묶음을 고른다
 *  - bgg_terms.name_ko 는 운영자·정리 단계 몫이라 덮어쓰지 않는다
 *  - bgg_id 가 바뀌었거나 지워진 게임의 옛 연결은 지운다
 *  - 리포트: database/bgg_terms/<날짜>_report.md, 원본: <날짜>_raw.json
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY || '')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// 브라우저 UA 로 위장하면 Cloudflare 403 — 앱 식별 UA 필수
const H = { Authorization: `Bearer ${env.BGG_API_TOKEN}`, 'User-Agent': 'dullgrental/1.0 (+https://dullgrental.netlify.app; terms)', Accept: 'application/xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KINDS = { boardgamecategory: 'category', boardgamemechanic: 'mechanic', boardgamefamily: 'family' };
const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
const familyGroup = name => (name.includes(':') ? name.slice(0, name.indexOf(':')).trim() : null);

const { data: games, error } = await sb.from('games').select('id,name,bgg_id').not('bgg_id', 'is', null).neq('bgg_id', '').order('id');
if (error) throw error;

// ── BGG 조회 ──
const ids = [...new Set(games.map(g => g.bgg_id.trim()))];
const bgg = {};
for (let i = 0; i < ids.length; i += 20) {
  const b = ids.slice(i, i + 20); process.stderr.write(`BGG ${i + 1}-${i + b.length}/${ids.length}\n`);
  let xml;
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`https://boardgamegeek.com/xmlapi2/thing?id=${b.join(',')}`, { headers: H });
    if (r.status === 202 || r.status === 429) { await sleep(4000 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`BGG ${r.status} (401=토큰, 403=UA 차단)`);
    xml = await r.text(); break;
  }
  if (!xml) throw new Error('BGG 재시도 초과');
  for (const m of xml.matchAll(/<item[^>]*type="([^"]+)"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)) {
    const [, type, id, inner] = m;
    const name = decode((inner.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/) || [])[1] || '');
    const terms = [];
    for (const [tag] of inner.matchAll(/<link\b[^>]*\/?>/g)) {
      const kind = KINDS[attr(tag, 'type')];
      if (!kind) continue;
      const termName = attr(tag, 'value');
      terms.push({ id: +attr(tag, 'id'), kind, name_en: termName, family_group: kind === 'family' ? familyGroup(termName) : null });
    }
    bgg[id] = { type, name, terms };
  }
  await sleep(2500);
}

// ── 게임별 목표 상태 ──
const termDict = new Map();
const wanted = new Map(); // game_id → Set(term_id)
const problems = [];
for (const g of games) {
  const b = bgg[g.bgg_id.trim()];
  if (!b) { problems.push(`${g.id} ${g.name}: BGG ${g.bgg_id} 없음`); continue; }
  if (!['boardgame', 'boardgameexpansion'].includes(b.type)) { problems.push(`${g.id} ${g.name}: BGG ${g.bgg_id} type=${b.type} (${b.name}) → 제외`); continue; }
  wanted.set(g.id, new Set(b.terms.map(t => t.id)));
  for (const t of b.terms) termDict.set(t.id, t);
}

// ── 현재 DB 와 비교 ──
// PostgREST 기본 상한이 1000행이라 끝까지 나눠 읽는다 (10/26 연결 2919건 중 1000건만 읽혀 삭제 누락)
const selectAll = async (table, cols, order) => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await sb.from(table).select(cols).order(order[0]).order(order[1] || order[0]).range(from, from + 999);
    if (e) throw e;
    rows.push(...data);
    if (data.length < 1000) return rows;
    await sleep(500);
  }
};
const curTerms = await selectAll('bgg_terms', 'id,kind,name_en,family_group', ['id']);
const curLinks = await selectAll('game_bgg_terms', 'game_id,term_id', ['game_id', 'term_id']);
const curTermMap = new Map(curTerms.map(t => [t.id, t]));
const termUpserts = [...termDict.values()].filter(t => { const c = curTermMap.get(t.id); return !c || c.kind !== t.kind || c.name_en !== t.name_en || c.family_group !== t.family_group; });
const curByGame = new Map();
for (const l of curLinks) { if (!curByGame.has(l.game_id)) curByGame.set(l.game_id, new Set()); curByGame.get(l.game_id).add(l.term_id); }
let addCount = 0, delCount = 0;
const staleGames = [...curByGame.keys()].filter(id => !wanted.has(id));
for (const [gid, set] of wanted) { const cur = curByGame.get(gid) || new Set(); for (const t of set) if (!cur.has(t)) addCount++; for (const t of cur) if (!set.has(t)) delCount++; }
for (const gid of staleGames) delCount += curByGame.get(gid).size;

// ── 빈도 리포트 ──
const freq = new Map();
for (const set of wanted.values()) for (const t of set) freq.set(t, (freq.get(t) || 0) + 1);
const byKind = kind => [...termDict.values()].filter(t => t.kind === kind).sort((a, b) => freq.get(b.id) - freq.get(a.id) || a.name_en.localeCompare(b.name_en));
const groups = new Map();
for (const t of byKind('family')) { const k = t.family_group || '(접두어 없음)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
const groupRows = [...groups.entries()].map(([k, ts]) => ({ k, terms: ts.length, games: new Set([...wanted].filter(([, s]) => ts.some(t => s.has(t.id))).map(([gid]) => gid)).size, ts })).sort((a, b) => b.games - a.games);
const table = list => ['| 태그 | 게임 수 |', '|---|---|', ...list.map(t => `| ${t.name_en} | ${freq.get(t.id)} |`)].join('\n');
const date = new Date().toISOString().slice(0, 10);
const md = [
  `# BGG 원본 태그 빈도 (${date})`, '',
  '읽기 전용 산출물 (`scripts/bgg_terms_fetch.mjs`). 장르 정리의 근거 자료다.', '',
  `- 대상 게임 ${games.length}개 · 수집 ${wanted.size}개 · 제외 ${problems.length}개`,
  `- category ${byKind('category').length}종 · mechanic ${byKind('mechanic').length}종 · family ${byKind('family').length}종`, '',
  ...(problems.length ? ['## 제외', '', ...problems.map(p => `- ${p}`), ''] : []),
  '## family 접두어 묶음', '', '| 접두어 | 태그 종류 | 게임 수 | 예시 |', '|---|---|---|---|',
  ...groupRows.map(r => `| ${r.k} | ${r.terms} | ${r.games} | ${r.ts.slice(0, 4).map(t => t.name_en).join(' · ')} |`), '',
  '## category', '', table(byKind('category')), '',
  '## mechanic', '', table(byKind('mechanic')), '',
  '## family (2개 이상 게임)', '', table(byKind('family').filter(t => freq.get(t.id) >= 2)), '',
].join('\n');
const outDir = path.join('database', 'bgg_terms');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${date}_report.md`), md);
fs.writeFileSync(path.join(outDir, `${date}_raw.json`), JSON.stringify(Object.fromEntries(games.map(g => [g.id, { name: g.name, bgg_id: g.bgg_id, bgg: bgg[g.bgg_id.trim()] || null }])), null, 1));

console.log(`대상 ${games.length} · 수집 ${wanted.size} · 제외 ${problems.length}`);
problems.forEach(p => console.log('  ⚠', p));
console.log(`태그 사전: 신규·변경 ${termUpserts.length} (전체 ${termDict.size})`);
console.log(`연결: 추가 ${addCount} · 삭제 ${delCount} (bgg_id 빠진 게임 ${staleGames.length})`);
console.log(`리포트: ${path.join(outDir, `${date}_report.md`)}`);
if (!APPLY) { console.log('\n(dry-run — 적용하려면 --apply)'); process.exit(0); }

// ── 적용 ──
for (let i = 0; i < termUpserts.length; i += 200) {
  const { error: e } = await sb.from('bgg_terms').upsert(termUpserts.slice(i, i + 200), { onConflict: 'id' });
  if (e) throw e;
  await sleep(2000); // 운영 DB가 Nano — 배치 사이 간격 (2026-10-04 장애)
}
const now = new Date().toISOString();
// 새로 생긴 연결만 쓴다 (기존 연결의 fetched_at 은 처음 수집 시각으로 남는다)
const linkRows = [...wanted].flatMap(([gid, set]) => { const cur = curByGame.get(gid) || new Set(); return [...set].filter(t => !cur.has(t)).map(term_id => ({ game_id: gid, term_id, fetched_at: now })); });
for (let i = 0; i < linkRows.length; i += 500) {
  const { error: e } = await sb.from('game_bgg_terms').upsert(linkRows.slice(i, i + 500), { onConflict: 'game_id,term_id' });
  if (e) throw e;
  await sleep(2000);
}
for (const [gid, set] of wanted) {
  const cur = curByGame.get(gid); if (!cur) continue;
  const gone = [...cur].filter(t => !set.has(t));
  if (gone.length) { const { error: e } = await sb.from('game_bgg_terms').delete().eq('game_id', gid).in('term_id', gone); if (e) throw e; }
}
if (staleGames.length) { const { error: e } = await sb.from('game_bgg_terms').delete().in('game_id', staleGames); if (e) throw e; }
console.log('✓ 적용 완료');
