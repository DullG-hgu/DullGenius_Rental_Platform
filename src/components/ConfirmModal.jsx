// src/components/ConfirmModal.jsx
import { useId, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.jsx';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.jsx';
import ModalButton from './ModalButton.jsx';

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
    const titleId = useId();
    const messageId = useId();

    // body 스크롤 잠금은 카운터 기반 훅 (모달 동시 마운트 대응). ESC/포커스는 useFocusTrap이 담당
    useBodyScrollLock(isOpen);

    // 오버레이 닫기: pointerdown 과 pointerup 이 모두 오버레이 자체에서 일어났을 때만.
    // 긴 메시지를 읽으려고 손가락을 움직이거나(드래그), 모달 안에서 시작한 제스처가
    // 바깥에서 끝나는 경우에 닫히지 않게 한다.
    const overlayPressRef = useRef(false);

    const containerRef = useFocusTrap({
        active: isOpen,
        onEscape: onClose,
        initialFocus: 'first',
    });

    if (!isOpen) return null;

    const confirmVariant = type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : 'primary';

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    return (
        <div
            className="modal-overlay"
            style={styles.overlay}
            onPointerDown={(e) => { overlayPressRef.current = e.target === e.currentTarget; }}
            onPointerUp={(e) => {
                const shouldClose = overlayPressRef.current && e.target === e.currentTarget;
                overlayPressRef.current = false;
                if (shouldClose) onClose();
            }}
            onPointerCancel={() => { overlayPressRef.current = false; }}
        >
            <div
                ref={containerRef}
                className="modal-content"
                style={styles.modal}
                // 이 모달은 다른 모달 안에 렌더링되기도 한다(키오스크 예약 수령·간편 반납).
                // 전파를 막지 않으면 확인/취소 클릭이 바깥 모달의 오버레이까지 올라가
                // 부모 모달이 통째로 닫힌다. pointer 이벤트는 위 오버레이 판정이 쓰므로 건드리지 않는다.
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
            >
                {/* 헤더 */}
                <div className="confirm-modal-header" style={styles.header}>
                    <h3 id={titleId} className="confirm-modal-title" style={styles.title}>{title}</h3>
                    <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">
                        ✕
                    </button>
                </div>

                {/* 메시지 */}
                <div style={styles.content}>
                    <p id={messageId} className="confirm-modal-message" style={styles.message}>
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
                    <ModalButton variant="cancel" onClick={onClose}>
                        ✕ {cancelText}
                    </ModalButton>
                    <ModalButton variant={confirmVariant} onClick={handleConfirm}>
                        ✓ {confirmText}
                    </ModalButton>
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'fadeIn 0.2s ease-out'
    },
    modal: {
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
    },
    title: {
        margin: 0,
        fontSize: '1.3em',
        fontWeight: 'bold',
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        fontSize: '1.5em',
        color: '#95a5a6',
        cursor: 'pointer',
        padding: '0',
        width: '36px',
        height: '36px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        transition: 'all 0.2s'
    },
    content: {
        padding: '24px',
        minHeight: '60px',
        // 긴 메시지(학기 초기화 안내 등)에서도 하단 확인/취소 버튼이 화면 안에 남도록
        maxHeight: '55vh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
    },
    message: {
        margin: 0,
        fontSize: '1em',
        lineHeight: '1.6',
        whiteSpace: 'pre-wrap'
    },
    footer: {
        display: 'flex',
        gap: '12px',
        padding: '20px 24px',
        flexWrap: 'wrap',
    },
};

export default ConfirmModal;
