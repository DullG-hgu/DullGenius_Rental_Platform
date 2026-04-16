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
function query(sql) {
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
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
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
    const rows = await query(`
        SELECT
            t.table_name,
            c.column_name,
            c.ordinal_position,
            c.udt_name           AS data_type,
            c.is_nullable,
            c.column_default,
            c.character_maximum_length,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
            fk.foreign_table_name,
            fk.foreign_column_name
        FROM information_schema.tables t
        JOIN information_schema.columns c
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        LEFT JOIN (
            SELECT kcu.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema   = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
        LEFT JOIN (
            SELECT
                kcu.table_name, kcu.column_name,
                ccu.table_name  AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ) fk ON fk.table_name = c.table_name AND fk.column_name = c.column_name
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name, c.ordinal_position
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

    const [fnCount, tableCount] = await Promise.all([
        pullFunctions(),
        pullSchema(),
    ]);
    await Promise.all([
        pullPolicies(),
        pullTypes(),
    ]);

    writeReadme({ functions: fnCount, tables: tableCount });

    console.log(`\n✅ database/current/ 업데이트 완료`);
    console.log(`   📁 ${OUTPUT_DIR}\n`);
}

main().catch(e => {
    console.error('\n❌ 오류:', e.message);
    process.exit(1);
});
