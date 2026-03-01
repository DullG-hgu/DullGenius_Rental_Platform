/**
 * DB 정합성 점검 스크립트
 * 항목: 만료 DIBS 잔존, available_count 불일치, 음수 재고, 관리자 계정, pg_cron
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// .env 로딩
const envPath = path.resolve(__dirname, '../.env');
let env = {};
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length > 0) env[key.trim()] = vals.join('=').trim();
    });
}

const supabaseUrl = env.VITE_SUPABASE_URL;
const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY; // RLS 우회를 위해 service role 사용

if (!supabaseUrl || !serviceKey) {
    console.error('❌ VITE_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ────────────────────────────────────────────
const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';
const INFO = 'ℹ️  INFO';

function section(title) {
    console.log('\n' + '═'.repeat(60));
    console.log(`  ${title}`);
    console.log('═'.repeat(60));
}

// ────────────────────────────────────────────
async function run() {
    console.log('\n🔍 DB 정합성 점검 시작 —', new Date().toLocaleString('ko-KR'));

    // ── 1. 연결 확인 ─────────────────────────
    section('1. 연결 확인');
    const { data: ping, error: pingErr } = await supabase.from('games').select('id').limit(1);
    if (pingErr) {
        console.log(`${FAIL} Supabase 연결 실패: ${pingErr.message}`);
        process.exit(1);
    }
    console.log(`${PASS} Supabase 연결 성공`);

    // ── 2. 만료된 DIBS 잔존 여부 ─────────────
    section('2. 만료된 DIBS 잔존 확인 (available_count 잠금 위험)');
    const { data: expiredDibs, error: dibsErr } = await supabase
        .from('rentals')
        .select('rental_id, game_id, game_name, user_id, borrowed_at, due_date')
        .eq('type', 'DIBS')
        .is('returned_at', null)
        .lt('due_date', new Date().toISOString());

    if (dibsErr) {
        console.log(`${FAIL} 조회 오류: ${dibsErr.message}`);
    } else if (expiredDibs.length === 0) {
        console.log(`${PASS} 만료된 DIBS 없음`);
    } else {
        console.log(`${FAIL} 만료된 DIBS ${expiredDibs.length}건 발견 → available_count 잠김 상태`);
        expiredDibs.forEach(d => {
            const expiredMins = Math.round((Date.now() - new Date(d.due_date)) / 60000);
            console.log(`   • [${d.game_name}] rental_id=${d.rental_id.slice(0,8)}… 만료 ${expiredMins}분 경과`);
        });
    }

    // ── 3. available_count vs 실제 활성 대여 불일치 ──
    section('3. available_count 정합성 확인');
    const { data: games, error: gamesErr } = await supabase
        .from('games')
        .select('id, name, quantity, available_count, image');

    const { data: activeRentals, error: rentalsErr } = await supabase
        .from('rentals')
        .select('game_id, type')
        .is('returned_at', null);

    if (gamesErr || rentalsErr) {
        console.log(`${FAIL} 조회 오류: ${gamesErr?.message || rentalsErr?.message}`);
    } else {
        // 활성 rentals 집계 (RENT + DIBS 둘 다 available_count 차감)
        const activeCounts = {};
        activeRentals.forEach(r => {
            activeCounts[r.game_id] = (activeCounts[r.game_id] || 0) + 1;
        });

        const mismatches = [];
        const negatives  = [];

        games.forEach(g => {
            const active    = activeCounts[g.id] || 0;
            const expected  = g.quantity - active;
            if (g.available_count < 0) negatives.push(g);
            if (g.available_count !== expected) {
                mismatches.push({ ...g, active, expected });
            }
        });

        if (negatives.length > 0) {
            console.log(`${FAIL} 음수 available_count ${negatives.length}건`);
            negatives.forEach(g =>
                console.log(`   • [${g.name}] available_count=${g.available_count}`)
            );
        }

        if (mismatches.length === 0) {
            console.log(`${PASS} 전체 ${games.length}개 게임 available_count 정합`);
        } else {
            console.log(`${FAIL} 불일치 ${mismatches.length}건 발견`);
            mismatches.forEach(g => {
                const diff = g.available_count - g.expected;
                const sign = diff > 0 ? `+${diff}` : `${diff}`;
                console.log(`   • [${g.name}] DB=${g.available_count}, 계산=${g.expected} (qty=${g.quantity}, active=${g.active}) → 차이 ${sign}`);
            });
        }
    }

    // ── 4. 활성 RENT 상세 현황 ───────────────
    section('4. 현재 활성 대여 현황');
    const { data: activeRent, error: activeErr } = await supabase
        .from('rentals')
        .select('rental_id, game_name, renter_name, type, borrowed_at, due_date')
        .is('returned_at', null)
        .order('borrowed_at', { ascending: true });

    if (activeErr) {
        console.log(`${FAIL} 조회 오류: ${activeErr.message}`);
    } else {
        const rents = activeRent.filter(r => r.type === 'RENT');
        const dibs  = activeRent.filter(r => r.type === 'DIBS');
        const now   = Date.now();

        console.log(`${INFO} 활성 RENT: ${rents.length}건, 활성 DIBS: ${dibs.length}건`);

        // 연체 확인
        const overdue = rents.filter(r => new Date(r.due_date) < new Date());
        if (overdue.length > 0) {
            console.log(`${WARN} 연체 ${overdue.length}건`);
            overdue.forEach(r => {
                const days = Math.round((now - new Date(r.due_date)) / 86400000);
                console.log(`   • [${r.game_name}] 대여자=${r.renter_name || '?'} — ${days}일 연체`);
            });
        } else {
            console.log(`${PASS} 연체 없음`);
        }
    }

    // ── 5. cleanup_expired_dibs 함수 존재 여부 ──
    section('5. cleanup_expired_dibs RPC 존재 확인');
    const { data: cleanupResult, error: cleanupErr } = await supabase.rpc('cleanup_expired_dibs');
    if (cleanupErr) {
        if (cleanupErr.message.includes('function') && cleanupErr.message.includes('does not exist')) {
            console.log(`${FAIL} cleanup_expired_dibs 함수가 DB에 없음 → final_rpc_v2.sql 재적용 필요`);
        } else {
            console.log(`${WARN} RPC 호출 오류: ${cleanupErr.message}`);
        }
    } else {
        const count = cleanupResult?.cancelled_count ?? 0;
        if (count > 0) {
            console.log(`${WARN} cleanup_expired_dibs 실행 → 만료 DIBS ${count}건 자동 정리됨`);
        } else {
            console.log(`${PASS} cleanup_expired_dibs 정상 작동, 정리된 건수 0`);
        }
    }

    // ── 6. 관리자 계정 확인 ──────────────────
    section('6. 관리자(admin) 계정 확인');
    const { data: admins, error: adminErr } = await supabase
        .from('user_roles')
        .select('user_id, role_key')
        .eq('role_key', 'admin');

    if (adminErr) {
        console.log(`${FAIL} 조회 오류: ${adminErr.message}`);
    } else if (!admins || admins.length === 0) {
        console.log(`${FAIL} admin 역할을 가진 계정이 없음 → 관리자 페이지 접근 불가`);
    } else {
        // 프로필 별도 조회
        const adminIds = admins.map(a => a.user_id);
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, student_id, status')
            .in('id', adminIds);
        const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

        console.log(`${PASS} admin 계정 ${admins.length}명`);
        admins.forEach(a => {
            const p = profileMap[a.user_id];
            const status = p?.status === 'active' ? '활성' : (p?.status || '상태불명');
            console.log(`   • ${p?.name || '이름없음'} (${p?.student_id || '-'}) — ${status}`);
        });
    }

    // ── 7. 전체 게임 통계 ────────────────────
    section('7. 게임 데이터 요약');
    if (!gamesErr && games) {
        const totalGames     = games.length;
        const noImage        = games.filter(g => !g.image).length;
        const zeroQty        = games.filter(g => g.quantity <= 0).length;
        const fullyRented    = games.filter(g => g.available_count === 0).length;

        console.log(`${INFO} 등록 게임: ${totalGames}개`);
        console.log(`${INFO} 전량 대여중: ${fullyRented}개`);
        if (zeroQty > 0)  console.log(`${WARN} quantity=0 이하: ${zeroQty}개`);
        if (noImage > 0)  console.log(`${WARN} 이미지 없음: ${noImage}개`);
        if (zeroQty === 0 && noImage === 0) console.log(`${PASS} 이상 없음`);
    }

    // ── 최종 요약 ────────────────────────────
    section('점검 완료');
    console.log('문제가 발견된 경우:');
    console.log('  • 만료 DIBS → Supabase SQL Editor에서 SELECT cleanup_expired_dibs(); 실행');
    console.log('  • available_count 불일치 → 수동 계산값으로 UPDATE 또는 fix 함수 확인');
    console.log('  • RPC 없음 → database/final_rpc_v2.sql 전체 재적용');
    console.log('  • 관리자 없음 → database/grant_admin.sql 또는 manage_user_roles.sql 실행\n');
}

run().catch(e => {
    console.error('❌ 예상치 못한 오류:', e.message);
    process.exit(1);
});
