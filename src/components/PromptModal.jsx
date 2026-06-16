import { useEffect, useId, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.jsx';
import ModalButton from './ModalButton.jsx';

/**
 * 값 입력을 받는 모달. window.prompt() 대체.
 * Admin 페이지의 다크 모드 스타일을 동일하게 사용한다.
 */
function PromptModal({
    isOpen,
    onClose,
    onConfirm,
    title = "입력",
    message = "",
    defaultValue = "",
    placeholder = "",
    inputType = "text", // "text" | "number"
    min,
    max,
    confirmText = "확인",
    cancelText = "취소",
}) {
    const titleId = useId();
    const messageId = useId();
    const [value, setValue] = useState(defaultValue);

    useEffect(() => {
        if (isOpen) setValue(defaultValue);
    }, [isOpen, defaultValue]);

    useEffect(() => {
        if (!isOpen) return;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    const containerRef = useFocusTrap({
        active: isOpen,
        onEscape: onClose,
        initialFocus: 'first',
    });

    if (!isOpen) return null;

    const handleConfirm = () => {
        onConfirm(value);
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        }
    };

    return (
        <div className="modal-overlay" style={styles.overlay} onClick={onClose}>
            <div
                ref={containerRef}
                className="modal-content"
                style={styles.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
            >
                <div className="confirm-modal-header" style={styles.header}>
                    <h3 id={titleId} className="confirm-modal-title" style={styles.title}>{title}</h3>
                    <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">✕</button>
                </div>

                <div style={styles.content}>
                    {message && (
                        <p id={messageId} className="confirm-modal-message" style={styles.message}>
                            {message.split('\n').map((line, i, arr) => (
                                <span key={i}>
                                    {line}
                                    {i < arr.length - 1 && <br />}
                                </span>
                            ))}
                        </p>
                    )}
                    <input
                        type={inputType}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        min={min}
                        max={max}
                        autoFocus
                        style={styles.input}
                    />
                </div>

                <div className="confirm-modal-footer" style={styles.footer}>
                    <ModalButton variant="cancel" onClick={onClose}>
                        ✕ {cancelText}
                    </ModalButton>
                    <ModalButton variant="primary" onClick={handleConfirm}>
                        ✓ {confirmText}
                    </ModalButton>
                </div>
            </div>
        </div>
    );
}

const styles = {
    overlay: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, animation: 'fadeIn 0.2s ease-out',
    },
    modal: {
        borderRadius: '12px', width: '90%', maxWidth: '450px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        animation: 'slideUp 0.3s ease-out', overflow: 'hidden',
    },
    header: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 24px',
    },
    title: { margin: 0, fontSize: '1.3em', fontWeight: 'bold' },
    closeBtn: {
        background: 'none', border: 'none', fontSize: '1.5em',
        color: '#95a5a6', cursor: 'pointer', padding: 0,
        width: '30px', height: '30px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', transition: 'all 0.2s',
    },
    content: { padding: '24px', minHeight: '60px' },
    message: {
        margin: '0 0 12px 0', fontSize: '1em',
        lineHeight: '1.6', whiteSpace: 'pre-wrap',
    },
    input: {
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--admin-border, #ccc)',
        background: 'var(--admin-bg, #fff)',
        color: 'var(--admin-text-main, #000)',
        fontSize: '1em',
        boxSizing: 'border-box',
    },
    footer: {
        display: 'flex', gap: '12px', padding: '20px 24px',
    },
};

export default PromptModal;
