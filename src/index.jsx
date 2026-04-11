import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';


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


