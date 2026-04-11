/**
 * 현재 Supabase에 배포된 RPC 함수 목록을 가져와
 * 로컬 final_rpc_v2.sql과 비교하는 스크립트
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// .env 로딩
const envPath = path.resolve(__dirname, '../.env');
let env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
    const [k, ...v] = l.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const SUPABASE_URL     = env.VITE_SUPABASE_URL;
const ANON_KEY         = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// ── 로컬 SQL에서 기대되는 함수 목록 ──────────────────
// final_rpc_v2.sql + 기타 sql 파일에서 정의된 함수들
const EXPECTED_FUNCTIONS = new Set([
    // final_rpc_v2.sql
    'is_payment_check_enabled',
    'is_user_payment_exempt',
    'earn_points',
    'dibs_game',
    'cancel_dibs',
    'rent_game',
    'return_game',
    'admin_rent_game',
    'admin_return_game',
    'cleanup_expired_dibs',
    'safe_delete_game',
    'increment_view_count',
    'get_trending_games',
    'send_user_log',
    'withdraw_user',
    'update_my_semester',
    'kiosk_rental',
    'kiosk_return',
    'kiosk_pickup',
    'register_match_result',
    'rent_any_copy',
    'dibs_any_copy',
    // harden_security / other sql 파일
    'is_admin',
    'reset_user_password',
    'reset_own_password',
    'fix_rental_data_consistency',
    'reset_semester_payments',
]);

// ── OpenAPI로 배포된 함수 목록 가져오기 ──────────────
function fetchOpenAPI() {
    return new Promise((resolve, reject) => {
        const url = `${SUPABASE_URL}/rest/v1/`;
        https.get(url, {
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Accept': 'application/json'
            }
        }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch(e) { reject(new Error('OpenAPI 파싱 실패: ' + e.message)); }
            });
        }).on('error', reject);
    });
}

// ── service role로 pg_proc 쿼리 (함수 정의 시간 확인) ─
async function fetchFunctionDetails(funcNames) {
    // Supabase REST API로 pg_proc 직접 접근은 안 되므로
    // 각 함수를 호출해서 존재 여부 + 에러 타입 확인
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const results = {};
    for (const fn of funcNames) {
        const { data, error } = await supabase.rpc(fn);
        if (error) {
            if (error.message.includes('does not exist')) {
                results[fn] = { exists: false, error: error.message };
            } else if (error.message.includes('wrong number of arguments') ||
                       error.message.includes('argument') ||
                       error.code === 'PGRST202') {
                // 함수는 있지만 파라미터 없이 호출해서 오류
                results[fn] = { exists: true, note: '파라미터 필요' };
            } else {
                results[fn] = { exists: true, error: error.message };
            }
        } else {
            results[fn] = { exists: true, result: data };
        }
    }
    return results;
}

// ── 메인 ─────────────────────────────────────────────
async function main() {
    console.log('\n🔍 Supabase 배포 RPC 함수 점검');
    console.log('═'.repeat(60));

    // 1. OpenAPI에서 현재 노출된 함수 목록 수집
    console.log('\n[1] OpenAPI에서 배포된 RPC 함수 목록 조회 중...');
    const spec = await fetchOpenAPI();
    const livePaths  = Object.keys(spec.paths || {});
    const liveFuncs  = livePaths
        .filter(p => p.startsWith('/rpc/'))
        .map(p => p.replace('/rpc/', ''))
        .sort();

    console.log(`\n    현재 Supabase에 등록된 RPC 함수: ${liveFuncs.length}개\n`);

    // 2. 각 함수 상세 정보 (파라미터 포함)
    const funcDetails = {};
    for (const fn of liveFuncs) {
        const pathObj = spec.paths[`/rpc/${fn}`];
        const postOp  = pathObj?.post;
        const params  = postOp?.requestBody?.content?.['application/json']?.schema?.properties;
        funcDetails[fn] = params ? Object.keys(params) : [];
    }

    // 3. 로컬 기대 목록과 비교
    const liveSet    = new Set(liveFuncs);
    const missing    = [...EXPECTED_FUNCTIONS].filter(f => !liveSet.has(f)).sort();
    const unexpected = liveFuncs.filter(f => !EXPECTED_FUNCTIONS.has(f)).sort();

    // ── 출력: 배포된 전체 목록 ──
    console.log('    함수명                              파라미터');
    console.log('    ' + '─'.repeat(56));
    for (const fn of liveFuncs) {
        const params = funcDetails[fn];
        const paramStr = params.length ? params.join(', ') : '(없음)';
        const flag = EXPECTED_FUNCTIONS.has(fn) ? '  ' : '⚠️';
        console.log(`  ${flag} ${fn.padEnd(36)} ${paramStr}`);
    }

    // ── 출력: 로컬에만 있고 배포 안 된 함수 ──
    console.log('\n' + '═'.repeat(60));
    if (missing.length === 0) {
        console.log('✅ 로컬 SQL에서 기대한 함수가 모두 배포되어 있음');
    } else {
        console.log(`❌ 로컬에 정의되어 있으나 Supabase에 없는 함수 (${missing.length}개):`);
        missing.forEach(f => console.log(`   • ${f}`));
    }

    // ── 출력: 배포되어 있으나 로컬 SQL에 없는 함수 ──
    console.log();
    if (unexpected.length === 0) {
        console.log('✅ 배포된 함수가 모두 로컬 SQL에 문서화되어 있음');
    } else {
        console.log(`⚠️  Supabase에 있으나 로컬 SQL에 없는 함수 (${unexpected.length}개):`);
        console.log('   (레거시이거나 직접 SQL Editor에서 생성된 함수일 수 있음)');
        unexpected.forEach(f => {
            const params = funcDetails[f];
            const paramStr = params.length ? `(${params.join(', ')})` : '()';
            console.log(`   • ${f}${paramStr}`);
        });
    }

    // ── 보안 취약점과 직결된 핵심 함수 상태 ──
    console.log('\n' + '═'.repeat(60));
    console.log('  핵심 보안 관련 함수 배포 상태');
    console.log('═'.repeat(60));
    const securityFuncs = [
        'is_admin',
        'is_user_payment_exempt',
        'cleanup_expired_dibs',
        'kiosk_pickup',
        'kiosk_return',
        'kiosk_rental',
        'reset_user_password',
        'reset_own_password',
    ];
    securityFuncs.forEach(f => {
        const exists = liveSet.has(f);
        const params = funcDetails[f];
        const paramStr = params ? `(${params.join(', ')})` : '';
        console.log(`  ${exists ? '✅' : '❌'} ${f}${paramStr}`);
    });

    console.log('\n');
}

main().catch(e => {
    console.error('❌ 오류:', e.message);
    process.exit(1);
});
