// 모두의 티어 집계 방식 설명 모달 — 보정 점수 계산 (spec §6-2)
import React, { useId } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap.jsx';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.jsx';
import { DEFAULT_MIN_SAMPLE, SHRINK_K, SPLIT_SHARE } from './tierData';

const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

const TierMethodModal = ({ open, onClose, globalMean = 3, myOffset, myCount, minSample = DEFAULT_MIN_SAMPLE }) => {
    const titleId = useId();
    const ref = useFocusTrap({ active: open, onEscape: onClose });
    useBodyScrollLock(open);
    if (!open) return null;

    // 예시는 지금 전체 평균으로 계산
    const ex = (score, n) => {
        const off = (score - globalMean) * (n / (n + SHRINK_K));
        return { off, adj: score - off };
    };
    const allS = ex(5, 10);
    const allC = ex(2, 10);
    const oneS = ex(5, 1);

    return (
        <div className="tier-modal-backdrop" onClick={onClose}>
            <div ref={ref} className="tier-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}>
                <div className="tier-modal-head">
                    <h3 id={titleId}>모두의 티어 집계 방식</h3>
                    <button type="button" className="tier-modal-close" onClick={onClose} aria-label="닫기">✕</button>
                </div>

                <div className="tier-modal-body">
                    <section>
                        <h4>1. 등급의 뜻</h4>
                        <p>
                            정해진 기준 없이 「위로 갈수록 더 좋았던 머더」. 다른 머더와 견준 상대 순위.
                            각자 붙인 티어 이름과 상관없이 S~D 자리로 합산하고, 사람마다 다른 높낮이는 3번 보정으로 맞춤.
                        </p>
                    </section>

                    <section>
                        <h4>2. 점수</h4>
                        <p>S 5 · A 4 · B 3 · C 2 · D 1. 줄 안 순서는 본인 표에서만 쓰고 집계에는 안 씀.</p>
                    </section>

                    <section>
                        <h4>3. 사람별 보정</h4>
                        <p>
                            머더 평가에는 게임 자체보다 「같이 한 판이 즐거웠다」가 섞이기 쉬움.
                            뭐든 후하게 주는 사람과 짜게 주는 사람의 차이를 걷어 내려고, 사람마다 치우침을 빼고 합산.
                        </p>
                        <div className="tier-formula">
                            치우침 = (내 평균 − 전체 평균) × 평가 수 ÷ (평가 수 + {SHRINK_K})<br />
                            보정 점수 = 매긴 점수 − 치우침
                        </div>
                        <p>평가가 적은 사람은 성향을 알 수 없어 거의 빼지 않고, 많이 평가할수록 확실히 뺌.</p>
                        <table className="tier-example">
                            <caption>예시 · 지금 전체 평균 {globalMean.toFixed(1)}</caption>
                            <thead><tr><th>평가한 사람</th><th>치우침</th><th>S·C 한 표의 무게</th></tr></thead>
                            <tbody>
                                <tr><td>10개 전부 S</td><td>{fmt(allS.off)}</td><td>S → {allS.adj.toFixed(1)}</td></tr>
                                <tr><td>10개 전부 C</td><td>{fmt(allC.off)}</td><td>C → {allC.adj.toFixed(1)}</td></tr>
                                <tr><td>1개만 S</td><td>{fmt(oneS.off)}</td><td>S → {oneS.adj.toFixed(1)}</td></tr>
                            </tbody>
                        </table>
                        {myOffset != null && (
                            <p className="tier-my-offset">내 치우침 {fmt(myOffset)} (평가 {myCount}개 기준)</p>
                        )}
                    </section>

                    <section>
                        <h4>4. 등급 정하기</h4>
                        <p>
                            게임마다 보정 점수 평균을 반올림 — 4.5 이상 S · 3.5 이상 A · 2.5 이상 B · 1.5 이상 C · 그 아래 D.
                            같은 줄 안은 보정 평균 높은 순, 같으면 평가 인원 많은 순.
                            평가 {minSample}명 미만은 「평가 모으는 중」.
                        </p>
                    </section>

                    <section>
                        <h4>5. 호불호</h4>
                        <p>
                            A 이상과 C 이하가 각각 {Math.round(SPLIT_SHARE * 100)}% 이상이면 「호불호」 표시.
                            판 분위기·취향 따라 크게 갈린 게임. 게임을 누르면 나오는 분포 막대는 보정 전 원래 등급.
                        </p>
                    </section>

                    <section>
                        <h4>6. 아직 못 거르는 것</h4>
                        <p>
                            「그날 그 판만 특별히 좋았다」는 한 사람의 다른 평가로는 알 수 없음.
                            같이 한 회원 기록이 생기면(파티 맺기) 같은 판의 평가를 한 묶음으로 세는 방식 추가 예정.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default TierMethodModal;
