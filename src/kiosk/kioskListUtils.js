// src/kiosk/kioskListUtils.js
//
// 키오스크 목록 모달(예약 수령 / 간편 반납)이 공유하는 순수 계산 로직.
// UI 없이 단위 검증할 수 있도록 컴포넌트에서 분리해 뒀다.

/**
 * 아직 유효한 찜인지 판정한다.
 *
 * 서버(kiosk_pickup)도 만료 찜을 막지만, 목록은 열어둔 채로 시간이 흐르기 때문에
 * 화면에서도 걸러야 한다. 만료된 찜이 "수령 대기"로 계속 보이면
 * 운영진이 수령을 눌렀다가 거절당하는 혼란이 생긴다.
 */
export const isActiveDibs = (row, now = new Date()) => {
    if (!row) return false;
    if (row.returned_at) return false;
    if (!row.due_date) return false;           // 서버 공식과 동일: due_date 없으면 유효하지 않다
    return new Date(row.due_date) > now;
};

/** 예약(찜) 행들을 회원별로 묶는다. 만료된 찜은 제외한다. */
export const buildReservationGroups = (rows, now = new Date()) => {
    const grouped = {};

    (rows || [])
        .filter(r => r && r.game && r.profiles && isActiveDibs(r, now))
        .forEach(rental => {
            const userId = rental.profiles.id;
            if (!grouped[userId]) {
                grouped[userId] = { user: rental.profiles, reservations: [] };
            }
            grouped[userId].reservations.push(rental);
        });

    return Object.values(grouped);
};

/** 대여 행들을 회원별로 묶는다. 비회원 현장대여(profiles 없음)는 이름으로 묶는다. */
export const buildRentalGroups = (rows) => {
    const grouped = {};

    (rows || [])
        .filter(r => r && r.game)
        .forEach(rental => {
            const groupKey = rental.profiles?.id || ('anon:' + (rental.renter_name || 'unknown'));
            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    user: rental.profiles || {
                        id: groupKey,
                        name: rental.renter_name || '비회원(수기)',
                        student_id: null
                    },
                    rentals: []
                };
            }
            grouped[groupKey].rentals.push(rental);
        });

    return Object.values(grouped);
};

/**
 * 처리에 성공한 항목만 목록에서 지운다.
 *
 * 예전에는 선택한 항목 전체를 지웠다. 5건 중 2건이 실패해도 5건이 다 사라져서,
 * 실패 토스트는 떴는데 목록에는 아무것도 안 남아 재시도할 방법이 없었다.
 * 실패한 건은 남겨둬야 운영진이 다시 누를 수 있다.
 */
export const removeProcessed = (groups, listKey, doneIds) => (groups || [])
    .map(group => ({
        ...group,
        [listKey]: group[listKey].filter(r => !doneIds.has(r.rental_id))
    }))
    .filter(group => group[listKey].length > 0);

/**
 * 목록에 더 이상 존재하지 않는 선택을 걷어낸다.
 * (Realtime 재조회로 목록이 바뀐 뒤 "선택한 3개" 같은 유령 카운트를 막는다)
 */
export const pruneSelection = (groups, listKey, selected) => {
    const alive = new Set();
    (groups || []).forEach(group => {
        group[listKey].forEach(r => alive.add(r.rental_id));
    });

    const next = new Set();
    selected.forEach(id => {
        if (alive.has(id)) next.add(id);
    });
    return next;
};
