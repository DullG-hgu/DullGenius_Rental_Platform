// src/kiosk/useKioskAutoUpdate.js
//
// 키오스크(크롬북)는 24시간 켜진 채 한 탭으로 몇 주씩 돈다. 브라우저는 페이지 이동이 없으면
// sw.js 를 다시 확인하지 않으므로, 여기서 직접 최신 빌드를 확인한다.
//
// - 확인: 켜질 때, 30분마다, 네트워크 재연결·화면 다시 보임 시
//   (운영 로그상 와이파이가 몇 시간씩 끊겼다 붙는 일이 있다 — 2026-10 확인)
// - 적용: 화면보호기(3분 무조작) 상태일 때만. 새벽에도 이용자가 있어 시각 기준은 쓰지 않는다.
import { useEffect, useRef } from 'react';
import { APP_VERSION, applyUpdate, fetchLatestVersion, isOutdated } from '../lib/appUpdate';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function useKioskAutoUpdate(isIdle, isIdleRef) {
    const pendingRef = useRef(null);

    const tryApply = () => {
        if (pendingRef.current && isIdleRef.current) applyUpdate(pendingRef.current);
    };

    useEffect(() => {
        if (!import.meta.env.PROD) return undefined;

        const check = async () => {
            const latest = await fetchLatestVersion();
            if (!isOutdated(APP_VERSION, latest)) return;
            pendingRef.current = latest;
            tryApply();
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') check();
        };

        check();
        const interval = setInterval(check, CHECK_INTERVAL_MS);
        window.addEventListener('online', check);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            window.removeEventListener('online', check);
            document.removeEventListener('visibilitychange', onVisible);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 사용 중에 새 빌드를 발견했으면 화면보호기로 넘어가는 순간 적용한다
    useEffect(() => {
        if (isIdle) tryApply();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isIdle]);
}
