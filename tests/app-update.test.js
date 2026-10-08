import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    APP_VERSION,
    RETRY_GUARD_MS,
    UPDATE_ATTEMPT_KEY,
    UPDATE_EXPECT_KEY,
    applyUpdate,
    checkUpdateResult,
    canAttempt,
    checkForUpdate,
    fetchLatestVersion,
    formatVersion,
    isMajorUpdate,
    isOutdated,
    resetUpdateCheckCache,
} from '../src/lib/appUpdate';

const latest = { commit: 'abc1234', build: 'b2' };

describe('version comparison', () => {
    it('테스트 환경 번들은 dev 로 표시된다', () => {
        expect(APP_VERSION.build).toBe('dev');
    });

    it('build 가 다르면 구버전, 같거나 응답이 없으면 아님', () => {
        expect(isOutdated({ build: 'b1' }, latest)).toBe(true);
        expect(isOutdated({ build: 'b2' }, latest)).toBe(false);
        expect(isOutdated({ build: 'b1' }, null)).toBe(false);
    });

    it('개발 번들은 갱신 대상이 아니다', () => {
        expect(isOutdated({ build: 'dev' }, latest)).toBe(false);
    });

    it('표시는 사람이 올리는 번호와 커밋을 함께 보여준다', () => {
        expect(formatVersion({ version: '1.0.0', commit: '4b62476', build: 'x' })).toBe('v1.0.0 · 4b62476');
    });
});

describe('isMajorUpdate (홈 버튼 조건)', () => {
    const cur = { version: '1.0.3', build: 'b1' };
    it.each([
        ['1.0.9', false], // 평소 배포 — 패치만
        ['1.1.0', true],
        ['2.0.0', true],
    ])('%s → %s', (version, expected) => {
        expect(isMajorUpdate(cur, { version, build: 'b2' })).toBe(expected);
    });
    it('같은 빌드이거나 버전 정보가 없으면 아니다', () => {
        expect(isMajorUpdate(cur, { version: '1.1.0', build: 'b1' })).toBe(false);
        expect(isMajorUpdate(cur, { build: 'b2' })).toBe(false);
        expect(isMajorUpdate(cur, null)).toBe(false);
    });
});

