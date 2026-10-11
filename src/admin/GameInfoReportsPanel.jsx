// 게임 정보 오류 신고 목록 (신고/신청 관리 탭 → 「정보 오류」)
// 신고는 월드컵 카드 ⚠ 등에서 들어온다 (game_info_reports). 신고 당시 값과 지금 값을 나란히 보여준다.
// 「✏️ 바로 수정」으로 여기서 게임을 고친다. 신고 처리 상태는 저장과 별개로 운영자가 직접 바꾼다.
import { useCallback, useEffect, useState } from 'react';
import { fetchGameInfoReports, setGameInfoReportStatus } from '../api_fun';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import GameFormModal from './GameFormModal';
import { saveGameEdit } from './saveGameEdit';

const FIELD_LABEL = { players: '인원수', playtime: '플레이 시간', image: '이미지', name: '이름', other: '기타' };
const SOURCE_LABEL = { worldcup: '이상형 월드컵', game_detail: '게임 상세', other: '기타' };
const STATUS_OPTIONS = [['pending', '대기'], ['resolved', '처리 완료'], ['dismissed', '반려'], [null, '전체']];
const STATUS_LABEL = { pending: '대기', resolved: '처리 완료', dismissed: '반려' };

const playersText = (c) => {
    if (!c?.min_players && !c?.max_players) return '정보 없음';
    if (c.min_players === c.max_players || !c.max_players) return `${c.min_players}인`;
    return `${c.min_players ?? 1}~${c.max_players}인`;
};

const currentValue = (r) => {
    if (r.field === 'players') return playersText(r.current);
    if (r.field === 'playtime') return r.current?.playingtime || '정보 없음';
    if (r.field === 'name') return r.game_name;
    return null;
};

const CARD = {
    background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: '8px',
    padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--admin-text-main)',
};
const BTN = {
    padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--admin-border)',
    background: 'var(--admin-card-bg)', color: 'var(--admin-text-main)', cursor: 'pointer',
};

