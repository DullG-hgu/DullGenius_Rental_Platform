/**
 * [CORE LOGIC] Game Status Calculation
 * 
 * 이 함수는 게임의 재고, 대여 기록, 예약(찜) 정보를 바탕으로
 * 최종 상태(status)와 대여 정보(renter, dueDate 등)를 결정합니다.
 * 
 * ⚠️ WARNING: 핵심 비즈니스 로직입니다. (Encapsulated)
 * 함부로 수정하지 마세요. (Do not modify without review)
 */
export const calculateGameStatus = (game, gameRentals) => {
    // 1. 유효한 예약(찜) 및 대여 기록 필터링
    const now = new Date();
    const activeDibs = gameRentals.filter(r => {
        if (r.type !== 'DIBS') return false;
        if (!r.due_date) return true;
        return new Date(r.due_date) > now;
    });
    const activeRents = gameRentals.filter(r => r.type === 'RENT');

    // 2. 동적 재고 계산 (관리자페이지 로직 참고: quantity - 대여/예약된 수량)
    const totalQuantity = game.quantity ?? 1;
    const realAvailableCount = Math.max(0, totalQuantity - activeDibs.length - activeRents.length);

    // 3. 초기값
    let status = '대여가능';
    let renter = null;
    let renterId = null;
    let dueDate = null;

    // [Step A] 정보 추출 (상태와 무관하게 대여자 정보를 모두 수집)
    // 모든 예약자 + 대여자 이름을 합침 (중복 제거 필요 시 추가 가능)
    const allRenterNames = [
        ...activeDibs.map(r => r.renter_name || r.profiles?.name),
        ...activeRents.map(r => r.renter_name || r.profiles?.name)
    ].filter(Boolean);

    renter = allRenterNames.join(', ');

    // 대표 대여자 ID (상세보기용, 찜 우선)
    const representative = activeDibs[0] || activeRents[0];
    renterId = representative?.user_id;

    // 반납 예정일 추출 (가장 빠른 날짜)
    const allDueDates = [...activeDibs, ...activeRents]
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
    } else if (activeDibs.length > 0) {
        status = '예약됨';
    } else {
        status = '대여중';
    }

    // 2. 관리자(Admin)용 상태: 조치(예약/대여) 우선
    let adminStatus = '대여가능';

    // [MOD] 재고가 0인 경우 품절(대여중) 처리
    if (realAvailableCount === 0) {
        if (activeDibs.length > 0 && activeRents.length === 0) {
            adminStatus = '예약됨';
        } else {
            adminStatus = '대여중';
        }
    } else {
        // [MOD] 재고가 1개 이상 남아있는 경우
        if (activeDibs.length > 0 || activeRents.length > 0) {
            adminStatus = '일부대여중'; // [NEW] 재고가 남아있으나 빌려간/예약한 사람이 있는 경우
        } else {
            adminStatus = '대여가능';
        }
    }

    return {
        status, // 일반 사용자용 상태
        adminStatus, // [NEW] 관리자 전용 상태
        available_count: realAvailableCount,
        renter,
        renterId,
        dueDate,
        active_rental_count: activeRents.length,
        rentals: [...activeDibs, ...activeRents] // [FIX] 유효한 찜/대여만 반환
    };
};
