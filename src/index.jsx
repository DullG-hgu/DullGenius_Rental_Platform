import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// autoUpdate로 새 서비스워커가 활성화돼도 이미 열린 탭의 JavaScript는 자동으로
// 교체되지 않는다. 다만 바로 새로고침하면 보던 화면·고르던 선택이 눈앞에서 날아가므로
// 앱이 뒤로 갈 때(화면이 가려질 때) 새로고침한다. 그 전에 닫으면 다음 실행이 새 버전이다.
// 지금 화면도 바로 바꿔야 하는 배포는 minor 를 올려 헤더 「업데이트」 버튼으로 알린다.
// 키오스크는 화면이 가려지지 않으니 useKioskAutoUpdate 가 화면보호기 때 새로고침한다.
if ('serviceWorker' in navigator) {
    // 첫 설치(열 때 서비스워커가 없었음)의 controllerchange 는 새 버전이 아니다.
    // 예전엔 이것도 새로고침해서 첫 방문 몇 초 뒤 화면이 다시 열렸다 (2026-10-26, 월드컵 진입 때 새로고침으로 보고됨)
    const hadController = !!navigator.serviceWorker.controller;
    let pending = false;

    const reloadIfHidden = () => {
        if (document.visibilityState === 'hidden') window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || pending) return;
        pending = true;
        document.addEventListener('visibilitychange', reloadIfHidden);
    });
}


// Disable pinch zoom
document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
});
document.addEventListener('gesturechange', function (e) {
    e.preventDefault();
});
document.addEventListener('gestureend', function (e) {
    e.preventDefault();
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <App />
);


