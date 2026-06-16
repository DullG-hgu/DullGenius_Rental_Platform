// src/components/InfoModal.jsx
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CLUB_INFO, CONTACTS, LINKS, DEVELOPERS, TERMS_OF_SERVICE } from '../infoData';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext'; // [NEW] Auth Context
import { useToast } from '../contexts/ToastContext'; // [NEW] Toast 알림
import { useFocusTrap } from '../hooks/useFocusTrap.jsx';

// 텍스트 포맷팅 헬퍼 함수 (볼드체 및 줄바꿈 처리)
const formatText = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
            <span key={i}>
                {parts.map((part, j) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={j}>{part.slice(2, -2)}</strong>;
                    }
                    return part;
                })}
                <br />
            </span>
        );
    });
};

/**
 * 정보 표시 모달
 * 탭 메뉴를 통해 다양한 정보(소개, 약관, 개발자, 파손신고, 신청)를 보여줍니다.
 */
function InfoModal({ isOpen, onClose, initialTab = 'guide' }) {
    const { user } = useAuth(); // [NEW] 로그인 정보
    const { showToast } = useToast(); // [NEW] Toast 알림
    const navigate = useNavigate();

    // 가이드 내 내부 링크: 모달 닫고 라우팅
    const goAndClose = (path) => {
        onClose();
        navigate(path);
    };
    const [activeTab, setActiveTab] = useState(initialTab);
    const titleId = useId();
    const activeTabBtnRef = useRef(null);
    // 초기 포커스는 활성 탭 버튼에 직접 줘야 하므로 'none'으로 호출
    const containerRef = useFocusTrap({
        active: isOpen,
        onEscape: onClose,
        initialFocus: 'none',
    });

    // 모달이 열리면 활성 탭 버튼에 포커스
    useEffect(() => {
        if (!isOpen) return;
        const id = requestAnimationFrame(() => {
            activeTabBtnRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen, activeTab]);

    // [NEW] Form States
    const [reportSearch, setReportSearch] = useState('');
    const [reportContent, setReportContent] = useState('');
    const [requestTitle, setRequestTitle] = useState('');
    const [requestDesc, setRequestDesc] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // [MOD] 검색 로직 제거됨

    // 모달 열릴 때 초기 탭 설정 & 초기화
    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            document.body.style.overflow = 'hidden';
            // 폼 초기화
            setReportSearch('');
            setReportContent('');
            setRequestTitle('');
            setRequestDesc('');
            setIsSubmitting(false);
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen, initialTab]);

    // ESC 키 처리는 useFocusTrap이 담당 (중복 제거)

    // [NEW] 파손 신고 제출
    const handleReportSubmit = async (e) => {
        e.preventDefault();
        if (!user) return showToast("로그인이 필요합니다.", { type: "warning" });
        if (!reportSearch.trim()) return showToast("게임 이름을 입력해주세요.", { type: "warning" });
        if (!reportContent.trim()) return showToast("파손 내용을 입력해주세요.", { type: "warning" });

        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('damage_reports').insert({
                user_id: user.id,
                game_id: null, // [MOD] 직접 입력이므로 ID는 null
                game_name: reportSearch,
                content: reportContent
            });

            if (error) throw error;

            // [NEW] 디스코드 알림 전송 로직 추가
            try {
                const discordUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL;
                if (discordUrl) {
                    const userName = user.user_metadata?.name || '알 수 없는 부원';
                    const userPhone = user.user_metadata?.phone || '알 수 없는 전화번호';

                    await fetch(discordUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: import.meta.env.VITE_DISCORD_BOT_NAME || "덜지니어스 알림봇",
                            avatar_url: import.meta.env.VITE_DISCORD_AVATAR_URL || "",
                            embeds: [{
                                title: "🚨 파손/분실 신고 접수",
                                description: `### ${reportSearch}에 대한 파손 신고가 적용되었습니다.\n\n**신고자** : ${userName} (${userPhone})\n**대상 게임** : ${reportSearch}\n**파손 내용** : ${reportContent}`,
                                color: 15158332, // Red
                                timestamp: new Date().toISOString()
                            }]
                        })
                    });
                }
            } catch (discordError) {
                console.error("디스코드 알림 전송 실패:", discordError);
                // 디스코드 전송 실패해도 사용자에게는 정상 접수되었다고 안내
            }

            showToast("파손 신고가 접수되었습니다. 빠른 시일 내에 확인하겠습니다.");
            onClose();
        } catch (error) {
            console.error("파손 신고 실패:", error);
            showToast("신고 접수 중 오류가 발생했습니다.", { type: "error" });
        } finally {
            setIsSubmitting(false);
        }
    };

    // [NEW] 게임 신청 제출
    const handleRequestSubmit = async (e) => {
        e.preventDefault();
        if (!user) return showToast("로그인이 필요합니다.", { type: "warning" });
        if (!requestTitle.trim()) return showToast("게임 제목을 입력해주세요.", { type: "warning" });

        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('game_requests').insert({
                user_id: user.id,
                game_title: requestTitle,
                description: requestDesc
            });

            if (error) throw error;
            showToast("게임 신청이 완료되었습니다! 다음 구매 때 참고할게요.");
            onClose();
        } catch (error) {
            console.error("게임 신청 실패:", error);
            showToast("신청 중 오류가 발생했습니다.", { type: "error" });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const renderContent = () => {
        switch (activeTab) {
            case 'intro':
                return (
                    <div style={styles.tabContent}>
                        <h3>{CLUB_INFO.name}</h3>
                        <p><strong>🕒 오피스아워:</strong> {CLUB_INFO.officeHour}</p>
                        <p><strong>📍 장소:</strong> {CLUB_INFO.location}</p>
                        <hr style={styles.divider} />
                        <h4>📞 연락처</h4>
                        <p>📧 이메일: <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a></p>
                    </div>
                );
            case 'guide':
                return (
                    <div style={styles.tabContent}>
                        {user ? (
                            <>
                                <h3 style={styles.guideTitle}>📖 보드게임 대여 방법</h3>
                                <p style={styles.guideIntro}>
                                    부원이라면 언제든 대여할 수 있어요. 아래 4단계만 기억해 주세요.
                                </p>
                                <ol style={styles.guideSteps}>
                                    <li>
                                        <strong>게임 검색</strong>
                                        <span style={styles.guideStepDesc}>
                                            카테고리 또는 검색으로 빌리고 싶은 게임을 찾아요.
                                        </span>
                                    </li>
                                    <li>
                                        <strong>찜하기</strong>
                                        <span style={styles.guideStepDesc}>
                                            게임 상세 페이지에서 ❤️ 버튼을 눌러 찜 목록에 담아요.
                                        </span>
                                    </li>
                                    <li>
                                        <strong>동아리에서 수령</strong>
                                        <span style={styles.guideStepDesc}>
                                            오피스아워에 동아리방({CLUB_INFO.location})에서 받아가세요.
                                        </span>
                                    </li>
                                    <li>
                                        <strong>다음날 자정까지 반납</strong>
                                        <span style={styles.guideStepDesc}>
                                            동아리 태블릿으로 반납 처리. 파손/분실이 있다면 즉시 신고해 주세요.
                                        </span>
                                    </li>
                                </ol>
                                <button
                                    onClick={() => setActiveTab('report')}
                                    style={styles.guideSecondaryBtn}
                                >
                                    🚨 파손/분실 신고하기
                                </button>
                            </>
                        ) : (
                            <>
                                <h3 style={styles.guideTitle}>👋 처음 오셨나요?</h3>
                                <p style={styles.guideIntro}>
                                    덜지니어스 보드게임 대여는 <strong>한동대 동아리 부원</strong>이라면 언제든 이용할 수 있어요.
                                </p>

                                <div style={styles.guideBranch}>
                                    <h4 style={styles.guideBranchTitle}>✅ 이미 부원이신가요?</h4>
                                    <p style={styles.guideBranchDesc}>
                                        사이트에 가입하고 로그인하시면 바로 게임을 빌릴 수 있어요.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => goAndClose('/signup')}
                                        style={styles.guidePrimaryBtn}
                                    >
                                        ✨ 사이트 회원가입 →
                                    </button>
                                </div>

                                <div style={styles.guideBranch}>
                                    <h4 style={styles.guideBranchTitle}>🙋 아직 부원이 아니라면</h4>
                                    <p style={styles.guideBranchDesc}>
                                        동아리에 가입하시거나, 외부 단체·행사용이라면 단기 대여를 활용해 주세요.
                                    </p>
                                    <div style={styles.guideCtaGroup}>
                                        <a
                                            href={LINKS.recruit}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={styles.guideSecondaryBtn}
                                        >
                                            동아리 입부 신청 →
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => goAndClose('/org-rental')}
                                            style={styles.guideSecondaryBtn}
                                        >
                                            단기 대여 안내 →
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                        <div style={styles.termsNotice}>
                            <span>본 서비스를 이용하면 </span>
                            <button
                                onClick={() => setActiveTab('terms')}
                                style={styles.termsLink}
                            >
                                동아리 이용 약관
                            </button>
                            <span>에 동의한 것으로 간주합니다.</span>
                        </div>
                    </div>
                );
            case 'terms':
                return (
                    <div style={styles.tabContent}>
                        <div style={styles.termsBox}>
                            {formatText(TERMS_OF_SERVICE)}
                        </div>
                    </div>
                );
            case 'report': // [NEW] 파손 신고 탭
                return (
                    <div style={styles.tabContent}>
                        <h3>🚨 파손/분실 신고</h3>
                        {!user ? (
                            <div style={styles.loginWarn}>
                                <p>로그인이 필요한 기능입니다.</p>
                                <p style={{ fontSize: '0.9em', color: '#666' }}>상단의 로그인 버튼을 이용해주세요.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleReportSubmit} style={styles.form}>
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>보드게임 이름</label>
                                    <input
                                        type="text"
                                        placeholder="파손된 게임 이름을 입력해주세요 (예: 스플렌더)"
                                        value={reportSearch}
                                        onChange={(e) => setReportSearch(e.target.value)}
                                        style={styles.input}
                                        disabled={isSubmitting}
                                    />
                                </div>
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>파손/분실 내용</label>
                                    <textarea
                                        placeholder="성실한 보고에 감사드립니다. 

파손 보고 시 운영진의 심의를 통해 기존의 발견 시 벌금인 보드게임 현물 보상이 아닌,
원가의 일부를 현금으로 보상하는 것으로 대체할 수 있습니다.

파손/분실 보고가 없이 동아리 측에서 파손된 게임을 발견하는 경우, 무조건적인 현물 보상을 원칙으로 하고 있습니다."
                                        rows={5}
                                        value={reportContent}
                                        onChange={(e) => setReportContent(e.target.value)}
                                        style={styles.textarea}
                                        disabled={isSubmitting}
                                    />
                                </div>
                                <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
                                    {isSubmitting ? '제출 중...' : '신고하기'}
                                </button>
                            </form>
                        )}
                    </div>
                );
            case 'request': // [NEW] 게임 신청 탭
                return (
                    <div style={styles.tabContent}>
                        <h3>🎲 보드게임 신청</h3>
                        {!user ? (
                            <div style={styles.loginWarn}>
                                <p>로그인이 필요한 기능입니다.</p>
                                <p style={{ fontSize: '0.9em', color: '#666' }}>상단의 로그인 버튼을 이용해주세요.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleRequestSubmit} style={styles.form}>
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>희망 게임 제목</label>
                                    <input
                                        type="text"
                                        placeholder="예: 스플렌더 마블"
                                        value={requestTitle}
                                        onChange={(e) => setRequestTitle(e.target.value)}
                                        style={styles.input}
                                        disabled={isSubmitting}
                                    />
                                </div>
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>신청 사유 (선택)</label>
                                    <textarea
                                        placeholder="이 게임이 왜 필요한가요? (예: 재고가 부족해요 / 친구들이랑 하고 싶어요)"
                                        rows={3}
                                        value={requestDesc}
                                        onChange={(e) => setRequestDesc(e.target.value)}
                                        style={styles.textarea}
                                        disabled={isSubmitting}
                                    />
                                </div>
                                <button type="submit" style={styles.requestSubmitBtn} disabled={isSubmitting}>
                                    {isSubmitting ? '제출 중...' : '신청하기'}
                                </button>
                            </form>
                        )}
                    </div>
                );
            case 'dev':
                return (
                    <div style={styles.tabContent}>
                        <h3>🛠️ 만든 사람들</h3>
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                            {DEVELOPERS.map((dev, idx) => (
                                <li key={idx} style={{ marginBottom: '10px' }}>
                                    <strong>{dev.name}</strong> <span style={{ color: '#888' }}>({dev.role})</span>
                                </li>
                            ))}
                        </ul>
                        <p style={{ marginTop: '20px', fontSize: '0.9em', color: '#666' }}>
                            DullGenius Rental Platform
                        </p>
                    </div>
                );
            default:
                return null;
        }
    };

    const tabLabel = activeTab === 'intro' ? '소개'
        : activeTab === 'guide' ? '이용 안내'
        : activeTab === 'terms' ? '이용 약관'
        : activeTab === 'report' ? '파손 신고'
        : activeTab === 'request' ? '게임 신청'
        : '개발팀';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={containerRef}
                className="modal-content"
                style={styles.modal}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <h2 id={titleId} className="sr-only" style={styles.srOnly}>{tabLabel}</h2>
                {/* 헤더 & 탭 */}
                <div style={styles.header}>
                    <div style={styles.tabScroll} className="no-scrollbar"> {/* [MOD] 스타일 이름 변경 가능 */}
                        <div style={styles.tabContainer}>
                            <button
                                ref={activeTab === 'intro' ? activeTabBtnRef : null}
                                style={activeTab === 'intro' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('intro')}
                                aria-selected={activeTab === 'intro'}
                                role="tab"
                            >
                                소개
                            </button>
                            <button
                                ref={activeTab === 'guide' ? activeTabBtnRef : null}
                                style={activeTab === 'guide' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('guide')}
                                aria-selected={activeTab === 'guide'}
                                role="tab"
                            >
                                안내
                            </button>
                            <button
                                ref={activeTab === 'terms' ? activeTabBtnRef : null}
                                style={activeTab === 'terms' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('terms')}
                                aria-selected={activeTab === 'terms'}
                                role="tab"
                            >
                                약관
                            </button>
                            <button
                                ref={activeTab === 'report' ? activeTabBtnRef : null}
                                style={activeTab === 'report' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('report')}
                                aria-selected={activeTab === 'report'}
                                role="tab"
                            >
                                파손
                            </button>
                            <button
                                ref={activeTab === 'request' ? activeTabBtnRef : null}
                                style={activeTab === 'request' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('request')}
                                aria-selected={activeTab === 'request'}
                                role="tab"
                            >
                                신청
                            </button>
                            {/* 공간 부족시 개발자는 텍스트로 대체하거나 아래로 뺌 */}
                            <button
                                ref={activeTab === 'dev' ? activeTabBtnRef : null}
                                style={activeTab === 'dev' ? styles.activeTab : styles.tab}
                                onClick={() => setActiveTab('dev')}
                                aria-selected={activeTab === 'dev'}
                                role="tab"
                            >
                                개발팀
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">✕</button>
                </div>

                {/* 컨텐츠 */}
                <div style={styles.body}>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}

