// 회비 캡처 인증 목록 (spec_dues_capture.md §8 관리자). 회원 탭 위쪽에 놓인다.
// 자동 허가된 건은 훑어보고 되돌릴 수 있고, 「확인 필요」는 승인·반려한다.
import { useCallback, useEffect, useState } from 'react';
import { fetchAdminDuesProofs, reviewDuesProof, getDuesProofImageUrl, clearDuesProofImages } from '../api';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import { getCurrentSemester } from '../constants';

const STATUS_LABEL = { approved: '허가', pending_review: '확인 필요', rejected: '반려', revoked: '되돌림' };
const STATUS_COLOR = { approved: '#4ade80', pending_review: '#fbbf24', rejected: 'var(--admin-text-sub)', revoked: '#f87171' };
const REASON_LABEL = {
    account_match: '계좌 일치', holder_only: '예금주 이름만', amount_only: '금액만 일치',
    amount_mismatch: '금액 다름', amount_unread: '금액 안 읽힘', duplicate: '이미 쓰인 캡처',
    revoked_before: '되돌린 적 있음', ocr_unavailable: '글자 인식 서버 응답 없음', not_configured: '회비 금액 미설정',
    prepaid_claimed: '가입 전 납부 연결',
};
const SOURCE_LABEL = { site: '사이트', form: '입부 폼', admin: '관리자' };

// 직전 학기 ('2026-2' → '2026-1', '2026-1' → '2025-2')
const previousSemester = (semester) => {
    const [year, half] = semester.split('-').map(Number);
    return half === 2 ? `${year}-1` : `${year - 1}-2`;
};

