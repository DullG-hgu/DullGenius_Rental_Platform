// src/hooks/useAppUpdate.js
//
// 일반 사용자 화면용: 부 버전 이상이 바뀐 빌드가 있으면 알려주기만 하고, 갱신은 사용자가 눌렀을 때만 한다.
// 패치(평소 배포)는 알리지 않는다 — 다음에 앱을 열 때 서비스워커가 조용히 바꾼다.
// (키오스크는 무인이라 화면보호기 때 자동 적용 — src/kiosk/useKioskAutoUpdate.js)
import { useEffect, useState } from 'react';
import { applyUpdate, checkForUpdate } from '../lib/appUpdate';

export default function useAppUpdate() {
    const [latest, setLatest] = useState(null);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        if (!import.meta.env.PROD) return undefined;
        let alive = true;
        const check = () => checkForUpdate().then((found) => {
            if (alive) setLatest(found);
        });
        const onVisible = () => {
            if (document.visibilityState === 'visible') check();
        };

        check();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            alive = false;
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    const update = async () => {
        if (!latest || updating) return;
        setUpdating(true);
        // 새로고침되면 이 화면은 사라진다. 'sw-updated' 면 index.jsx 가 새로고침한다.
        await applyUpdate(latest, { force: true });
    };

    return { updateAvailable: !!latest, updating, update };
}
