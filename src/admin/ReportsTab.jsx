import React, { useState, useEffect } from 'react';
import { fetchDamageReports, fetchGameRequests, updateDamageReportStatus, updateGameRequestStatus } from '../api';
import { useToast } from '../contexts/ToastContext';

function ReportsTab() {
    const [activeSubTab, setActiveSubTab] = useState('damage'); // 'damage' or 'request'
    const [reports, setReports] = useState([]);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();

    const [selectedReport, setSelectedReport] = useState(null); // [NEW] Modal state

    useEffect(() => {
        loadData();
    }, [activeSubTab]);

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeSubTab === 'damage') {
                const data = await fetchDamageReports();
                setReports(data || []);
            } else {
                const data = await fetchGameRequests();
                setRequests(data || []);
            }
        } catch (error) {
            console.error("Failed to load reports:", error);
            showToast("데이터 로딩 실패", { type: "error" });
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (id, newStatus, type) => {
        try {
            if (type === 'damage') {
                await updateDamageReportStatus(id, newStatus);
                setReports(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
            } else {
                await updateGameRequestStatus(id, newStatus);
                setRequests(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
            }
            showToast("상태가 변경되었습니다.", { type: "success" });
        } catch (error) {
            console.error("Status update failed:", error);
            showToast("상태 변경 실패", { type: "error" });
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    };

    // [NEW] Modal Content Renderer
    const renderModalContent = () => {
        if (!selectedReport) return null;
        const isRequest = activeSubTab === 'request';
        return (
            <div style={styles.modalOverlay} onClick={() => setSelectedReport(null)}>
                <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                    <h3>{isRequest ? '🎲 게임 신청 상세' : '🚨 파손 신고 상세'}</h3>
                    <div style={styles.modalBody}>
                        <p><strong>작성자:</strong> {selectedReport.profiles?.name} ({selectedReport.profiles?.student_id})</p>
                        <p><strong>연락처:</strong> {selectedReport.profiles?.phone || '없음'}</p>
                        <p><strong>날짜:</strong> {formatDate(selectedReport.created_at)}</p>
                        <p><strong>{isRequest ? '희망 게임:' : '게임명:'}</strong> {isRequest ? selectedReport.game_title : selectedReport.game_name}</p>
                        <hr style={{ borderColor: '#ddd', margin: '15px 0' }} />
                        <p><strong>{isRequest ? '신청 사유:' : '파손 내용:'}</strong></p>
                        <div style={styles.contentBox}>
                            {isRequest ? selectedReport.description : selectedReport.content}
                        </div>
                    </div>
                    <button style={styles.closeBtn} onClick={() => setSelectedReport(null)}>닫기</button>
                </div>
            </div>
        );
    };

    return (
        <div className="admin-tab-content">
            <div style={styles.header}>
                <h3>📢 신고 및 신청 관리</h3>
                <div style={styles.subTabs}>
                    <button
                        style={activeSubTab === 'damage' ? styles.activeSubTab : styles.subTab}
                        onClick={() => setActiveSubTab('damage')}
                    >
                        🚨 파손 신고 ({reports.filter(r => r.status === 'pending').length})
                    </button>
                    <button
                        style={activeSubTab === 'request' ? styles.activeSubTab : styles.subTab}
                        onClick={() => setActiveSubTab('request')}
                    >
                        🎲 게임 신청 ({requests.filter(r => r.status === 'pending').length})
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#bbb' }}>로딩 중...</div>
            ) : (
                <div style={styles.tableContainer}>
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>날짜</th>
                                <th>작성자</th>
                                <th>연락처</th>
                                {activeSubTab === 'damage' ? (
                                    <>
                                        <th>게임명</th>
                                        <th>파손 내용</th>
                                    </>
                                ) : (
                                    <>
                                        <th>희망 게임</th>
                                        <th>신청 사유</th>
                                    </>
                                )}
                                <th>상태</th>
                                <th>관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeSubTab === 'damage' ? (
                                reports.length === 0 ? (
                                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>데이터가 없습니다.</td></tr>
                                ) : (
                                    reports.map(report => (
                                        <tr key={report.id}>
                                            <td>{formatDate(report.created_at)}</td>
                                            <td>{report.profiles?.name || '알수없음'} <span style={{ fontSize: '0.8em', color: '#888' }}>({report.profiles?.student_id})</span></td>
                                            <td>{report.profiles?.phone || '-'}</td>
                                            <td>{report.game_name}</td>
                                            <td>
                                                <button
                                                    style={styles.viewBtn}
                                                    onClick={() => setSelectedReport(report)}
                                                >
                                                    내용 보기
                                                </button>
                                            </td>
                                            <td>
                                                <span className={`status-badge status-${report.status}`}>
                                                    {report.status === 'pending' ? '대기중' : (report.status === 'resolved' ? '처리완료' : '무시됨')}
                                                </span>
                                            </td>
                                            <td>
                                                <select
                                                    value={report.status}
                                                    onChange={(e) => handleStatusChange(report.id, e.target.value, 'damage')}
                                                    style={styles.select}
                                                    aria-label="신고 처리 상태 변경"
                                                >
                                                    <option value="pending">대기중</option>
                                                    <option value="resolved">처리완료</option>
                                                    <option value="ignored">무시됨</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))
                                )
                            ) : (
                                requests.length === 0 ? (
                                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>데이터가 없습니다.</td></tr>
                                ) : (
                                    requests.map(request => (
                                        <tr key={request.id}>
                                            <td>{formatDate(request.created_at)}</td>
                                            <td>{request.profiles?.name || '알수없음'} <span style={{ fontSize: '0.8em', color: '#888' }}>({request.profiles?.student_id})</span></td>
                                            <td>{request.profiles?.phone || '-'}</td>
                                            <td>{request.game_title}</td>
                                            <td>
                                                <button
                                                    style={styles.viewBtn}
                                                    onClick={() => setSelectedReport(request)}
                                                >
                                                    내용 보기
                                                </button>
                                            </td>
                                            <td>
                                                <span className={`status-badge status-${request.status}`}>
                                                    {request.status === 'pending' ? '대기중' : (request.status === 'approved' ? '승인됨' : (request.status === 'purchased' ? '구매완료' : '거절됨'))}
                                                </span>
                                            </td>
                                            <td>
                                                <select
                                                    value={request.status}
                                                    onChange={(e) => handleStatusChange(request.id, e.target.value, 'request')}
                                                    style={styles.select}
                                                    aria-label="신청 처리 상태 변경"
                                                >
                                                    <option value="pending">대기중</option>
                                                    <option value="approved">승인됨</option>
                                                    <option value="purchased">구매완료</option>
                                                    <option value="rejected">거절됨</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {/* Modal Rendering */}
            {selectedReport && renderModalContent()}
        </div>
    );
}

const styles = {
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
    },
    subTabs: {
        display: 'flex',
        gap: '10px'
    },
    subTab: {
        padding: '8px 15px',
        border: '1px solid #444',
        background: '#2d3748',
        color: '#ccc',
        borderRadius: '5px',
        cursor: 'pointer',
        opacity: 0.7
    },
    activeSubTab: {
        padding: '8px 15px',
        border: '1px solid #667eea',
        background: '#667eea',
        color: 'white',
        borderRadius: '5px',
        cursor: 'pointer',
        fontWeight: 'bold'
    },
    tableContainer: {
        overflowX: 'auto',
        background: '#2d3748', // Dark theme card bg
        borderRadius: '8px',
        border: '1px solid #4a5568'
    },
    select: {
        padding: '5px',
        borderRadius: '4px',
        border: '1px solid #4a5568',
        background: '#1a202c',
        color: '#e2e8f0',
        cursor: 'pointer'
    },
    viewBtn: {
        padding: '5px 10px',
        background: '#4a5568',
        border: 'none',
        borderRadius: '4px',
        color: 'white',
        cursor: 'pointer',
        fontSize: '0.9em'
    },
    // Modal Styles
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000
    },
    modalContent: {
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '500px',
        color: '#333',
        position: 'relative',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    },
    modalBody: {
        marginTop: '15px',
        marginBottom: '20px',
        lineHeight: '1.6'
    },
    contentBox: {
        background: '#f8f9fa',
        padding: '10px',
        borderRadius: '5px',
        border: '1px solid #eee',
        whiteSpace: 'pre-wrap',
        maxHeight: '200px',
        overflowY: 'auto'
    },
    closeBtn: {
        padding: '8px 15px',
        background: '#333',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        float: 'right'
    }
};

export default ReportsTab;