const formatTime = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function DuesProofsCard({ onChanged }) {
    const { showToast } = useToast();
    const current = getCurrentSemester();
    const [semester, setSemester] = useState(current);
    const [data, setData] = useState(null);
    const [failed, setFailed] = useState(false);
    const [open, setOpen] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [confirm, setConfirm] = useState(null);

    const load = useCallback(async () => {
        try {
            setData(await fetchAdminDuesProofs(semester));
            setFailed(false);
        } catch (e) {
            console.error('[DuesProofsCard] 목록 불러오기 실패:', e);
            setFailed(true);
        }
    }, [semester]);

    useEffect(() => { load(); }, [load]);

    // DB 에 아직 기능이 없거나(배포 전) 읽지 못하면 카드를 숨긴다 — 회원 탭 본문은 그대로 쓴다
    if (failed || !data) return null;

    const rows = data.rows || [];
    const pending = rows.filter((r) => r.status === 'pending_review');
    const visible = open ? rows : pending;

    const act = async (row, action) => {
        setBusyId(row.id);
        try {
            await reviewDuesProof(row.id, action);
            showToast('처리했습니다.', { type: 'success' });
            await load();
            onChanged?.();
        } catch (e) {
            showToast('처리 실패: ' + e.message, { type: 'error' });
        } finally {
            setBusyId(null);
        }
    };

    const viewImage = async (row) => {
        try {
            window.open(await getDuesProofImageUrl(row.image_path), '_blank', 'noopener');
        } catch (e) {
            showToast('캡처를 열지 못했습니다: ' + e.message, { type: 'error' });
        }
    };

    const clearImages = async () => {
        try {
            const { total, failed: failedCount } = await clearDuesProofImages(semester);
            showToast(failedCount ? `${total}개 중 ${failedCount}개 파일을 지우지 못했습니다. Supabase 보관소에서 확인하세요.` : `캡처 ${total}개를 지웠습니다.`,
                { type: failedCount ? 'error' : 'success' });
            await load();
        } catch (e) {
            showToast('삭제 실패: ' + e.message, { type: 'error' });
        }
    };

    const btn = (extra = {}) => ({
        padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'transparent',
        color: 'var(--admin-text-main)', cursor: 'pointer', fontSize: '0.85em', ...extra,
    });

    return (
        <div className="admin-card" style={{ marginBottom: '20px' }}>
            <div className="admin-header-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0 }}>
                    회비 캡처 인증 · 확인 필요 <span style={{ color: pending.length ? '#fbbf24' : 'var(--admin-text-sub)' }}>{pending.length}건</span>
                </h4>
                <div className="admin-btn-row">
                    <select className="admin-input" value={semester} onChange={(e) => setSemester(e.target.value)} aria-label="학기">
                        <option value={current}>{current} (이번 학기)</option>
                        <option value={previousSemester(current)}>{previousSemester(current)}</option>
                    </select>
                    <button type="button" style={btn()} onClick={() => setOpen((v) => !v)}>{open ? '확인 필요만 보기' : `전체 ${rows.length}건 보기`}</button>
                </div>
            </div>
            <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', margin: '8px 0 0' }}>
                이 학기에 캡처로 허가된 사람 {data.approved_count}명 — 학기 말에 실제 입금 건수와 맞춰 보세요.
                {' '}입부 신청 수신 {data.application_count}건
                {data.application_last_received ? ` (마지막 ${formatTime(data.application_last_received)})` : ' (아직 받은 적 없음 — 입부 폼 연동을 확인하세요)'}
            </p>

            {visible.length > 0 && (
                <div className="admin-table-wrap" style={{ marginTop: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--admin-text-sub)' }}>
                                <th style={{ padding: '6px 8px' }}>이름 · 학번</th>
                                <th style={{ padding: '6px 8px' }}>상태</th>
                                <th style={{ padding: '6px 8px' }}>이유</th>
                                <th style={{ padding: '6px 8px' }}>시각</th>
                                <th style={{ padding: '6px 8px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((row) => (
                                <tr key={row.id} style={{ borderTop: '1px solid var(--admin-border)' }}>
                                    <td style={{ padding: '8px' }}>
                                        {row.name || '(미가입)'} · {row.student_id}
                                        {row.source !== 'site' && <span style={{ color: 'var(--admin-text-sub)' }}> · {SOURCE_LABEL[row.source] || row.source}</span>}
                                    </td>
                                    <td style={{ padding: '8px', color: STATUS_COLOR[row.status], fontWeight: 700 }}>{STATUS_LABEL[row.status] || row.status}</td>
                                    <td style={{ padding: '8px', color: 'var(--admin-text-sub)' }}>
                                        {REASON_LABEL[row.reason] || row.reason || '-'}
                                        {row.amount != null && ` · ${Number(row.amount).toLocaleString()}원`}
                                        {row.account_tail && ` · 계좌 끝 ${row.account_tail}`}
                                    </td>
                                    <td style={{ padding: '8px', color: 'var(--admin-text-sub)', whiteSpace: 'nowrap' }}>{formatTime(row.created_at)}</td>
                                    <td style={{ padding: '8px' }}>
                                        <div className="admin-btn-row">
                                            {row.image_path && row.source === 'site' && (
                                                <button type="button" style={btn()} onClick={() => viewImage(row)}>캡처 보기</button>
                                            )}
                                            {row.status === 'pending_review' && (
                                                <>
                                                    <button type="button" style={btn({ background: '#237a46', border: 'none', color: '#fff' })} disabled={busyId === row.id} onClick={() => act(row, 'approve')}>승인</button>
                                                    <button type="button" style={btn()} disabled={busyId === row.id} onClick={() => act(row, 'reject')}>반려</button>
                                                </>
                                            )}
                                            {row.status === 'approved' && (
                                                <button type="button" style={btn({ color: '#f87171' })} disabled={busyId === row.id}
                                                    onClick={() => setConfirm({
                                                        title: '허가 되돌리기',
                                                        message: `${row.name || row.student_id} 님의 회비 납부를 미납으로 되돌립니다. 이 학기에는 캡처를 다시 올려도 자동 허가되지 않습니다.`,
                                                        onConfirm: () => act(row, 'revoke'),
                                                    })}>되돌리기</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {open && data.images_left > 0 && (
                <div className="admin-btn-row" style={{ marginTop: '12px' }}>
                    <button type="button" style={btn({ color: '#f87171' })}
                        onClick={() => setConfirm({
                            title: `${semester} 캡처 지우기`,
                            message: `${semester} 학기에 받은 캡처 ${data.images_left}개를 보관소에서 지웁니다. 판정 기록은 남고 그림만 사라집니다. 되돌릴 수 없습니다.`,
                            onConfirm: clearImages,
                        })}>
                        {semester} 캡처 {data.images_left}개 지우기
                    </button>
                </div>
            )}

            <ConfirmModal
                isOpen={Boolean(confirm)}
                onClose={() => setConfirm(null)}
                onConfirm={() => { const run = confirm?.onConfirm; setConfirm(null); run?.(); }}
                title={confirm?.title || ''}
                message={confirm?.message || ''}
                type="danger"
            />
        </div>
    );
}
