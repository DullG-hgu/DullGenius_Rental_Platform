/**
 * pull_schema.js
 *
 * Supabase Management API (/database/query) 를 통해
 * 현재 DB의 실제 상태를 database/current/ 에 SQL 파일로 저장합니다.
 *
 * 생성 파일:
 *   database/current/functions.sql  — 모든 public 함수 (CREATE OR REPLACE FUNCTION 그대로)
 *   database/current/schema.sql     — 모든 테이블 + 컬럼
 *   database/current/rls.sql        — 모든 RLS 정책
 *   database/current/types.sql      — 커스텀 Enum 타입
 *   database/current/grants.sql     — anon/authenticated 실효 권한 (함수·테이블·컬럼)
 *
 * 실행: node scripts/pull_schema.js  (또는 npm run pull-schema)
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── .env.local 파싱 ─────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF  = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const OUTPUT_DIR   = path.resolve(__dirname, '../database/_LIVE');

// ── 사전 검증 ─────────────────────────────────────────────────────────────────
if (!ACCESS_TOKEN) {
    console.error('\n❌ SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
    process.exit(1);
}
if (!PROJECT_REF) {
    console.error('❌ VITE_SUPABASE_URL 에서 프로젝트 ref 를 추출할 수 없습니다.');
    process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── SQL 쿼리 실행 ──────────────────────────────────────────────────────────────
// 운영 DB가 Nano 라 카탈로그 조회를 연달아 날리면 멈출 수 있다 (2026-10-04 장애). 조회 사이 2초 간격.
// 동시에 불려도 한 줄로 세운다 — 앞 조회가 끝나고 2초 뒤에 다음 조회.
// 각 조회에는 서버 쪽 statement_timeout 을 건다 (클라이언트가 끊어도 서버 쿼리는 계속 돌기 때문).
const QUERY_GAP_MS = 2000;
const STATEMENT_TIMEOUT = '20s';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let queue = Promise.resolve();
function query(sql) {
    const run = queue.then(() => rawQuery(`SET statement_timeout = '${STATEMENT_TIMEOUT}';\n${sql}`));
    queue = run.catch(() => {}).then(() => sleep(QUERY_GAP_MS));
    return run;
}

function rawQuery(sql) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: sql });
        const options = {
            hostname: 'api.supabase.com',
            path:     `/v1/projects/${PROJECT_REF}/database/query`,
            method:   'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            // 청크를 문자열로 이어 붙이면 멀티바이트(한글) 경계가 잘려 깨진다.
            // Buffer로 모았다가 한 번에 디코딩한다.
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const data = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode >= 400) {
                    reject(new Error(`쿼리 실패 (${res.statusCode}): ${data.slice(0, 300)}`));
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`응답 파싱 실패: ${data.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── 파일 헤더 ─────────────────────────────────────────────────────────────────
function fileHeader(title) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    return [
        '-- ================================================================',
        `-- ${title}`,
        `-- 프로젝트: ${PROJECT_REF}`,
        `-- 생성 시각: ${now}`,
        `-- 생성 스크립트: scripts/pull_schema.js`,
        '-- (자동 생성 파일 — 직접 수정하지 마세요)',
        '-- ================================================================',
        '',
    ].join('\n');
}

// ── functions.sql ──────────────────────────────────────────────────────────────
async function pullFunctions() {
    // pg_get_functiondef() 가 완전한 CREATE OR REPLACE FUNCTION 문을 반환
    const rows = await query(`
        SELECT
            p.proname                  AS name,
            pg_get_functiondef(p.oid)  AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        ORDER BY p.proname
    `);

    const lines = [
        fileHeader('FUNCTIONS — public schema 현재 배포 상태'),
        `-- 총 ${rows.length}개 함수\n`,
    ];

    for (const row of rows) {
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(`-- 함수: ${row.name}`);
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(row.definition.trimEnd());
        lines.push('');
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'functions.sql'), lines.join('\n'), 'utf8');
    console.log(`  ✓ functions.sql — ${rows.length}개 함수`);
    return rows.length;
}

// ── schema.sql ────────────────────────────────────────────────────────────────
async function pullSchema() {
    // information_schema 대신 pg_catalog 를 직접 읽는다 (2026-10-10).
    // information_schema 뷰는 행마다 권한 검사를 하고 auth·storage 등 모든 스키마를 훑은 뒤 거른다.
    // 예전 FK 조인은 제약조건 이름만으로 붙여 다른 스키마까지 계산했고, 10/8 Nano 다운 직전 524 가 이 조회였다.
    // 여기서는 public 테이블에서 시작해 oid 로만 따라간다. 출력 칸은 예전과 같다.
    const rows = await query(`
        SELECT
            c.relname            AS table_name,
            a.attname            AS column_name,
            a.attnum             AS ordinal_position,
            COALESCE(bt.typname, t.typname) AS data_type,
            CASE WHEN a.attnotnull OR (t.typtype = 'd' AND t.typnotnull) THEN 'NO' ELSE 'YES' END AS is_nullable,
            CASE WHEN a.attgenerated = '' THEN pg_get_expr(d.adbin, d.adrelid) END AS column_default,
            information_schema._pg_char_max_length(COALESCE(bt.oid, t.oid), a.atttypmod) AS character_maximum_length,
            COALESCE(a.attnum = ANY(pk.conkey), false) AS is_pk,
            fk.foreign_table_name,
            fk.foreign_column_name
        FROM pg_class c
        JOIN pg_namespace n  ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        JOIN pg_type t       ON t.oid = a.atttypid
        LEFT JOIN pg_type bt ON t.typtype = 'd' AND bt.oid = t.typbasetype
        LEFT JOIN pg_attrdef d     ON d.adrelid = c.oid AND d.adnum = a.attnum
        LEFT JOIN pg_constraint pk ON pk.conrelid = c.oid AND pk.contype = 'p'
        LEFT JOIN LATERAL (
            SELECT rc.relname AS foreign_table_name, ra.attname AS foreign_column_name
            FROM pg_constraint f
            JOIN pg_class rc     ON rc.oid = f.confrelid
            JOIN pg_attribute ra ON ra.attrelid = f.confrelid
                                AND ra.attnum = f.confkey[array_position(f.conkey, a.attnum)]
            WHERE f.conrelid = c.oid AND f.contype = 'f' AND a.attnum = ANY(f.conkey)
            ORDER BY f.conname
            LIMIT 1
        ) fk ON true
        WHERE c.relkind IN ('r', 'p')
        ORDER BY c.relname, a.attnum
    `);

    // 테이블별로 그룹핑
    const tables = {};
    for (const row of rows) {
        if (!tables[row.table_name]) tables[row.table_name] = [];
        tables[row.table_name].push(row);
    }

    const tableNames = Object.keys(tables).sort();
    const lines = [
        fileHeader('SCHEMA — Tables (public schema 현재 배포 상태)'),
        `-- 총 ${tableNames.length}개 테이블\n`,
    ];

    for (const tableName of tableNames) {
        const cols = tables[tableName];
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(`-- 테이블: ${tableName}`);
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(`CREATE TABLE public.${tableName} (`);

        const colDefs = cols.map((col, i) => {
            const type      = col.character_maximum_length
                ? `${col.data_type}(${col.character_maximum_length})`
                : col.data_type;
            const nullable  = col.is_nullable === 'NO' ? ' NOT NULL' : '';
            const def       = col.column_default ? ` DEFAULT ${col.column_default}` : '';
            const pk        = col.is_pk ? ' PRIMARY KEY' : '';
            const fk        = col.foreign_table_name
                ? `  -- FK → ${col.foreign_table_name}(${col.foreign_column_name})`
                : '';
            const comma     = i < cols.length - 1 ? ',' : '';
            return `  ${col.column_name} ${type}${nullable}${def}${pk}${comma}${fk}`;
        });

        lines.push(...colDefs);
        lines.push(');');
        lines.push('');
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'schema.sql'), lines.join('\n'), 'utf8');
    console.log(`  ✓ schema.sql  — ${tableNames.length}개 테이블`);
    return tableNames.length;
}

// ── rls.sql ───────────────────────────────────────────────────────────────────
async function pullPolicies() {
    const rows = await query(`
        SELECT
            tablename,
            policyname,
            permissive,
            roles,
            cmd,
            qual,
            with_check
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname
    `);

    const lines = [
        fileHeader('RLS POLICIES — public schema 현재 배포 상태'),
        `-- 총 ${rows.length}개 정책\n`,
    ];

    // 테이블별로 그룹핑
    const byTable = {};
    for (const row of rows) {
        if (!byTable[row.tablename]) byTable[row.tablename] = [];
        byTable[row.tablename].push(row);
    }

    for (const [tableName, policies] of Object.entries(byTable).sort()) {
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(`-- 테이블: ${tableName}  (${policies.length}개 정책)`);
        lines.push(`-- ----------------------------------------------------------------`);
        lines.push(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;`);
        lines.push('');

        for (const p of policies) {
            const roles = Array.isArray(p.roles) ? p.roles.join(', ') : p.roles;
            lines.push(`CREATE POLICY "${p.policyname}" ON public.${tableName}`);
            lines.push(`  AS ${p.permissive}`);
            lines.push(`  FOR ${p.cmd}`);
            if (roles && roles !== '{}'  && roles !== '{}') lines.push(`  TO ${roles.replace(/[{}]/g, '')}`);
            if (p.qual)        lines.push(`  USING (${p.qual})`);
            if (p.with_check)  lines.push(`  WITH CHECK (${p.with_check})`);
            lines.push(';');
            lines.push('');
        }
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'rls.sql'), lines.join('\n'), 'utf8');
    console.log(`  ✓ rls.sql     — ${rows.length}개 정책`);
}

// ── types.sql ─────────────────────────────────────────────────────────────────
async function pullTypes() {
    const rows = await query(`
        SELECT
            t.typname,
            e.enumlabel,
            e.enumsortorder
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public'
        ORDER BY t.typname, e.enumsortorder
    `);

    // 타입별 그룹핑
    const types = {};
    for (const row of rows) {
        if (!types[row.typname]) types[row.typname] = [];
        types[row.typname].push(row.enumlabel);
    }

    const typeNames = Object.keys(types).sort();
    const lines = [
        fileHeader('CUSTOM TYPES & ENUMS — public schema'),
        `-- 총 ${typeNames.length}개 Enum 타입\n`,
    ];

    if (typeNames.length === 0) {
        lines.push('-- (커스텀 Enum 타입 없음)');
    }

    for (const typeName of typeNames) {
        const vals = types[typeName];
        lines.push(`CREATE TYPE public.${typeName} AS ENUM (`);
        vals.forEach((val, i) => {
            lines.push(`  '${val}'${i < vals.length - 1 ? ',' : ''}`);
        });
        lines.push(');');
        lines.push('');
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'types.sql'), lines.join('\n'), 'utf8');
    console.log(`  ✓ types.sql   — ${typeNames.length}개 타입`);
}

// ── grants.sql ─────────────────────────────────────────────────────────────────
// anon / authenticated 가 실제로 무엇을 할 수 있는지 (RLS 이전 단계의 GRANT).
// 함수 EXECUTE, 테이블 권한, 컬럼 단위 권한을 한 파일에 담는다.
async function pullGrants() {
    const fnRows = await query(`
        SELECT
            p.proname,
            pg_get_function_identity_arguments(p.oid) AS args,
            p.prosecdef AS secdef,
            p.proacl IS NULL AS default_acl,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0) AS public_exec,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) x JOIN pg_roles r ON r.oid = x.grantee
                    WHERE r.rolname = 'anon' AND x.privilege_type = 'EXECUTE') AS anon_exec,
            EXISTS (SELECT 1 FROM aclexplode(p.proacl) x JOIN pg_roles r ON r.oid = x.grantee
                    WHERE r.rolname = 'authenticated' AND x.privilege_type = 'EXECUTE') AS auth_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
        ORDER BY p.proname, args
    `);

    // 테이블·컬럼 권한도 information_schema.role_*_grants 대신 ACL 을 직접 푼다 (위 pullSchema 와 같은 이유)
    const tableRows = await query(`
        SELECT c.relname AS table_name, r.rolname AS grantee,
               string_agg(x.privilege_type, ', ' ORDER BY x.privilege_type) AS privs
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        CROSS JOIN LATERAL aclexplode(c.relacl) x
        JOIN pg_roles r ON r.oid = x.grantee AND r.rolname IN ('anon', 'authenticated')
        WHERE c.relkind IN ('r', 'v', 'f', 'p', 'm')
          AND x.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
        GROUP BY c.relname, r.rolname
        ORDER BY c.relname, r.rolname
    `);

    // 테이블 단위 권한이 없는데 컬럼 단위로만 열린 것 (예: rentals → anon)
    const colRows = await query(`
        SELECT c.relname AS table_name, r.rolname AS grantee, x.privilege_type,
               string_agg(a.attname, ', ' ORDER BY a.attname) AS cols
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        CROSS JOIN LATERAL aclexplode(a.attacl) x
        JOIN pg_roles r ON r.oid = x.grantee AND r.rolname IN ('anon', 'authenticated')
        WHERE c.relkind IN ('r', 'v', 'f', 'p', 'm')
          AND NOT EXISTS (
              SELECT 1 FROM aclexplode(c.relacl) tx
              WHERE tx.grantee = x.grantee AND tx.privilege_type = x.privilege_type
          )
        GROUP BY c.relname, r.rolname, x.privilege_type
        ORDER BY c.relname, r.rolname, x.privilege_type
    `);

    const lines = [
        fileHeader('GRANTS — anon / authenticated 실효 권한 (RLS 이전 단계)'),
        '-- 읽는 법:',
        '--   anon=Y 인 SECURITY DEFINER 함수는 비로그인으로 호출 가능하다. 의도된 것만 남아야 한다.',
        '--   (is_admin/is_kiosk_or_admin 은 정책 평가용으로 anon=Y 가 정상. 회수 금지)',
        '--   테이블 GRANT 는 RLS 정책과 AND 로 작동한다. anon 에게는 쓰기 GRANT 가 없어야 한다.',
        '',
        '-- ----------------------------------------------------------------',
        `-- 함수 EXECUTE  (${fnRows.length}개)`,
        '-- ----------------------------------------------------------------',
        '-- anon  auth  security  function',
    ];
    for (const f of fnRows) {
        const anon = f.default_acl || f.public_exec || f.anon_exec ? 'Y' : '-';
        const auth = f.default_acl || f.public_exec || f.auth_exec ? 'Y' : '-';
        const sec  = f.secdef ? 'DEFINER' : 'INVOKER';
        lines.push(`--  ${anon}     ${auth}    ${sec.padEnd(8)}  ${f.proname}(${f.args})`);
    }

    lines.push('');
    lines.push('-- ----------------------------------------------------------------');
    lines.push(`-- 테이블 권한  (${tableRows.length}개)`);
    lines.push('-- ----------------------------------------------------------------');
    for (const t of tableRows) {
        lines.push(`GRANT ${t.privs} ON public.${t.table_name} TO ${t.grantee};`);
    }

    lines.push('');
    lines.push('-- ----------------------------------------------------------------');
    lines.push(`-- 컬럼 단위 권한 (테이블 권한 없이 컬럼만 열린 것, ${colRows.length}개)`);
    lines.push('-- ----------------------------------------------------------------');
    for (const c of colRows) {
        lines.push(`GRANT ${c.privilege_type} (${c.cols}) ON public.${c.table_name} TO ${c.grantee};`);
    }
    lines.push('');

    fs.writeFileSync(path.join(OUTPUT_DIR, 'grants.sql'), lines.join('\n'), 'utf8');
    console.log(`  ✓ grants.sql  — 함수 ${fnRows.length}개 / 테이블 권한 ${tableRows.length}개 / 컬럼 권한 ${colRows.length}개`);
}

// ── README ────────────────────────────────────────────────────────────────────
function writeReadme(stats) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const content = [
        '# database/current/',
        '',
        'Supabase 현재 배포 상태를 자동으로 끌어온 파일들입니다.',
        '**직접 수정하지 마세요** — `node scripts/pull_schema.js` 로 갱신됩니다.',
        '',
        '## 파일 목적',
        '',
        '| 파일 | 내용 | AI 활용 시점 |',
        '|------|------|-------------|',
        '| `functions.sql` | 모든 RPC 함수 (바디 포함) | 함수 로직 파악, 버그 수정 |',
        '| `schema.sql`    | 모든 테이블 + 컬럼 정의  | 쿼리 작성, 관계 파악 |',
        '| `rls.sql`       | 모든 RLS 정책            | 보안/권한 문제 디버깅 |',
        '| `types.sql`     | 커스텀 Enum 타입         | 타입 관련 작업 |',
        '| `grants.sql`    | anon/authenticated 실효 권한 (함수 EXECUTE·테이블·컬럼) | 권한 회귀 점검, 비회원 노출 면 확인 |',
        '',
        '## 마지막 갱신',
        '',
        `- 시각: ${now}`,
        `- 프로젝트: ${PROJECT_REF}`,
        `- 함수: ${stats.functions}개 / 테이블: ${stats.tables}개`,
        '',
        '## 갱신 방법',
        '',
        '```bash',
        'npm run pull-schema',
        '```',
        '',
    ].join('\n');

    fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), content, 'utf8');
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🔌 Supabase 스키마 풀 — 프로젝트: ${PROJECT_REF}\n`);

    // 한 번에 하나씩 (query() 가 줄을 세우지만, 읽는 사람이 동시 실행으로 오해하지 않게)
    const fnCount    = await pullFunctions();
    const tableCount = await pullSchema();
    await pullPolicies();
    await pullTypes();
    await pullGrants();

    writeReadme({ functions: fnCount, tables: tableCount });

    console.log(`\n✅ database/current/ 업데이트 완료`);
    console.log(`   📁 ${OUTPUT_DIR}\n`);
}

main().catch(e => {
    console.error('\n❌ 오류:', e.message);
    process.exit(1);
});
