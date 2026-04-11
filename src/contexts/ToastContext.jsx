import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, options = {}) => {
        const id = Date.now() + Math.random();
        const toast = {
            id,
            message,
            type: options.type || 'info', // success, error, info, warning
            duration: options.duration || 3000,
            showButton: options.showButton || false,
            buttonText: options.buttonText || '확인',
            onButtonClick: options.onButtonClick,
        };

        setToasts(prev => [...prev, toast]);

        // 자동으로 사라지기
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, toast.duration);

        return id;
    }, []);

    const hideToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const value = {
        showToast,
        hideToast,
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} hideToast={hideToast} />
        </ToastContext.Provider>
    );
};

const ToastContainer = ({ toasts, hideToast }) => {
    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onClose={() => hideToast(toast.id)} />
            ))}
        </div>
    );
};

const Toast = ({ toast, onClose }) => {
    const typeColors = {
        success: { bg: 'rgba(39, 174, 96, 0.95)', icon: '✅' },
        error: { bg: 'rgba(231, 76, 60, 0.95)', icon: '❌' },
        warning: { bg: 'rgba(243, 156, 18, 0.95)', icon: '⚠️' },
        info: { bg: 'rgba(52, 152, 219, 0.95)', icon: 'ℹ️' },
    };

    const { bg, icon } = typeColors[toast.type] || typeColors.info;

    return (
        <div
            className={`toast-notification toast-${toast.type}`}
            style={{
                background: bg,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2em' }}>{icon}</span>
                <div style={{ flex: 1, fontSize: '1em', textAlign: 'center' }}>
                    {toast.message}
                </div>
            </div>
            {toast.showButton && (
                <button
                    onClick={() => {
                        if (toast.onButtonClick) toast.onButtonClick();
                        onClose();
                    }}
                    style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        color: 'white',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        fontSize: '0.95em',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        marginTop: '10px',
                        width: '100%',
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.2)';
                    }}
                >
                    {toast.buttonText}
                </button>
            )}
        </div>
    );
};
