import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// autoUpdate로 새 서비스워커가 활성화돼도 이미 열린 탭의 JavaScript는 자동으로
// 교체되지 않는다. 공개 API 키 교체처럼 구 번들이 즉시 무효가 되는 배포에서는
// 페이지까지 다시 로드해야 새 설정을 사용한다.
if ('serviceWorker' in navigator) {
    let reloadingForUpdate = false;

    // 조작 중에 새로고침하면 열려 있던 모달과 선택이 통째로 날아간다.
    // 키오스크에서는 수령·반납을 누른 직후 화면이 첫 페이지로 돌아가 "눌러도 아무 일이
    // 없는" 것처럼 보인다. 모달이 하나도 없을 때까지 미룬다.
    const hasOpenModal = () =>
        document.querySelector('.kiosk-modal-overlay, .modal-overlay') !== null;

    const reloadWhenIdle = () => {
        if (!hasOpenModal()) {
            window.location.reload();
            return;
        }
        console.log('[SW] 새 버전 준비됨 — 조작이 끝나면 새로고침합니다.');
        setTimeout(reloadWhenIdle, 3000);
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        reloadWhenIdle();
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


