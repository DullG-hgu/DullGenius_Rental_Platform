import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    APP_VERSION,
    RETRY_GUARD_MS,
    UPDATE_ATTEMPT_KEY,
    applyUpdate,
    canAttempt,
    fetchLatestVersion,
    isOutdated,
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

    it('10분 안에 같은 빌드로 다시 부르면 아무것도 안 한다 (배포 직후 무한 새로고침 방지)', async () => {
        localStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({ build: 'b2', at: 0 }));
        await expect(applyUpdate(latest, { storage: localStorage, now: 60_000 })).resolves.toBe('skipped');
        expect(reg.update).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it('시도 기록을 남길 수 없으면 강제 갱신하지 않는다', async () => {
        const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        await expect(applyUpdate(latest, { storage, now: 5 })).resolves.toBe('skipped');
        await expect(applyUpdate(latest, { storage: null, now: 5 })).resolves.toBe('skipped');
        expect(reload).not.toHaveBeenCalled();
    });
});
