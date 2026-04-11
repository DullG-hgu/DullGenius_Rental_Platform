// src/admin/PointsTab.js
// 포인트 시스템 대시보드 및 설정

import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { fetchGlobalPointHistory, fetchLeaderboard } from '../api';

function PointsTab() {
    const [selectedView, setSelectedView] = useState('dashboard'); // 'dashboard', 'info', 'vote'

    return (
        <div>
            {/* 서브 탭 */}
            <div style={styles.subTabContainer}>
                <SubTabButton
                    label="📊 대시보드"
                    isActive={selectedView === 'dashboard'}
                    onClick={() => setSelectedView('dashboard')}
                />
                <SubTabButton
                    label="💰 포인트 제도 안내"
                    isActive={selectedView === 'info'}
                    onClick={() => setSelectedView('info')}
                />
                <SubTabButton
                    label="🗳️ 신규 게임 투표"
                    isActive={selectedView === 'vote'}
                    onClick={() => setSelectedView('vote')}
                />
            </div>

            {/* 컨텐츠 영역 */}
            {selectedView === 'dashboard' && <DashboardView />}
            {selectedView === 'info' && <PointsInfoView />}
            {selectedView === 'vote' && <VoteView />}
        </div>
    );
}

const SubTabButton = ({ label, isActive, onClick }) => (
    <button
        onClick={onClick}
        style={{
            ...styles.subTab,
            background: isActive ? 'var(--admin-primary)' : 'var(--admin-card-bg)',
            color: isActive ? '#121212' : 'var(--admin-text-sub)',
            border: '1px solid var(--admin-border)'
        }}
    >
        {label}
    </button>
);

