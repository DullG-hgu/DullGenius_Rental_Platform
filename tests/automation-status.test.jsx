import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchCronStatus: vi.fn() }));
vi.mock('../src/api', () => ({ fetchCronStatus: mocks.fetchCronStatus }));

import AutomationStatusPanel, { describeSchedule, expectedIntervalMs, jobHealth } from '../src/admin/AutomationStatusPanel.jsx';

describe('describeSchedule (cron 은 UTC)', () => {
    it.each([
        ['17 * * * *', '매시 17분'],
        ['0 18 * * *', '매일 03:00'], // UTC 18시 = KST 03시
        ['30 3 * * *', '매일 12:30'],
        ['*/10 * * * *', '*/10 * * * *'],
        ['0 0 * * 1', '0 0 * * 1'],
        ['', ''],
    ])('%s → %s', (schedule, expected) => {
        expect(describeSchedule(schedule)).toBe(expected);
    });
});

describe('jobHealth', () => {
    it('꺼짐 > 실패 > 기록 없음 > 정상 순서로 판정', () => {
        expect(jobHealth({ active: false, last_status: 'failed' }).key).toBe('off');
        expect(jobHealth({ active: true, last_status: 'failed', last_start: 'x' }).key).toBe('failed');
        expect(jobHealth({ active: true }).key).toBe('unknown');
        expect(jobHealth({ active: true, last_status: 'succeeded', last_start: 'x' }).key).toBe('ok');
    });
});

describe('AutomationStatusPanel', () => {
    beforeEach(() => {
        mocks.fetchCronStatus.mockReset(); // 반환값(함수)을 vitest가 정리 훅으로 실행하지 않게 블록으로
    });

    it('잡별 상태와 외부 자동화 안내를 보인다', async () => {
        mocks.fetchCronStatus.mockResolvedValue({
            available: true, window: 2000, now: '2026-10-11T03:30:00Z',
            jobs: [
                { jobid: 1, name: 'fun-worldcup-abandon', schedule: '17 * * * *', active: true, last_status: 'succeeded', last_start: '2026-10-11T03:17:00Z' },
                { jobid: 2, name: 'cleanup', schedule: '0 18 * * *', active: true, last_status: 'failed', last_start: '2026-10-10T18:00:00Z', last_message: 'permission denied' },
            ],
            recent: [],
        });
        render(<AutomationStatusPanel />);
        expect(await screen.findByText('fun-worldcup-abandon')).toBeInTheDocument();
        expect(screen.getByText('정상')).toBeInTheDocument();
        expect(screen.getByText('최근 실행 실패')).toBeInTheDocument();
        expect(screen.getByText('permission denied')).toBeInTheDocument();
        expect(screen.getByText(/GitHub Actions·Netlify 핑\)는 여기 안 보임/)).toBeInTheDocument();
    });

    it('DB 함수가 아직 없으면 준비 중 안내 (화면은 그대로)', async () => {
        mocks.fetchCronStatus.mockImplementation(async () => {
            throw Object.assign(new Error('not found'), { code: 'PGRST202' });
        });
        render(<AutomationStatusPanel />);
        await waitFor(() => expect(screen.getByText(/DB 함수 미적용/)).toBeInTheDocument());
    });
});

describe('jobHealth — 검증 반례 (오래된 성공·실행 중)', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    it('매시 도는 작업이 3시간 넘게 새 실행이 없으면 멈춤 의심', () => {
        expect(jobHealth({ active: true, schedule: '17 * * * *', last_status: 'succeeded', last_start: '2026-10-11T08:17:00Z' }, now).key).toBe('stale');
        expect(jobHealth({ active: true, schedule: '17 * * * *', last_status: 'succeeded', last_start: '2026-10-11T11:17:00Z' }, now).key).toBe('ok');
    });
    it('매일 도는 작업이 지난달 성공뿐이면 멈춤 의심', () => {
        expect(jobHealth({ active: true, schedule: '0 18 * * *', last_status: 'succeeded', last_start: '2026-09-10T18:00:00Z' }, now).key).toBe('stale');
    });
    it('실행 중·시작 중은 정상(초록)이 아니다', () => {
        expect(jobHealth({ active: true, schedule: '17 * * * *', last_status: 'running', last_start: '2026-10-11T11:17:00Z' }, now).key).toBe('running');
        expect(jobHealth({ active: true, schedule: '17 * * * *', last_status: 'starting', last_start: '2026-10-11T11:17:00Z' }, now).key).toBe('running');
        // 실행 중인 채로 주기 두 배 넘게 지나면 멈춤 의심
        expect(jobHealth({ active: true, schedule: '17 * * * *', last_status: 'running', last_start: '2026-10-10T11:17:00Z' }, now).key).toBe('stale');
    });
    it('주기를 못 읽는 표기는 성공이어도 「주기 판단 불가」로 표시', () => {
        expect(jobHealth({ active: true, schedule: '0 0 * * 1', last_status: 'succeeded', last_start: '2026-10-01T00:00:00Z' }, now).label).toMatch(/주기 판단 불가/);
    });
});

describe('expectedIntervalMs', () => {
    it.each([
        ['17 * * * *', 3600000],
        ['*/10 * * * *', 600000],
        ['0 18 * * *', 86400000],
        ['0 0 * * 1', null],
        ['', null],
    ])('%s → %s', (schedule, expected) => {
        expect(expectedIntervalMs(schedule)).toBe(expected);
    });
});
