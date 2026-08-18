import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// autoUpdate로 새 서비스워커가 활성화돼도 이미 열린 탭의 JavaScript는 자동으로
// 교체되지 않는다. 공개 API 키 교체처럼 구 번들이 즉시 무효가 되는 배포에서는
// 페이지까지 다시 로드해야 새 설정을 사용한다.
if ('serviceWorker' in navigator) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
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


