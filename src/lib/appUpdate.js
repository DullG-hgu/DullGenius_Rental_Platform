// src/lib/appUpdate.js
//
// 실행 중인 화면이 서버의 최신 빌드인지 확인하고, 아니면 서비스워커 캐시까지 비워 새로 받는다.
//
// PWA 에서는 location.reload() 만으로는 부족하다. 서비스워커가 캐시해 둔 옛 index.html·번들을
// 그대로 다시 내주기 때문이다. 그래서 두 단계로 간다.
//   1) reg.update() — 새 sw.js 를 받는 중이면(installing/waiting) 그것이 넘겨받을 때까지만 기다린다.
//      넘겨받으면 index.jsx 의 controllerchange 처리가 새로고침한다.
//   2) 받을 게 없거나(이미 받아 둠·확인 실패) 기다려도 안 넘어오면 바로
//      서비스워커 등록 해제 + Cache Storage 전부 삭제 후 새로고침.
//   (2026-10-08: 예전에는 무조건 15초를 기다려 「업데이트 중」이 한참 멈춰 보였다)
// 사람이 누른 갱신은 기대 빌드를 sessionStorage 에 적어 두고, 새로고침 뒤 checkUpdateResult() 로 성공 여부를 알린다.
//
// 배포 직후 잠깐 version.json 은 새것인데 CDN 이 옛 번들을 주는 구간이 있다. 그때 2)를 반복하면
// 무한 새로고침이 되므로, 같은 빌드에 대한 시도는 localStorage 기록으로 10분에 한 번만 한다.
// 기록을 남길 수 없는 환경이면 강제 갱신 자체를 하지 않는다.

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : { version: 'dev', commit: 'dev', build: 'dev' };

/** 화면 표시용: "v1.0.0 · 4b62476" — 번호는 사람이 올리고, 커밋으로 정확한 빌드를 판별한다 */
export const formatVersion = (v = APP_VERSION) => `v${v.version} · ${v.commit}`;

export const UPDATE_ATTEMPT_KEY = 'app_update_attempt';
export const RETRY_GUARD_MS = 10 * 60 * 1000;
const SW_UPDATE_WAIT_MS = 8000;
export const UPDATE_EXPECT_KEY = 'app_update_expect';

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

/**
 * 주·부 버전이 바뀐 "중대한" 업데이트인지. 패치(평소 배포)는 아니다.
 * 홈의 「업데이트」 버튼은 이때만 뜬다. 평소 배포는 다음에 앱을 열 때 서비스워커가 조용히 바꾼다.
 */
export const isMajorUpdate = (current, latest) => {
    const majorMinor = (v) => (typeof v === 'string' ? v.split('.').slice(0, 2).join('.') : null);
    const latestMM = majorMinor(latest?.version);
    return isOutdated(current, latest) && !!latestMM && latestMM !== majorMinor(current.version);
};

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
 * force: 사람이 직접 누른 경우. 반복 방지 기록 없이 바로 진행한다 (누를 때마다 한 번이라 루프가 없다).
 * @returns {Promise<'skipped'|'sw-updated'|'hard-reloaded'>}
 */
export const applyUpdate = async (latest, { storage = getStorage(), now = Date.now(), force = false } = {}) => {
    if (!force) {
        if (!storage || !canAttempt(readAttempt(storage), latest.build, now)) return 'skipped';
        try {
            storage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({ build: latest.build, at: now }));
        } catch {
            return 'skipped';
        }
    }

    if (force) {
        try { sessionStorage.setItem(UPDATE_EXPECT_KEY, latest.build); } catch { /* 결과 안내만 못 할 뿐 */ }
    }

    const sw = navigator.serviceWorker;
    const reg = await sw?.getRegistration().catch(() => null);
    if (reg) {
        let switched = false;
        const changed = waitForControllerChange(SW_UPDATE_WAIT_MS).then((v) => { switched = v; return v; });
        await reg.update().catch(() => {});
        await Promise.resolve(); // update 중에 넘겨받았으면 switched 반영
        // 새 서비스워커를 받는 중일 때만 기다린다. 받을 게 없으면 기다릴 이유가 없다
        if (switched || ((reg.installing || reg.waiting) && await changed)) return 'sw-updated';
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

// 홈 헤더는 페이지를 오갈 때마다 다시 마운트된다. 확인 요청은 몇 분에 한 번만 보낸다.
const CHECK_CACHE_MS = 5 * 60 * 1000;
let lastCheck = null; // { at, promise }

/** 중대한 새 빌드(부 버전 이상)가 있으면 그 정보, 없거나 확인 실패면 null */
export const checkForUpdate = ({ now = Date.now(), fetchImpl } = {}) => {
    if (!lastCheck || now - lastCheck.at >= CHECK_CACHE_MS) {
        lastCheck = {
            at: now,
            promise: fetchLatestVersion(fetchImpl).then((latest) => (isMajorUpdate(APP_VERSION, latest) ? latest : null)),
        };
    }
    return lastCheck.promise;
};

/**
 * 사람이 누른 갱신 뒤 첫 실행에서 한 번: 'ok'(새 빌드로 바뀜) | 'failed'(아직 옛 빌드) | null(누른 적 없음)
 */
export const checkUpdateResult = (current = APP_VERSION) => {
    let expected = null;
    try {
        expected = sessionStorage.getItem(UPDATE_EXPECT_KEY);
        if (expected) sessionStorage.removeItem(UPDATE_EXPECT_KEY);
    } catch {
        return null;
    }
    if (!expected) return null;
    return expected === current.build ? 'ok' : 'failed';
};

export const resetUpdateCheckCache = () => {
    lastCheck = null;
};
