// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { judgeDuesCapture } from '../netlify/functions/_shared/duesRules';

// 저장소가 공개라 실제 계좌·이름은 쓰지 않는다. 글자 모양만 실제 캡처(토스·카카오뱅크)를 따랐다.
const CONFIG = {
    amount: 20000,
    accounts: [
        { bank: '카카오뱅크', number: '1234-56-7890123', holder: '홍길동' },
        { bank: '토스뱅크', number: '9876-54-32109', holder: '홍길동' },
    ],
};
const judge = (...texts) => judgeDuesCapture(texts, CONFIG);

// 기준 (2026-11-11 사용자 결정): 회비 금액이 화면에 있으면 통과.
describe('회비 캡처 판정 — 통과', () => {
    it('카카오뱅크: 계좌까지 맞으면 account_match', () => {
        const r = judge('홍길동님에게\n20,000원 보냈어요\n카카오뱅크 1234-56-7890123');
        expect(r).toEqual({ status: 'approved', reason: 'account_match', amount: 20000, accountTail: '0123' });
    });

    it('토스: 계좌가 없고 예금주만 맞으면 holder_only', () => {
        expect(judge('홍길동님에게\n20,000원을\n보냈어요')).toMatchObject({ status: 'approved', reason: 'holder_only' });
    });

    it('받는 곳이 달라도 금액이 맞으면 통과 (amount_only 로 표시만)', () => {
        expect(judge('홍길동님에게 20,000원 보냈어요 카카오뱅크 3333-00-1111111').reason).toBe('holder_only');
        expect(judge('김철수님에게 20,000원을 보냈어요')).toMatchObject({ status: 'approved', reason: 'amount_only' });
        expect(judge('내 모임통장으로 20,000원을 옮겼어요').status).toBe('approved');
    });

    it('금액과 완료 문구가 떨어진 은행 앱', () => {
        expect(judge('이체완료\n받는분 홍길동\n이체금액 20,000원').status).toBe('approved');
    });

    it('한 방식이 금액을 잘못 읽어도 다른 방식이 읽었으면 통과', () => {
        expect(judge('홍길동님에게\n20,0007! 보냈어요', '홍길동님에게\n20,000원\n보냈어요').status).toBe('approved');
    });

    it('쉼표를 점으로 읽은 조각·글자 사이 공백이 있어도 읽는다', () => {
        expect(judge('홍길동님에게 20.000원 보냈어요', '홍길동님에게 20,000 원 을 보냈어요').status).toBe('approved');
    });

    it('계좌 설정이 비어 있어도 금액만으로 판정한다', () => {
        expect(judgeDuesCapture(['20,000원을 보냈어요'], { amount: 20000 })).toMatchObject({ status: 'approved', reason: 'amount_only' });
    });
});

describe('회비 캡처 판정 — 통과 아님', () => {
    it('다른 금액만 있으면 반려', () => {
        expect(judge('홍길동님에게 1원을 보냈어요')).toMatchObject({ status: 'rejected', reason: 'amount_mismatch', amount: 1 });
        expect(judge('홍길동님에게 10,000원을 보냈어요').status).toBe('rejected');
        expect(judge('홍길동님에게 40,000원을 보냈어요').status).toBe('rejected');
    });

    it('금액이 하나도 안 읽히면 다시 찍기 (다크 모드)', () => {
        expect(judge('홍길동님에게\n보냈어요')).toMatchObject({ status: 'retry', reason: 'amount_unread' });
        expect(judge('홍길동님에게 000원 보냈어요').status).toBe('retry');
    });

    it('글자가 하나도 없으면 검토', () => {
        expect(judgeDuesCapture([], CONFIG).reason).toBe('ocr_unavailable');
        expect(judgeDuesCapture(['  ', null], CONFIG).reason).toBe('ocr_unavailable');
    });

    it('금액 설정이 비어 있으면 자동 판정하지 않는다', () => {
        expect(judgeDuesCapture(['20,000원'], { accounts: CONFIG.accounts }).reason).toBe('not_configured');
        expect(judgeDuesCapture(['20,000원'], null).reason).toBe('not_configured');
    });
});
