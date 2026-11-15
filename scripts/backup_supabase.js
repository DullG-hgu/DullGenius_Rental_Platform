// Supabase public 테이블 전량 백업 (읽기 전용)
//
//   node scripts/backup_supabase.js
//
// 출력: "Supabase backup/<UTC 타임스탬프>/<table>.json" + _manifest.json
//   회원 이름·전화번호가 들어 있다. 폴더는 .gitignore 처리돼 있으니 절대 커밋하지 말 것.
//
// 운영 DB가 Nano 인스턴스라 조회를 몰아치면 사이트 전체가 멈춘다(2026-10-04·10-08 장애).
//   - 요청은 한 번에 하나, 사이에 REQUEST_GAP_MS 휴식
//   - 요청마다 타임아웃, 실패해도 즉시 재시도하지 않고 그 테이블만 건너뛴다
//   - 단일 기본키 테이블은 키셋 페이지네이션(정렬 + gt), 복합키는 정렬 + range
//
// 테이블 목록은 database/_LIVE/schema.sql 기준. 테이블이 늘면 여기에도 추가한다.
// private_config 는 외부 연동 공유 시크릿이 있어 의도적으로 제외한다.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PAGE_SIZE = 1000;
const REQUEST_GAP_MS = 1500;
const REQUEST_TIMEOUT_MS = 20000;

// table → 기본키 컬럼 (정렬 기준)
const TABLES = {
    allowed_users: ['student_id'],
    app_config: ['key'],
    bgg_terms: ['id'],
    damage_reports: ['id'],
    event_payment_logs: ['id'],
    event_registrations: ['id'],
    event_teams: ['id'],
    events: ['id'],
    fun_quiz_public: ['user_id'],
    fun_quiz_responses: ['id'],
    fun_tier_lists: ['user_id', 'template_id'],
    fun_tier_placements: ['user_id', 'template_id', 'game_id'],
    fun_tier_templates: ['id'],
    fun_worldcup_matches: ['run_id', 'round_size', 'match_no'],
    fun_worldcup_runs: ['id'],
    fun_worldcup_themes: ['id'],
    fun_worldcup_undos: ['id'],
    game_bgg_terms: ['game_id', 'term_id'],
    game_daily_stats: ['id'],
    game_info_reports: ['id'],
    game_requests: ['id'],
    game_tags: ['game_id', 'tag_id'],
    games: ['id'],
    logs: ['log_id'],
    matches: ['id'],
    point_transactions: ['id'],
    profiles: ['id'],
    rental_requests: ['id'],
    rentals: ['rental_id'],
    reviews: ['review_id'],
    roles: ['role_key'],
    tags: ['id'],
    user_game_mark_events: ['id'],
    user_game_marks: ['user_id', 'game_id'],
    user_roles: ['user_id', 'role_key'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return env;
}

async function fetchPage(supabase, table, keys, cursor, offset) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        let q = supabase.from(table).select('*').abortSignal(ctrl.signal);
        for (const k of keys) q = q.order(k, { ascending: true });
        if (keys.length === 1) {
            if (cursor !== null) q = q.gt(keys[0], cursor);
            q = q.limit(PAGE_SIZE);
        } else {
            q = q.range(offset, offset + PAGE_SIZE - 1);
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message || JSON.stringify(error));
        return data || [];
    } finally {
        clearTimeout(timer);
    }
}

async function backupTable(supabase, table, keys) {
    const rows = [];
    let cursor = null;
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await fetchPage(supabase, table, keys, cursor, offset);
        rows.push(...page);
        await sleep(REQUEST_GAP_MS);
        if (page.length < PAGE_SIZE) break;
        cursor = page[page.length - 1][keys[0]];
    }
    return rows;
}

async function main() {
    const env = loadEnv();
    const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !/^sb_secret_[A-Za-z0-9_-]+$/.test(key || '')) {
        throw new Error('Supabase URL and SUPABASE_SERVICE_ROLE_KEY (sb_secret_ format) are required');
    }
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const startedAt = new Date();
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.resolve(__dirname, `../Supabase backup/${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`→ ${dir}`);

    const manifest = { started_at: startedAt.toISOString(), tables: {}, failed: {} };
    for (const [table, keys] of Object.entries(TABLES)) {
        process.stdout.write(`${table.padEnd(24)} `);
        try {
            const rows = await backupTable(supabase, table, keys);
            fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2), 'utf8');
            manifest.tables[table] = rows.length;
            console.log(rows.length);
        } catch (err) {
            manifest.failed[table] = err.message;
            console.log(`FAILED: ${err.message}`);
            await sleep(REQUEST_GAP_MS * 4);
        }
    }
    manifest.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const failed = Object.keys(manifest.failed);
    const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    console.log(`\n${Object.keys(manifest.tables).length} tables, ${total} rows. failed: ${failed.length ? failed.join(', ') : 'none'}`);
    if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
