/**
 * [CORE LOGIC] Game Status Calculation
 *
 * 이 함수는 게임의 재고, 대여 기록, 예약(찜) 정보를 바탕으로
 * 최종 상태(status)와 대여 정보(renter, dueDate 등)를 결정합니다.
 *
 * ⚠️ [SSOT] 점유 판정 공식은 서버의 count_active_occupancy() 와 반드시 같아야 합니다.
 *   RENT : 활성 전부
 *   DIBS : due_date > now  (30분 만료)
 *   HOLD : borrowed_at <= now + 7일  AND  due_date > now  (단체대여 lookahead 창)
 * 이 중 HOLD 는 예전에 클라이언트에서 누락돼 있었습니다. 단체대여가 잡힌 게임이
 * "대여가능" 으로 표시되고, 실제로 찜하면 서버가 '재고가 없습니다' 로 거절하는
 * 불일치의 원인이었습니다. 공식을 바꿀 일이 있으면 서버 함수와 함께 고치세요.
 *
 * ⚠️ [PERFORMANCE] Race Condition 주의:
 * - 데이터 조회(fetchGameById)와 상태 계산(이 함수) 사이의 시간 차이로 인해
 *   brief inconsistency가 발생할 수 있습니다.
 * - 예: T0에 available_count=5 조회 → T1에 다른 사용자가 1개 대여 → T2에 여전히 5개로 표시
 * - 최종 판정은 언제나 서버 RPC 가 합니다. 이 계산은 표시용입니다.
 *
 * ⚠️ WARNING: 핵심 비즈니스 로직입니다. (Encapsulated)
 * 함부로 수정하지 마세요. (Do not modify without review)
 */

// 단체대여(HOLD) 가 재고를 점유하기 시작하는 선행 기간 — 서버와 동일하게 7일
const HOLD_LOOKAHEAD_MS = 1000 * 60 * 60 * 24 * 7;

export const calculateGameStatus = (game, gameRentals) => {
    // 1. 유효한 예약(찜) / 대여 / 단체대여 기록 필터링
    const now = new Date();
    const openRentals = (gameRentals || []).filter(r => r && !r.returned_at);

    const activeDibs = openRentals.filter(r =>
        r.type === 'DIBS' && r.due_date && new Date(r.due_date) > now
    );
    const activeRents = openRentals.filter(r => r.type === 'RENT');
    const activeHolds = openRentals.filter(r => {
        if (r.type !== 'HOLD') return false;
        if (!r.due_date || !r.borrowed_at) return false;
        const windowStart = new Date(now.getTime() + HOLD_LOOKAHEAD_MS);
        return new Date(r.borrowed_at) <= windowStart && new Date(r.due_date) > now;
    });

    // 2. 동적 재고 계산 (서버 공식과 동일)
    const occupiedCount = activeDibs.length + activeRents.length + activeHolds.length;
    const totalQuantity = game.quantity ?? 1;
    const realAvailableCount = Math.max(0, totalQuantity - occupiedCount);

    // 예약성 점유(찜 + 단체대여) — 상태 문구 판정에 함께 쓴다
    const reservedCount = activeDibs.length + activeHolds.length;

    // 3. 초기값
    let status = '대여가능';
    let renter = null;
    let renterId = null;
    let dueDate = null;

    // [Step A] 정보 추출 (상태와 무관하게 대여자 정보를 모두 수집)
    const allRenterNames = [
        ...activeDibs.map(r => r.renter_name || r.profiles?.name),
        ...activeRents.map(r => r.renter_name || r.profiles?.name),
        ...activeHolds.map(r => r.renter_name || r.profiles?.name)
    ].filter(Boolean);

    renter = allRenterNames.join(', ');

    // 대표 대여자 ID (상세보기용, 찜 우선)
    // ⚠️ HOLD 는 user_id 가 없는 외부 단체 예약이므로 대표자로 삼지 않는다.
    //    GameDetail 의 '찜 취소' 버튼 노출 조건이 이 값에 의존한다.
    const representative = activeDibs[0] || activeRents[0];
    renterId = representative?.user_id;

    // 반납 예정일 추출 (가장 빠른 날짜)
    const allDueDates = [...activeDibs, ...activeRents, ...activeHolds]
        .filter(r => r.due_date)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    if (allDueDates.length > 0) {
        dueDate = allDueDates[0].due_date;
    }

    // [Step B] 최종 상태(Status) 결정
    // 0. 대여 불가(열람 전용 등) 우선 처리
    if (game.is_rentable === false) {
        return {
            status: '대여 불가', // 일반 사용자용 상태
            adminStatus: '대여 불가', // 관리자 전용 상태
            available_count: 0,
            renter: null,
            renterId: null,
            dueDate: null,
            active_rental_count: 0,
            rentals: []
        };
    }

    // 1. 이용자(User)용 상태: 재고 우선
    if (realAvailableCount > 0) {
        status = '대여가능';
    } else if (reservedCount > 0 && activeRents.length === 0) {
        status = '예약됨';
    } else {
        status = '대여중';
    }

    // 2. 관리자(Admin)용 상태: 조치(예약/대여) 우선
    let adminStatus = '대여가능';

    // [MOD] 재고가 0인 경우 품절(대여중) 처리
    if (realAvailableCount === 0) {
        if (reservedCount > 0 && activeRents.length === 0) {
            adminStatus = '예약됨';
        } else {
            adminStatus = '대여중';
        }
    } else {
        // [MOD] 재고가 1개 이상 남아있는 경우
        if (occupiedCount > 0) {
            adminStatus = '일부대여중'; // 재고가 남아있으나 빌려간/예약한 사람이 있는 경우
        } else {
            adminStatus = '대여가능';
        }
    }

    return {
        status, // 일반 사용자용 상태
        adminStatus, // 관리자 전용 상태
        available_count: realAvailableCount,
        renter,
        renterId,
        dueDate,
        active_rental_count: activeRents.length,
        // 유효한 찜/대여/단체대여만 반환 (관리자 화면이 점유 사유를 볼 수 있어야 한다)
        rentals: [...activeDibs, ...activeRents, ...activeHolds]
    };
};