// ===== 대시보드 뷰 =====
function DashboardView() {
    const [leaderboard, setLeaderboard] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [rankData, historyData] = await Promise.all([
                fetchLeaderboard(5),
                fetchGlobalPointHistory(20)
            ]);
            setLeaderboard(rankData || []);
            setHistory(historyData || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div style={styles.loading}>데이터 로딩 중...</div>;

    return (
        <div style={styles.dashboardGrid}>
            {/* 왼쪽: 랭킹 */}
            <div className="admin-card">
                <h3 style={styles.cardTitle}>🏆 포인트 랭킹 (Top 5)</h3>
                <div style={styles.rankList}>
                    {leaderboard.map((user, index) => (
                        <div key={user.id} style={styles.rankItem}>
                            <div style={styles.rankBadge}>{index + 1}</div>
                            <div style={styles.rankUser}>
                                <div style={styles.rankName}>{user.name}</div>
                                <div style={styles.rankId}>{user.student_id}</div>
                            </div>
                            <div style={styles.rankPoint}>
                                {user.current_points?.toLocaleString()} P
                            </div>
                        </div>
                    ))}
                    {leaderboard.length === 0 && <div style={styles.emptyState}>데이터 없음</div>}
                </div>
            </div>

            {/* 오른쪽: 최근 활동 */}
            <div className="admin-card">
                <h3 style={styles.cardTitle}>📜 최근 포인트 활동</h3>
                <div style={styles.historyList}>
                    {history.map((log) => (
                        <div key={log.id} style={styles.logItem}>
                            <div style={styles.logIcon}>{getLogIcon(log.reason)}</div>
                            <div style={styles.logContent}>
                                <div style={styles.logTitle}>
                                    <span style={{ fontWeight: 'bold' }}>{log.profiles?.name || '알 수 없음'}</span>
                                    <span style={{ margin: '0 5px', color: '#666' }}>•</span>
                                    <span>{getReasonLabel(log.reason)}</span>
                                </div>
                                <div style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</div>
                            </div>
                            <div style={{
                                ...styles.logAmount,
                                color: log.amount > 0 ? '#4cd137' : '#e84118'
                            }}>
                                {log.amount > 0 ? '+' : ''}{log.amount}
                            </div>
                        </div>
                    ))}
                    {history.length === 0 && <div style={styles.emptyState}>활동 내역 없음</div>}
                </div>
            </div>
        </div>
    );
}

// 헬퍼 함수들
const getLogIcon = (reason) => {
    if (reason.includes('RENTAL')) return '📦';
    if (reason.includes('RETURN')) return '↩️';
    if (reason.includes('MATCH')) return '⚔️';
    if (reason.includes('REVIEW')) return '✍️';
    return '💰';
};

const getReasonLabel = (reason) => {
    switch (reason) {
        case 'RENTAL_REWARD': return '대여 보상';
        case 'RETURN_ON_TIME': return '정시 반납';
        case 'RETURN_LATE': return '연체 반납';
        case 'MATCH_WIN': return '매치 승리';
        case 'MATCH_PARTICIPATION': return '매치 참여';
        case 'REVIEW_REWARD': return '리뷰 작성';
        default: return reason;
    }
};

// ... (기존 PointsInfoView, VoteView 유지) ...
// 기존 코드 복사 붙여넣기 생략을 위해 전체 구조를 다시 잡습니다.
// 아래는 PointsInfoView와 VoteView를 포함한 전체 코드입니다.

function PointsInfoView() {
    return (
        <div className="admin-card">
            <h2 style={styles.sectionTitle}>💰 포인트 제도란?</h2>
            <div style={styles.infoCard}>
                <p style={styles.description}>
                    덜지니어스 포인트는 동아리 활동에 참여하면서 자연스럽게 쌓을 수 있는 보상 시스템입니다.
                    <br />
                    무료 대여 환경에서 <strong>적극적인 활동</strong>과 <strong>동아리 기여</strong>를 장려하기 위해 만들어졌습니다.
                </p>
            </div>

            <h3 style={styles.subTitle}>⭐ 포인트 적립 방법</h3>
            <div style={styles.grid}>
                <EarnCard icon="📦" title="대여 완료" points="+100P" description="게임을 대여하고 반납을 완료하면" />
                <EarnCard icon="⏰" title="정시 반납" points="+50P" description="기한 내 반납 시 보너스" />
                <EarnCard icon="🔥" title="주 2회 대여" points="+100P" description="일주일에 2번 이상 대여 시" />
                <EarnCard icon="🚀" title="월 5회 대여" points="+500P" description="한 달에 5번 이상 대여 시" />
                <EarnCard icon="✍️" title="리뷰 작성" points="+100P" description="게임 평점/리뷰 작성" />
            </div>

            <h3 style={styles.subTitle}>🎁 포인트 사용처</h3>
            <div style={styles.grid}>
                <UseCard icon="🗳️" title="신규 게임 투표" points="100~1,000P" description="원하는 게임 구매에 투표하세요" highlight />
                <UseCard icon="🏛️" title="동아리 회비 사용 투표" points="100~1,000P" description="책상, 주사위 세트, 책장 등 구매 투표" highlight />
                <UseCard icon="🏆" title="대회 참가비" points="500~2,000P" description="티츄 리그 등 대회 참가" />
            </div>
        </div>
    );
}

function VoteView() {
    const { showToast } = useToast();
    const [proposalName, setProposalName] = useState('');
    const [proposalLink, setProposalLink] = useState('');
    const [proposals, setProposals] = useState([
        { id: 1, name: '듄: 임페리움', link: 'https://boardgamegeek.com/boardgame/316554/dune-imperium', votes: 2500, voters: 5 },
        { id: 2, name: '윙스팬', link: 'https://boardgamegeek.com/boardgame/266192/wingspan', votes: 1800, voters: 3 },
        { id: 3, name: '테라포밍 마스', link: 'https://boardgamegeek.com/boardgame/167791/terraforming-mars', votes: 1200, voters: 2 },
    ]);

    const handleAddProposal = () => {
        if (!proposalName.trim()) {
            showToast('게임 이름을 입력해주세요. (체험판)', { type: "warning" });
            return;
        }
        const newProposal = {
            id: Date.now(),
            name: proposalName,
            link: proposalLink,
            votes: 0,
            voters: 0
        };
        setProposals([...proposals, newProposal]);
        setProposalName('');
        setProposalLink('');
        showToast('[체험판] 게임이 제안되었습니다! (실제 저장되지 않음)', { type: "success" });
    };

    return (
        <div className="admin-card">
            <h2 style={styles.sectionTitle}>🗳️ 신규 게임 투표</h2>
            <div style={styles.demoBanner}>
                <span style={{ fontSize: '1.2em' }}>🚧</span>
                <div>
                    <strong>체험판 모드 (Demo Mode)</strong>
                    <div style={{ fontSize: '0.9em', opacity: 0.9 }}>
                        이 기능은 현재 개발 중입니다. 투표 및 제안 기능은 <strong>시뮬레이션</strong>이며,
                        새로고침 시 데이터를 리셋합니다.
                    </div>
                </div>
            </div>

            <div style={styles.proposalForm}>
                <h3 style={styles.subTitle}>➕ 새 게임 제안하기</h3>
                <div style={styles.formRow}>
                    <input type="text" placeholder="게임 이름" value={proposalName} onChange={(e) => setProposalName(e.target.value)} className="admin-input" style={{ flex: 1 }} />
                    <input type="text" placeholder="BGG 링크 (선택)" value={proposalLink} onChange={(e) => setProposalLink(e.target.value)} className="admin-input" style={{ flex: 1 }} />
                    <button onClick={handleAddProposal} style={styles.addBtn}>제안하기</button>
                </div>
            </div>

            <div style={styles.voteList}>
                <h3 style={styles.subTitle}>📊 현재 투표 현황</h3>
                <div style={styles.proposalGrid}>
                    {proposals.sort((a, b) => b.votes - a.votes).map((proposal, index) => (
                        <ProposalCard key={proposal.id} proposal={proposal} rank={index + 1} />
                    ))}
                </div>
            </div>
        </div>
    );
}

const EarnCard = ({ icon, title, points, description }) => (
    <div style={styles.earnCard}>
        <div style={styles.earnIcon}>{icon}</div>
        <div style={styles.earnTitle}>{title}</div>
        <div style={styles.earnPoints}>{points}</div>
        <div style={styles.earnDesc}>{description}</div>
    </div>
);

const UseCard = ({ icon, title, points, description, highlight }) => (
    <div style={{
        ...styles.useCard,
        borderColor: highlight ? 'var(--admin-primary)' : 'var(--admin-border)',
        background: highlight ? 'rgba(187, 134, 252, 0.1)' : 'var(--admin-card-bg)'
    }}>
        <div style={styles.useIcon}>{icon}</div>
        <div style={styles.useTitle}>{title}</div>
        <div style={styles.usePoints}>{points}</div>
        <div style={styles.useDesc}>{description}</div>
    </div>
);

const ProposalCard = ({ proposal, rank }) => {
    const { showToast } = useToast();
    const [voteAmount, setVoteAmount] = useState('');

    const handleVote = () => {
        const amount = parseInt(voteAmount);
        if (!amount || amount < 100) {
            showToast('최소 100P부터 투표 가능합니다.', { type: "warning" });
            return;
        }
        showToast(`[체험판] ${proposal.name}에 ${amount}P 투표했습니다!`, { type: "success" });
        setVoteAmount('');
    };

    return (
        <div className="admin-card" style={{ padding: "20px" }}>
            <div style={styles.proposalHeader}>
                <span style={styles.proposalRank}>{rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `${rank}위`}</span>
                <span style={styles.proposalName}>{proposal.name}</span>
            </div>
            {proposal.link && <a href={proposal.link} target="_blank" rel="noopener noreferrer" style={styles.proposalLink}>📎 BGG 보기</a>}
            <div style={styles.proposalStats}>
                <strong style={{ fontSize: '1.5em', color: 'var(--admin-primary)' }}>{proposal.votes.toLocaleString()}P</strong>
                <div style={{ fontSize: '0.8em', color: 'var(--admin-text-sub)' }}>{proposal.voters}명 투표</div>
            </div>
            <div style={styles.voteInput}>
                <input type="number" placeholder="포인트" value={voteAmount} onChange={(e) => setVoteAmount(e.target.value)} className="admin-input" style={{ flex: 1 }} min="100" step="100" />
                <button onClick={handleVote} style={styles.voteBtn}>투표</button>
            </div>
        </div>
    );
};

const styles = {
    subTabContainer: { display: 'flex', gap: '10px', marginBottom: '30px', borderBottom: '2px solid var(--admin-border)', paddingBottom: '10px' },
    subTab: { padding: '10px 20px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.95rem', transition: 'all 0.2s' },
    sectionTitle: { fontSize: '1.8em', marginBottom: '20px', color: 'var(--admin-text-main)', borderBottom: '3px solid var(--admin-primary)', paddingBottom: '10px' },
    subTitle: { fontSize: '1.3em', marginTop: '30px', marginBottom: '15px', color: 'var(--admin-text-main)' },
    infoCard: { background: 'rgba(255, 255, 255, 0.05)', padding: '20px', borderRadius: '10px', marginBottom: '30px', borderLeft: '4px solid var(--admin-primary)' },
    description: { fontSize: '1em', lineHeight: '1.6', color: 'var(--admin-text-main)', margin: 0 },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' },
    earnCard: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', padding: '20px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' },
    earnIcon: { fontSize: '2.5em', marginBottom: '10px' },
    earnTitle: { fontWeight: 'bold', fontSize: '1.1em', marginBottom: '5px' },
    earnPoints: { fontSize: '1.5em', fontWeight: 'bold', color: '#ffeaa7', marginBottom: '5px' },
    earnDesc: { fontSize: '0.85em', opacity: 0.9 },
    useCard: { border: '2px solid var(--admin-border)', padding: '20px', borderRadius: '12px', textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer' },
    useIcon: { fontSize: '2.5em', marginBottom: '10px' },
    useTitle: { fontWeight: 'bold', fontSize: '1.1em', marginBottom: '5px', color: 'var(--admin-text-main)' },
    usePoints: { fontSize: '1.3em', fontWeight: 'bold', color: 'var(--admin-primary)', marginBottom: '5px' },
    useDesc: { fontSize: '0.85em', color: 'var(--admin-text-sub)' },
    demoBanner: { background: 'linear-gradient(45deg, #FF512F, #DD2476)', color: 'white', padding: '15px 20px', borderRadius: '10px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px', boxShadow: '0 4px 15px rgba(221, 36, 118, 0.3)' },
    proposalForm: { background: 'rgba(255, 255, 255, 0.05)', padding: '20px', borderRadius: '10px', marginBottom: '30px' },
    formRow: { display: 'flex', gap: '10px', marginTop: '15px' },
    addBtn: { padding: '12px 24px', background: 'var(--admin-primary)', color: '#121212', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' },
    voteList: { marginTop: '30px' },
    proposalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '20px' },
    proposalHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
    proposalRank: { fontSize: '1.5em', fontWeight: 'bold' },
    proposalName: { fontSize: '1.2em', fontWeight: 'bold', color: 'var(--admin-text-main)' },
    proposalLink: { display: 'inline-block', fontSize: '0.9em', color: 'var(--admin-primary)', textDecoration: 'none', marginBottom: '15px' },
    proposalStats: { padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', textAlign: 'center', marginBottom: '15px' },
    voteInput: { display: 'flex', gap: '10px' },
    voteBtn: { padding: '10px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },

    // Dashboard Styles
    dashboardGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
    cardTitle: { fontSize: '1.4em', marginBottom: '15px', color: 'var(--admin-text-main)', borderBottom: '1px solid var(--admin-border)', paddingBottom: '10px' },
    rankList: { display: 'flex', flexDirection: 'column', gap: '10px' },
    rankItem: { display: 'flex', alignItems: 'center', padding: '15px', background: 'var(--admin-bg)', borderRadius: '8px', border: '1px solid var(--admin-border)' },
    rankBadge: { width: '30px', height: '30px', borderRadius: '50%', background: 'var(--admin-primary)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '15px' },
    rankUser: { flex: 1 },
    rankName: { fontWeight: 'bold', fontSize: '1.1em', color: 'var(--admin-text-main)' },
    rankId: { fontSize: '0.9em', color: 'var(--admin-text-sub)' },
    rankPoint: { fontWeight: 'bold', fontSize: '1.2em', color: 'var(--admin-primary)' },
    historyList: { display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' },
    logItem: { display: 'flex', alignItems: 'center', padding: '12px', background: 'var(--admin-bg)', borderRadius: '8px', borderBottom: '1px solid var(--admin-border)' },
    logIcon: { fontSize: '1.5em', marginRight: '15px' },
    logContent: { flex: 1 },
    logTitle: { color: 'var(--admin-text-main)', marginBottom: '4px' },
    logTime: { fontSize: '0.8em', color: 'var(--admin-text-sub)' },
    logAmount: { fontWeight: 'bold', fontSize: '1.1em' },
    loading: { color: 'var(--admin-text-sub)', textAlign: 'center', padding: '50px' },
    emptyState: { padding: '20px', textAlign: 'center', color: 'var(--admin-text-sub)' }
};

export default PointsTab;