export default function GameInfoReportsPanel({ onPendingCount, games = [], gamesLoading = false, onReloadGames }) {
    const { showToast } = useToast();
    const [status, setStatus] = useState('pending');
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [editingGame, setEditingGame] = useState(null);
    const [pendingSave, setPendingSave] = useState(null); // 확인 대기 중인 폼 값
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setError(null);
        setItems(null);
        fetchGameInfoReports(status)
            .then((list) => {
                setItems(list ?? []);
                if (status === 'pending') onPendingCount?.((list ?? []).length);
            })
            .catch((e) => setError(e?.message || '신고 목록을 불러오지 못했습니다.'));
    }, [status, onPendingCount]);

    useEffect(() => { load(); }, [load]);

    const change = (report, next) => {
        setBusyId(report.id);
        setGameInfoReportStatus(report.id, next)
            .then(() => {
                showToast(`「${report.game_name}」 신고를 ${STATUS_LABEL[next]}(으)로 바꿨어요.`, { type: 'success' });
                // 지금 보는 필터에서 빠지는 항목은 목록에서 뺀다
                setItems((prev) => (status && status !== next
                    ? prev.filter((r) => r.id !== report.id)
                    : prev.map((r) => (r.id === report.id ? { ...r, status: next } : r))));
                if (report.status === 'pending' || next === 'pending') {
                    fetchGameInfoReports('pending').then((l) => onPendingCount?.((l ?? []).length)).catch(() => {});
                }
            })
            .catch((e) => showToast(e?.message || '상태를 바꾸지 못했습니다.', { type: 'error' }))
            .finally(() => setBusyId(null));
    };

    const saveEdit = async () => {
        const game = editingGame;
        const formData = pendingSave;
        setSaving(true);
        try {
            await saveGameEdit(game.id, formData, showToast);
            showToast(`「${formData.name}」 정보를 수정했어요.`, { type: 'success' });
            setEditingGame(null);
            onReloadGames?.();
            load(); // 「지금」 값 갱신
        } catch (e) {
            console.error('Game edit error:', e);
            showToast('수정 실패: ' + (e?.message || String(e)), { type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0' }}>
            <div className="admin-btn-row" role="group" aria-label="처리 상태">
                {STATUS_OPTIONS.map(([key, label]) => (
                    <button
                        key={label}
                        type="button"
                        aria-pressed={status === key}
                        onClick={() => setStatus(key)}
                        style={{ ...BTN, background: status === key ? '#667eea' : BTN.background, color: status === key ? '#fff' : BTN.color }}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>
                게임 정보(인원수·플레이 시간·이미지·이름)가 이상하다는 신고예요. 「✏️ 바로 수정」으로 고친 뒤 완료 처리를 눌러 주세요.
            </div>

            {error && (
                <div role="alert" style={{ ...CARD, color: '#e74c3c' }}>
                    {error} <button type="button" style={BTN} onClick={load}>다시 시도</button>
                </div>
            )}
            {!error && items === null && <div style={{ color: 'var(--admin-text-sub)', padding: '20px', textAlign: 'center' }}>불러오는 중…</div>}
            {items?.length === 0 && (
                <div style={{ color: 'var(--admin-text-sub)', padding: '20px', textAlign: 'center' }}>
                    {status === 'pending' ? '처리할 신고가 없어요.' : '해당하는 신고가 없어요.'}
                </div>
            )}

            {items?.map((r) => {
                const now = currentValue(r);
                const game = r.game_id ? games.find((g) => g.id === r.game_id) : null;
                return (
                    <div key={r.id} style={CARD}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                            <strong>{r.game_name}</strong>
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>
                                {new Date(r.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                                {' · '}{SOURCE_LABEL[r.source] ?? r.source}
                                {' · '}{r.is_member ? (r.reporter_name ? `${r.reporter_name}(회원)` : '회원') : '비회원'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ padding: '2px 10px', borderRadius: '999px', background: 'rgba(230, 126, 34, 0.2)', color: '#e67e22', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                {FIELD_LABEL[r.field] ?? r.field}
                            </span>
                            {r.status !== 'pending' && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>{STATUS_LABEL[r.status]}</span>
                            )}
                        </div>
                        {(r.shown_value || now) && r.field !== 'image' && (
                            <div style={{ fontSize: '0.9rem' }}>
                                신고 당시: <b>{r.shown_value || '-'}</b>
                                {now && <> → 지금: <b>{now}</b>{r.shown_value && now !== r.shown_value && <span style={{ color: '#2ecc71' }}> (수정됨)</span>}</>}
                            </div>
                        )}
                        {r.field === 'image' && r.current?.image && (
                            <img src={r.current.image} alt="" style={{ width: '72px', height: '72px', objectFit: 'contain', borderRadius: '6px', background: '#fff' }} />
                        )}
                        {r.note && (
                            <div style={{ fontSize: '0.9rem', padding: '8px 10px', borderRadius: '6px', background: 'var(--admin-bg)', whiteSpace: 'pre-wrap' }}>
                                {r.note}
                            </div>
                        )}
                        <div className="admin-btn-row">
                            {r.game_id && (
                                <a href={`/game/${r.game_id}`} target="_blank" rel="noopener noreferrer" style={{ ...BTN, textDecoration: 'none' }}>게임 보기</a>
                            )}
                            {game && (
                                <button type="button" style={{ ...BTN, borderColor: '#8e44ad' }} onClick={() => setEditingGame(game)}>✏️ 바로 수정</button>
                            )}
                            {r.status === 'pending' ? (
                                <>
                                    <button type="button" style={BTN} disabled={busyId === r.id} onClick={() => change(r, 'resolved')}>완료 처리</button>
                                    <button type="button" style={BTN} disabled={busyId === r.id} onClick={() => change(r, 'dismissed')}>반려 처리</button>
                                </>
                            ) : (
                                <button type="button" style={BTN} disabled={busyId === r.id} onClick={() => change(r, 'pending')}>대기로 되돌리기</button>
                            )}
                        </div>
                    </div>
                );
            })}

            <GameFormModal
                isOpen={!!editingGame}
                onClose={() => setEditingGame(null)}
                initialData={editingGame}
                onSubmit={(formData) => setPendingSave(formData)}
                games={games} // 본판 연결 후보
                gamesLoading={gamesLoading}
                title="✏️ 게임 정보 수정"
                busy={saving}
            />
            <ConfirmModal
                isOpen={!!pendingSave}
                onClose={() => setPendingSave(null)}
                onConfirm={saveEdit}
                title="게임 정보 수정"
                message={`[${pendingSave?.name}] 정보를 수정하시겠습니까?`}
            />
        </div>
    );
}
