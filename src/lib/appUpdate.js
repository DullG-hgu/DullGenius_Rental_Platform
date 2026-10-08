// src/lib/appUpdate.js
//
// 실행 중인 화면이 서버의 최신 빌드인지 확인하고, 아니면 서비스워커 캐시까지 비워 새로 받는다.
//
// PWA 에서는 location.reload() 만으로는 부족하다. 서비스워커가 캐시해 둔 옛 index.html·번들을
// 그대로 다시 내주기 때문이다. 그래서 두 단계로 간다.
//   1) reg.update() — 새 sw.js 가 있으면 autoUpdate 설정상 바로 활성화되고,
//      index.jsx 의 controllerchange 처리가 새로고침한다.
//   2) 일정 시간 안에 그게 안 일어나면 서비스워커 등록 해제 + Cache Storage 전부 삭제 후 새로고침.
//
// 배포 직후 잠깐 version.json 은 새것인데 CDN 이 옛 번들을 주는 구간이 있다. 그때 2)를 반복하면
// 무한 새로고침이 되므로, 같은 빌드에 대한 시도는 localStorage 기록으로 10분에 한 번만 한다.
// 기록을 남길 수 없는 환경이면 강제 갱신 자체를 하지 않는다.

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : { commit: 'dev', build: 'dev' };

export const UPDATE_ATTEMPT_KEY = 'app_update_attempt';
export const RETRY_GUARD_MS = 10 * 60 * 1000;
const SW_UPDATE_WAIT_MS = 15000;

/** 서버의 최신 빌드 정보. 실패하면 null (네트워크 오류는 업데이트 사유가 아니다). */
export const fetchLatestVersion = async (fetchImpl = fetch) => {
    try {
        const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        return data && typeof data.build === 'string' ? data : null;
    } catch {
        return null;
    }
};

export const isOutdated = (current, latest) =>
    !!latest && current.build !== 'dev' && latest.build !== current.build;

export const canAttempt = (attempt, latestBuild, now) =>
    !attempt || attempt.build !== latestBuild || now - attempt.at >= RETRY_GUARD_MS;

const readAttempt = (storage) => {
    try {
        return JSON.parse(storage.getItem(UPDATE_ATTEMPT_KEY));
    } catch {
        return null;
    }
};

const getStorage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const waitForControllerChange = (ms) => new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw) {
        resolve(false);
        return;
    }
    const onChange = () => {
        clearTimeout(timer);
        resolve(true);
    };
    const timer = setTimeout(() => {
        sw.removeEventListener('controllerchange', onChange);
        resolve(false);
    }, ms);
    sw.addEventListener('controllerchange', onChange, { once: true });
});

/**
 * 최신 빌드로 갱신한다. 호출하는 쪽이 "지금 새로고침해도 되는 때"인지 판단해야 한다.
 * @returns {Promise<'skipped'|'sw-updated'|'hard-reloaded'>}
 */
export const applyUpdate = async (latest, { storage = getStorage(), now = Date.now() } = {}) => {
    if (!storage || !canAttempt(readAttempt(storage), latest.build, now)) return 'skipped';
    try {
        storage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({ build: latest.build, at: now }));
    } catch {
        return 'skipped';
    }

    const sw = navigator.serviceWorker;
    const reg = await sw?.getRegistration().catch(() => null);
    if (reg) {
        const changed = waitForControllerChange(SW_UPDATE_WAIT_MS);
        await reg.update().catch(() => {});
        // 새로고침은 index.jsx 의 controllerchange 처리가 한다
        if (await changed) return 'sw-updated';
    }

    try {
        const regs = (await sw?.getRegistrations()) ?? [];
        await Promise.all(regs.map((r) => r.unregister()));
        if (window.caches) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map((k) => window.caches.delete(k)));
        }
    } catch {
        /* 지우기 실패해도 새로고침은 한다 — 다음 시도는 10분 뒤 */
    }
    window.location.reload();
    return 'hard-reloaded';
};
