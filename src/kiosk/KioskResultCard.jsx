// src/kiosk/KioskResultCard.jsx
// 수령·반납 처리 중 / 결과를 키오스크 모달 위에 크게 보여준다.
//
// 예전에는 결과를 토스트로만 알렸는데, 토스트가 키오스크 모달(z-index 20000) 뒤에 깔려
// 다른 대기자가 남아 모달이 열린 채로 있으면 성공·실패가 모두 보이지 않았다.
// "눌린 게 맞나?" 싶어 다시 누르는 원인이었다.
import React, { useEffect, useRef } from 'react';
import './KioskResultCard.css';

const AUTO_DISMISS_MS = 4000;

/**
 * result:
 *   { phase: 'processing', label, count }
 *   { phase: 'done', verb, successes: [name], failures: [{ name, reason }],
 *     uncertain: [name], detail }
 */
function KioskResultCard({ result, onDismiss }) {
    const isDone = result?.phase === 'done';
    const failures = isDone ? result.failures : [];
    const uncertain = isDone ? result.uncertain : [];
    const successes = isDone ? result.successes : [];
    const needsAck = failures.length > 0 || uncertain.length > 0;

    // 부모(KioskPage)는 시계 때문에 매초 다시 그려져 onDismiss 가 계속 새로 만들어진다.
    // 타이머가 그때마다 리셋되지 않도록 최신 콜백은 ref 로만 들고 있는다.
    const dismissRef = useRef(onDismiss);
    useEffect(() => { dismissRef.current = onDismiss; });

    // 성공만 있으면 잠깐 보여주고 스스로 닫힌다. 실패·확인 필요는 사람이 닫을 때까지 둔다.
    useEffect(() => {
        if (!isDone || needsAck) return undefined;
        const t = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [isDone, needsAck]);

    if (!result) return null;

    if (!isDone) {
        return (
            <div className="krc-layer" role="status" aria-live="polite">
                <div className="krc-panel">
                    <div className="krc-icon krc-icon--processing" aria-hidden="true" />
                    <div className="krc-title">{result.label}</div>
                    <div className="krc-sub">{result.count}개 처리 중이에요. 잠시만 기다려 주세요.</div>
                </div>
            </div>
        );
    }

    // 결과를 모르는 건(응답 지연)만 있으면 실패로 단정하지 않는다 → 주황
    const tone = !needsAck ? 'ok' : failures.length > 0 && successes.length === 0 && uncertain.length === 0 ? 'fail' : 'mixed';
    const title = tone === 'ok'
        ? `${successes.length}개 ${result.verb} 완료!`
        : successes.length > 0
            ? `${successes.length}개 ${result.verb} 완료, 확인이 필요한 게임이 있어요`
            : failures.length === 0
                ? '응답이 늦어요'
                : `${result.verb}하지 못했어요`;

    return (
        <div
            className="krc-layer"
            role="alertdialog"
            aria-live="assertive"
            // 성공만이면 아무 데나 눌러 닫는다
            onClick={needsAck ? undefined : onDismiss}
        >
            <div className="krc-panel">
                <div className={`krc-icon krc-icon--${tone}`} aria-hidden="true">
                    {tone === 'ok' ? (
                        <svg viewBox="0 0 52 52"><path className="krc-check" d="M14 27 l8 8 l16 -18" /></svg>
                    ) : (
                        <span>{tone === 'fail' ? '✕' : '!'}</span>
                    )}
                </div>
                <div className="krc-title">{title}</div>

                {successes.length > 0 && (
                    <ul className="krc-list krc-list--ok">
                        {successes.map((name, i) => <li key={`s${i}`}>✓ {name}</li>)}
                    </ul>
                )}
                {result.detail && successes.length > 0 && (
                    <div className="krc-detail">{result.detail}</div>
                )}
                {failures.length > 0 && (
                    <ul className="krc-list krc-list--fail">
                        {failures.map((f, i) => (
                            <li key={`f${i}`}><strong>{f.name}</strong><span>{f.reason}</span></li>
                        ))}
                    </ul>
                )}
                {uncertain.length > 0 && (
                    <div className="krc-uncertain">
                        <strong>{uncertain.join(', ')}</strong>
                        <span>서버 응답이 늦어 결과를 확인하지 못했어요. 목록을 새로 불러왔으니,
                            목록에서 사라졌다면 처리된 거예요. 남아 있으면 다시 시도하거나 운영진에게 알려 주세요.</span>
                    </div>
                )}

                {needsAck ? (
                    <button type="button" className="krc-ack" onClick={onDismiss}>확인</button>
                ) : (
                    <>
                        <div className="krc-hint">화면을 누르면 닫혀요</div>
                        <div className="krc-timer" style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }} />
                    </>
                )}
            </div>
        </div>
    );
}

export default KioskResultCard;
