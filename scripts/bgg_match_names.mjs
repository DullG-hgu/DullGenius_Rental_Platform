#!/usr/bin/env node
/**
 * BGG 이름 매칭 리포트 (읽기 전용)
 * games.name 으로 BGG 검색(한글 가능)을 돌려 bgg_id 후보를 판정한다. DB에 쓰지 않는다.
 *
 *   node scripts/bgg_match_names.mjs [출력.json]
 *
 * 판정: AUTO(정확 일치 1건) / AMBIGUOUS(정확 일치 여러 건) / SUGGEST(부분 일치 1건) / REVIEW / NO_RESULT
 * 확장판은 type=boardgameexpansion 으로 표시된다. 이름에 "확장"이 없는데 확장판만 잡히면 expMismatch=true.
 * 필요 키: .env.local 의 VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BGG_API_TOKEN
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const OUT = process.argv[2] || 'bgg_match_report.json';
const { data: games, error } = await sb.from('games').select('id,name,category,bgg_id').order('id');
if (error) throw error;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.toLowerCase().replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/[\s:：!！·\-–—'’.,?()[\]]/g, '');
async function search(q) {
  const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(q)}&type=boardgame,boardgameexpansion`;
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.BGG_API_TOKEN}`, 'User-Agent': 'DulGenius-Board-Game-Rental/1.0 (name-match)' } });
    if (r.status === 202 || r.status === 429) { await sleep(4000 * (a + 1)); continue; }
    if (!r.ok) return { error: r.status };
    const xml = await r.text(); const byId = {};
    const re = /<item[^>]*type="([^"]+)"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g; let m;
    while ((m = re.exec(xml))) {
      const n = m[3].match(/<name[^>]*value="([^"]+)"/); const y = m[3].match(/<yearpublished[^>]*value="(\d+)"/);
      const it = byId[m[2]] || (byId[m[2]] = { id: m[2], name: n ? n[1].replace(/&#039;/g, "'").replace(/&amp;/g, '&') : '', year: y ? y[1] : '', types: [] });
      it.types.push(m[1]);
    }
    return { items: Object.values(byId) };
  }
  return { error: 'timeout' };
}
const out = [];
for (let i = 0; i < games.length; i++) {
  const g = games[i]; process.stderr.write(`[${i + 1}/${games.length}] ${g.name}\n`);
  const r = await search(g.name);
  const rec = { id: g.id, name: g.name, category: g.category, current: g.bgg_id, wantsExpansion: /확장/.test(g.name) };
  if (r.error) { rec.verdict = 'ERROR'; rec.error = r.error; out.push(rec); await sleep(2500); continue; }
  const items = r.items.map(it => ({ ...it, isExp: it.types.includes('boardgameexpansion') }));
  const n = norm(g.name); const nBase = norm(g.name.replace(/확장판|확장/g, ''));
  const exact = items.filter(it => norm(it.name) === n || norm(it.name) === nBase);
  const partial = items.filter(it => !exact.includes(it) && (norm(it.name).includes(n) || n.includes(norm(it.name))));
  rec.candidates = items.slice(0, 6).map(it => `${it.id}${it.isExp ? '(확장)' : ''} ${it.name} ${it.year}`);
  if (items.length === 0) rec.verdict = 'NO_RESULT';
  else if (exact.length === 1) { rec.verdict = 'AUTO'; rec.pick = exact[0]; }
  else if (exact.length > 1) { rec.verdict = 'AMBIGUOUS'; rec.exact = exact.map(it => `${it.id}${it.isExp ? '(확장)' : ''} ${it.name} ${it.year}`); }
  else if (partial.length === 1) { rec.verdict = 'SUGGEST'; rec.pick = partial[0]; }
  else rec.verdict = 'REVIEW';
  if (rec.pick) { rec.expMismatch = rec.pick.isExp !== rec.wantsExpansion; rec.rel = g.bgg_id ? (String(g.bgg_id) === String(rec.pick.id) ? 'SAME' : 'RELINK') : 'NEW'; }
  out.push(rec); await sleep(2500);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const c = f => out.filter(f).length;
console.log(JSON.stringify({ total: out.length, AUTO: c(r => r.verdict === 'AUTO'), SUGGEST: c(r => r.verdict === 'SUGGEST'), AMBIGUOUS: c(r => r.verdict === 'AMBIGUOUS'), REVIEW: c(r => r.verdict === 'REVIEW'), NO_RESULT: c(r => r.verdict === 'NO_RESULT'), relink: c(r => r.rel === 'RELINK'), expMismatch: c(r => r.pick && r.expMismatch) }));
console.log(`리포트: ${OUT}`);