describe('checkForUpdate', () => {
    beforeEach(() => resetUpdateCheckCache());

    it('5분 안의 재확인은 같은 결과를 재사용한다 (헤더가 페이지마다 다시 마운트됨)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => latest });
        await checkForUpdate({ now: 0, fetchImpl });
        await checkForUpdate({ now: 60_000, fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await checkForUpdate({ now: 5 * 60_000, fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('개발·테스트 번들에서는 새 빌드가 있어도 null', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => latest });
        await expect(checkForUpdate({ now: 0, fetchImpl })).resolves.toBeNull();
    });
});

describe('fetchLatestVersion', () => {
    it('캐시를 우회해 version.json 을 읽는다', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => latest });
        await expect(fetchLatestVersion(fetchImpl)).resolves.toEqual(latest);
        expect(fetchImpl.mock.calls[0][0]).toMatch(/^\/version\.json\?t=\d+$/);
        expect(fetchImpl.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    });

    it('네트워크 오류·404·형식 오류는 null — 업데이트 사유가 아니다', async () => {
        await expect(fetchLatestVersion(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toBeNull();
        await expect(fetchLatestVersion(vi.fn().mockResolvedValue({ ok: false }))).resolves.toBeNull();
        await expect(fetchLatestVersion(vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))).resolves.toBeNull();
        // SPA 폴백이 index.html 을 200 으로 주는 경우
        await expect(fetchLatestVersion(vi.fn().mockResolvedValue({
            ok: true, json: async () => { throw new SyntaxError('html'); },
        }))).resolves.toBeNull();
    });
});

describe('repeat guard', () => {
    it('같은 빌드는 10분에 한 번만 시도한다', () => {
        const now = 1_000_000;
        expect(canAttempt(null, 'b2', now)).toBe(true);
        expect(canAttempt({ build: 'b2', at: now - 1000 }, 'b2', now)).toBe(false);
        expect(canAttempt({ build: 'b2', at: now - RETRY_GUARD_MS }, 'b2', now)).toBe(true);
        expect(canAttempt({ build: 'b1', at: now - 1000 }, 'b2', now)).toBe(true);
    });
});

describe('applyUpdate', () => {
    let reload;
    let swListeners;
    let reg;
    let otherReg;

    beforeEach(() => {
        reload = vi.fn();
        vi.stubGlobal('location', { ...window.location, reload });
        swListeners = {};
        reg = { update: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(true) };
        otherReg = { unregister: vi.fn().mockResolvedValue(true) };
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: vi.fn().mockResolvedValue(reg),
                getRegistrations: vi.fn().mockResolvedValue([reg, otherReg]),
                addEventListener: (type, fn) => { swListeners[type] = fn; },
                removeEventListener: (type) => { delete swListeners[type]; },
            },
        });
        vi.stubGlobal('caches', {
            keys: vi.fn().mockResolvedValue(['workbox-precache', 'supabase-images']),
            delete: vi.fn().mockResolvedValue(true),
        });
    });

    afterEach(() => {
        delete navigator.serviceWorker;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('새 서비스워커가 넘겨받으면 강제 삭제 없이 끝낸다 (새로고침은 index.jsx 몫)', async () => {
        reg.update.mockImplementation(async () => { swListeners.controllerchange(); });
        await expect(applyUpdate(latest, { storage: localStorage, now: 5 })).resolves.toBe('sw-updated');
        expect(reload).not.toHaveBeenCalled();
        expect(caches.delete).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(UPDATE_ATTEMPT_KEY))).toEqual({ build: 'b2', at: 5 });
    });

    it('넘겨받지 못하면 등록 해제·캐시 삭제 후 새로고침', async () => {
        vi.useFakeTimers();
        const done = applyUpdate(latest, { storage: localStorage, now: 5 });
        await vi.advanceTimersByTimeAsync(15000);
        await expect(done).resolves.toBe('hard-reloaded');
        expect(reg.unregister).toHaveBeenCalled();
        expect(otherReg.unregister).toHaveBeenCalled();
        expect(caches.delete).toHaveBeenCalledWith('workbox-precache');
        expect(caches.delete).toHaveBeenCalledWith('supabase-images');
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('받을 새 서비스워커가 없으면 기다리지 않고 바로 캐시 삭제 후 새로고침 (예전엔 15초 대기)', async () => {
        const done = applyUpdate(latest, { storage: localStorage, now: 5, force: true });
        await expect(done).resolves.toBe('hard-reloaded'); // 가짜 타이머 없이도 끝난다 = 대기 없음
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(UPDATE_EXPECT_KEY)).toBe('b2');
        sessionStorage.clear();
    });

    it('새 서비스워커를 받는 중이면 넘겨받을 때까지 기다린다', async () => {
        reg.installing = {};
        reg.update.mockImplementation(async () => { setTimeout(() => swListeners.controllerchange(), 3000); });
        vi.useFakeTimers();
        const done = applyUpdate(latest, { storage: localStorage, now: 5 });
        await vi.advanceTimersByTimeAsync(3000);
        await expect(done).resolves.toBe('sw-updated');
        expect(reload).not.toHaveBeenCalled();
    });

    it('받는 중이어도 8초 안에 안 넘어오면 캐시 삭제 후 새로고침', async () => {
        reg.installing = {};
        vi.useFakeTimers();
        const done = applyUpdate(latest, { storage: localStorage, now: 5 });
        await vi.advanceTimersByTimeAsync(8000);
        await expect(done).resolves.toBe('hard-reloaded');
    });

    it('10분 안에 같은 빌드로 다시 부르면 아무것도 안 한다 (배포 직후 무한 새로고침 방지)', async () => {
        localStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({ build: 'b2', at: 0 }));
        await expect(applyUpdate(latest, { storage: localStorage, now: 60_000 })).resolves.toBe('skipped');
        expect(reg.update).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it('사람이 직접 누른 갱신은 10분 제한 없이 진행한다', async () => {
        localStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({ build: 'b2', at: 0 }));
        reg.update.mockImplementation(async () => { swListeners.controllerchange(); });
        await expect(applyUpdate(latest, { storage: localStorage, now: 60_000, force: true })).resolves.toBe('sw-updated');
        await expect(applyUpdate(latest, { storage: null, now: 60_000, force: true })).resolves.toBe('sw-updated');
    });

    it('시도 기록을 남길 수 없으면 강제 갱신하지 않는다', async () => {
        const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        await expect(applyUpdate(latest, { storage, now: 5 })).resolves.toBe('skipped');
        await expect(applyUpdate(latest, { storage: null, now: 5 })).resolves.toBe('skipped');
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('checkUpdateResult (누른 뒤 새로고침된 첫 화면)', () => {
    afterEach(() => sessionStorage.clear());
    it('누른 적 없으면 null', () => {
        expect(checkUpdateResult({ build: 'b2' })).toBeNull();
    });
    it('기대 빌드로 바뀌었으면 ok, 아니면 failed — 한 번만 알린다', () => {
        sessionStorage.setItem(UPDATE_EXPECT_KEY, 'b2');
        expect(checkUpdateResult({ build: 'b2' })).toBe('ok');
        expect(checkUpdateResult({ build: 'b2' })).toBeNull();
        sessionStorage.setItem(UPDATE_EXPECT_KEY, 'b2');
        expect(checkUpdateResult({ build: 'b1' })).toBe('failed');
    });
});
