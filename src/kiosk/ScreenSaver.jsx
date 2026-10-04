// src/kiosk/ScreenSaver.jsx
import React, { useState, useEffect } from 'react';

// 깨운 직후 이 시간 동안 들어오는 클릭은 버린다 (손가락 떨림·두 번 닿음 대비)
const WAKE_GUARD_MS = 400;

// 깨우기는 click 에서만 한다.
//
// 예전에는 onTouchStart 에서도 깨웠다. 그러면 손가락이 닿는 순간 화면보호기가 사라지고
// 대시보드가 그려진 뒤, 손을 뗄 때 브라우저가 만든 click 이 그 자리의 버튼에 떨어졌다.
// (오른쪽 위를 누르면 타이머가, 구석을 누르면 수령/반납이 열렸다)
// React 의 touchstart 는 passive 라 preventDefault 로도 막을 수 없다.
// click 시점에는 아직 화면보호기가 이벤트 대상이므로, 깨우는 탭이 아래로 새지 않는다.
function ScreenSaver({ onWake }) {
    const [position, setPosition] = useState({ top: 30, left: 30 });

    // Pixel Shift (10초마다 위치 이동)
    useEffect(() => {
        const interval = setInterval(() => {
            const top = Math.floor(Math.random() * 80) + 10; // 10% ~ 90%
            const left = Math.floor(Math.random() * 80) + 10;
            setPosition({ top, left });
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleClick = (e) => {
        e.preventDefault();
        // 전파는 막지 않는다. window 의 click 리스너가 유휴 타이머를 다시 건다.

        // 깨어난 직후의 클릭을 capture 단계에서 삼킨다
        const until = Date.now() + WAKE_GUARD_MS;
        const swallow = (ev) => {
            if (Date.now() > until) {
                window.removeEventListener('click', swallow, true);
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
        };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), WAKE_GUARD_MS + 50);

        onWake();
    };

    return (
        <div className="screen-saver" onClick={handleClick}>
            <div className="saver-content" style={{ top: `${position.top}%`, left: `${position.left}%` }}>
                🎲 DullGenius
                <div style={{ fontSize: "1rem", marginTop: "10px" }}>화면을 한 번 터치하면 켜져요</div>
            </div>
        </div>
    );
}

export default ScreenSaver;