const styles = {
    modal: {
        // [MOD] Moved to App.css (.modal-content) for responsive control
        overflow: 'hidden',
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 15px', // [MOD] 패딩 축소
        borderBottom: '1px solid #eee',
        background: '#f8f9fa'
    },
    tabScroll: {
        overflowX: 'auto',
        maxWidth: '100%',
        paddingRight: '10px'
    },
    tabContainer: {
        display: 'flex',
        gap: '5px' // [MOD] 간격 축소
    },
    tab: {
        padding: '8px 10px', // [MOD] 탭 크기 축소
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: 'bold',
        color: '#888',
        borderRadius: '5px',
        fontSize: '0.9rem',
        whiteSpace: 'nowrap', // [MOD] 줄바꿈 방지
        transition: 'all 0.2s'
    },
    activeTab: {
        padding: '8px 10px',
        border: 'none',
        background: 'white',
        cursor: 'pointer',
        fontWeight: 'bold',
        color: '#333',
        borderRadius: '5px',
        fontSize: '0.9rem',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        fontSize: '1.2em',
        cursor: 'pointer',
        color: '#999',
        marginLeft: '10px',
        flexShrink: 0
    },
    body: {
        padding: '20px',
        overflowY: 'auto',
        flex: 1
    },
    tabContent: {
        lineHeight: '1.6',
        color: '#444'
    },
    termsBox: {
        whiteSpace: 'pre-wrap',
        fontSize: '0.9em',
        background: '#f9f9f9',
        padding: '15px',
        borderRadius: '8px',
        border: '1px solid #eee',
        maxHeight: '60vh',
        overflowY: 'auto',
        userSelect: 'text',
        WebkitUserSelect: 'text'
    },
    divider: {
        margin: '20px 0',
        border: 'none',
        borderTop: '1px solid #eee'
    },
    loginWarn: {
        padding: '30px',
        textAlign: 'center',
        background: '#fff3cd',
        color: '#856404',
        borderRadius: '8px',
        border: '1px solid #ffeeba'
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        position: 'relative' // for search list
    },
    label: {
        fontWeight: 'bold',
        fontSize: '0.9rem',
        color: '#333'
    },
    input: {
        padding: '10px',
        borderRadius: '5px',
        border: '1px solid #ddd',
        fontSize: '1rem'
    },
    textarea: {
        padding: '10px',
        borderRadius: '5px',
        border: '1px solid #ddd',
        fontSize: '1rem',
        resize: 'vertical'
    },
    submitBtn: {
        padding: '12px',
        background: '#e74c3c', // 파손 신고 — 위험 행동 빨간색
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '1rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        marginTop: '10px'
    },
    requestSubmitBtn: {
        padding: '12px',
        background: '#3498db', // [NEW] 게임 신청 — 중립 파란색 (긍정 행동)
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '1rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        marginTop: '10px'
    },
    searchList: {
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        background: 'white',
        border: '1px solid #ddd',
        borderRadius: '5px',
        listStyle: 'none',
        padding: 0,
        margin: 0,
        zIndex: 10,
        maxHeight: '150px',
        overflowY: 'auto',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    },
    searchItem: {
        padding: '10px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee'
    },
    termsNotice: {
        marginTop: '12px',
        padding: '10px 14px',
        background: '#f0f4ff',
        borderRadius: '8px',
        border: '1px solid #d0d9f0',
        fontSize: '0.85rem',
        color: '#555',
        lineHeight: '1.5',
    },
    termsLink: {
        background: 'none',
        border: 'none',
        padding: 0,
        color: '#4a6cf7',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '0.85rem',
        textDecoration: 'underline',
    },
    guideTitle: {
        margin: '0 0 12px',
        fontSize: '1.15rem',
    },
    guideIntro: {
        margin: '0 0 14px',
        color: '#555',
        fontSize: '0.95rem',
    },
    guideSteps: {
        margin: '0 0 16px',
        paddingLeft: '22px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        color: '#333',
    },
    guideStepDesc: {
        display: 'block',
        marginTop: '2px',
        fontSize: '0.85rem',
        color: '#666',
        lineHeight: 1.45,
    },
    guideCtaGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '8px',
    },
    guidePrimaryBtn: {
        display: 'inline-block',
        textAlign: 'center',
        padding: '12px 14px',
        background: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '1rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        textDecoration: 'none',
    },
    guideSecondaryBtn: {
        display: 'inline-block',
        textAlign: 'center',
        padding: '11px 14px',
        background: '#f1f3f5',
        color: '#333',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        fontSize: '0.95rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        textDecoration: 'none',
    },
    guideBranch: {
        marginBottom: '16px',
        padding: '14px',
        background: '#fafafa',
        border: '1px solid #ececec',
        borderRadius: '10px',
    },
    guideBranchTitle: {
        margin: '0 0 6px',
        fontSize: '1rem',
        color: '#222',
    },
    guideBranchDesc: {
        margin: '0 0 10px',
        fontSize: '0.88rem',
        color: '#555',
        lineHeight: 1.5,
    },
};

export default InfoModal;
