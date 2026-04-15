import React, { useState, useEffect, useRef } from 'react';
import './MurderMysteryTimer.css';

function MurderMysteryTimerModal({ onClose }) {
    const [isRunning, setIsRunning] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [targetSeconds, setTargetSeconds] = useState(600); // 기본 10분
    const [isSettingMode, setIsSettingMode] = useState(true); // 초기 설정 모드
    const [inputMinutes, setInputMinutes] = useState('10');
    const intervalRef = useRef(null);
    const hasPlayedSoundRef = useRef(false);

    // 음성 알림 재생
    const playAlertSound = () => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800; // 800Hz
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);

            // 반복 재생 (3회)
            for (let i = 1; i < 3; i++) {
                const startTime = audioContext.currentTime + i * 0.7;
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.frequency.value = 800;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, startTime);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
                osc.start(startTime);
                osc.stop(startTime + 0.5);
            }
        } catch (err) {
            console.log('Audio not available');
        }
    };

    // 초기 시간 설정
    const setPreset = (minutes) => {
        setInputMinutes(String(minutes));
        setTargetSeconds(minutes * 60);
        setElapsedSeconds(0);
        hasPlayedSoundRef.current = false;
    };

    // 커스텀 시간 설정 적용
    const applyCustomTime = () => {
        const minutes = parseInt(inputMinutes) || 0;
        setTargetSeconds(minutes * 60);
        setElapsedSeconds(0);
        setIsSettingMode(false);
        hasPlayedSoundRef.current = false;
    };

    // 설정 완료 후 타이머 시작
    const startTimer = () => {
        setIsSettingMode(false);
        setIsRunning(true);
    };

    // 타이머 시작/중지
    const toggleTimer = () => {
        setIsRunning(!isRunning);
    };

    // 타이머 초기화
    const resetTimer = () => {
        setIsRunning(false);
        setElapsedSeconds(0);
        hasPlayedSoundRef.current = false;
    };

    // 타이머 카운트 업
    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setElapsedSeconds((prev) => {
                    const next = prev + 1;
                    // 타이머 끝남
                    if (next >= targetSeconds && !hasPlayedSoundRef.current) {
                        hasPlayedSoundRef.current = true;
                        playAlertSound();
                        setIsRunning(false);
                    }
                    return next;
                });
            }, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isRunning, targetSeconds]);

    // 초를 MM:SS 형식으로 변환
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    // 남은 시간 계산
    const remainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
    const isTimeUp = remainingSeconds === 0 && elapsedSeconds > 0;

    return (
        <div className="murder-mystery-modal-overlay" onClick={onClose}>
            <div className="murder-mystery-modal" onClick={(e) => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="mm-header">
                    <h2>🔪 머더 미스터리 타이머</h2>
                    <button className="mm-close-btn" onClick={onClose}>✕</button>
                </div>

                {isSettingMode ? (
                    // 초기 시간 설정 모드
                    <div className="mm-setting-mode">
                        <p style={{ color: '#888', marginBottom: '20px' }}>시간을 선택하세요</p>

                        {/* 빠른 설정 버튼 */}
                        <div className="mm-preset-buttons">
                            {[5, 10, 15, 20, 30].map((min) => (
                                <button
                                    key={min}
                                    className={`mm-preset-btn ${inputMinutes === String(min) ? 'active' : ''}`}
                                    onClick={() => setPreset(min)}
                                >
                                    {min}분
                                </button>
                            ))}
                        </div>

                        {/* 커스텀 시간 입력 */}
                        <div className="mm-custom-input">
                            <input
                                type="number"
                                min="1"
                                max="120"
                                value={inputMinutes}
                                onChange={(e) => setInputMinutes(e.target.value)}
                                placeholder="분 입력"
                            />
                            <span style={{ marginLeft: '8px', color: '#888' }}>분</span>
                        </div>

                        {/* 적용 및 시작 버튼 */}
                        <button className="mm-btn mm-btn-start" onClick={startTimer} style={{ width: '100%', marginTop: '20px' }}>
                            ▶️ 타이머 시작
                        </button>
                    </div>
                ) : (
                    // 타이머 실행 모드
                    <>
                        {/* 큰 타이머 표시 */}
                        <div className={`mm-timer-display ${isTimeUp ? 'time-up' : ''}`}>
                            {formatTime(remainingSeconds)}
                        </div>

                        {isTimeUp && <div className="mm-time-up-text">⏰ 시간 끝!</div>}

                        {/* 컨트롤 버튼 */}
                        <div className="mm-controls">
                            <button
                                className={`mm-btn mm-btn-start ${isRunning ? 'running' : ''}`}
                                onClick={toggleTimer}
                            >
                                {isRunning ? '⏸ 일시정지' : '▶️ 시작'}
                            </button>
                            <button className="mm-btn mm-btn-reset" onClick={resetTimer}>
                                🔄 초기화
                            </button>
                        </div>

                        {/* 시간 재설정 버튼 */}
                        <button
                            className="mm-btn mm-btn-close-main"
                            onClick={() => setIsSettingMode(true)}
                            style={{ marginBottom: '10px' }}
                        >
                            ⚙️ 시간 재설정
                        </button>

                        {/* 닫기 버튼 */}
                        <button className="mm-btn mm-btn-close-main" onClick={onClose}>
                            닫기
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default MurderMysteryTimerModal;
