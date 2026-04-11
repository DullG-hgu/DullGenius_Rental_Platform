// src/components/ConfirmModal.js
import { useEffect } from 'react';

/**
 * 재사용 가능한 확인 모달 컴포넌트
 * window.confirm()을 대체하여 더 나은 UI/UX 제공
 * Admin 페이지에서는 Dark Mode 스타일을 적용받음 (.modal-content 등)
 */
function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = "확인",
    message,
    confirmText = "확인",
    cancelText = "취소",
    type = "info", // "info" | "warning" | "danger"
    subContent = null // 메시지 아래 추가 렌더링 (약관 동의 문구 등)
}) {

    // ESC 키로 모달 닫기
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEsc);
            // 모달 열릴 때 body 스크롤 방지
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // 타입별 색상 결정 (토스트와 동일)
    const getButtonColor = () => {
        switch (type) {
            case 'danger':
                return 'rgba(231, 76, 60, 0.95)';
            case 'warning':
                return 'rgba(243, 156, 18, 0.95)';
            default:
                return 'rgba(52, 152, 219, 0.95)';
        }
    };

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    return (
        <div className="modal-overlay" style={styles.overlay} onClick={onClose}>
            <div className="modal-content" style={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="confirm-modal-header" style={styles.header}>
                    <h3 className="confirm-modal-title" style={styles.title}>{title}</h3>
                    <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">
                        ✕
                    </button>
                </div>

                {/* 메시지 */}
                <div style={styles.content}>
                    <p className="confirm-modal-message" style={styles.message}>
                        {message.split('\n').map((line, i) => (
                            <span key={i}>
                                {line}
                                {i < message.split('\n').length - 1 && <br />}
                            </span>
                        ))}
                    </p>
                    {subContent}
                </div>

                {/* 버튼 */}
                <div className="confirm-modal-footer" style={styles.footer}>
                    <button
                        onClick={onClose}
                        style={styles.cancelBtn}
                        onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)';
                            e.target.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)';
                            e.target.style.transform = 'translateY(0)';
                        }}
                        onMouseDown={(e) => {
                            e.target.style.transform = 'translateY(0) scale(0.98)';
                        }}
                        onMouseUp={(e) => {
                            e.target.style.transform = 'translateY(-1px)';
                        }}
                    >
                        ✕ {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        style={{ ...styles.confirmBtn, backgroundColor: getButtonColor() }}
                        onMouseEnter={(e) => {
                            const color = getButtonColor();
                            e.target.style.backgroundColor = color.replace('0.95', '1');
                            e.target.style.transform = 'translateY(-1px)';
                            e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.backgroundColor = getButtonColor();
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                        }}
                        onMouseDown={(e) => {
                            e.target.style.transform = 'translateY(0) scale(0.98)';
                        }}
                        onMouseUp={(e) => {
                            e.target.style.transform = 'translateY(-1px)';
                        }}
                    >
                        ✓ {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // background handled by .modal-overlay
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'fadeIn 0.2s ease-out'
    },
    modal: {
        // background handled by .modal-content
        borderRadius: '12px',
        width: '90%',
        maxWidth: '450px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        animation: 'slideUp 0.3s ease-out',
        overflow: 'hidden'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 24px',
        // border handled by class
    },
    title: {
        margin: 0,
        fontSize: '1.3em',
        fontWeight: 'bold',
        // color handled by class
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        fontSize: '1.5em',
        color: '#95a5a6',
        cursor: 'pointer',
        padding: '0',
        width: '30px',
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        transition: 'all 0.2s'
    },
    content: {
        padding: '24px',
        minHeight: '60px'
    },
    message: {
        margin: 0,
        fontSize: '1em',
        lineHeight: '1.6',
        // color handled by class
        whiteSpace: 'pre-wrap'
    },
    footer: {
        display: 'flex',
        gap: '12px',
        padding: '20px 24px',
        // border and background handled by class
    },
    cancelBtn: {
        flex: 1,
        padding: '12px 20px',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: 'rgba(108, 117, 125, 0.9)',
        color: 'white',
        borderRadius: '8px',
        fontSize: '1em',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
    },
    confirmBtn: {
        flex: 1,
        padding: '12px 20px',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        color: 'white',
        borderRadius: '8px',
        fontSize: '1em',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
    }
};

export default ConfirmModal;
