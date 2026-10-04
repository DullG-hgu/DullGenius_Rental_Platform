// src/kiosk/kioskFeedback.js
// 키오스크 수령·반납 결과 화면용 헬퍼

// 이 시간 안에 응답이 없으면 "확인 필요"로 넘긴다.
// 요청 자체는 취소되지 않으므로 실패로 단정하지 않고, 목록을 다시 읽어 실제 상태를 보여준다.
export const KIOSK_REQUEST_TIMEOUT_MS = 15000;

export class KioskTimeoutError extends Error {
    constructor() {
        super('응답 지연');
        this.name = 'KioskTimeoutError';
    }
}

export function withTimeout(promise, ms = KIOSK_REQUEST_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new KioskTimeoutError()), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const KST = 'Asia/Seoul';

// 서버 due_date(timestamptz) → "10월 5일(일) 밤 12시까지"
// rental_due_date() 는 KST 자정을 돌려주므로, 자정이면 전날 "밤 12시"로 읽어 준다.
export function formatDueDate(iso) {
    if (!iso) return null;
    const due = new Date(iso);
    if (Number.isNaN(due.getTime())) return null;

    const parts = (d) => Object.fromEntries(
        new Intl.DateTimeFormat('ko-KR', {
            timeZone: KST, month: 'numeric', day: 'numeric', weekday: 'short',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(d).map(p => [p.type, p.value])
    );

    const p = parts(due);
    if (p.hour === '00' && p.minute === '00') {
        const prev = parts(new Date(due.getTime() - 60 * 1000));
        return `${prev.month}월 ${prev.day}일(${prev.weekday}) 밤 12시까지`;
    }
    return `${p.month}월 ${p.day}일(${p.weekday}) ${p.hour}:${p.minute}까지`;
}
