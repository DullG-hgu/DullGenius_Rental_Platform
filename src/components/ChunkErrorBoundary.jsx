import React from 'react';

/**
 * 배포 후 lazy chunk 해시 변경으로 발생하는 ChunkLoadError를 잡아
 * 자동 새로고침합니다. 10초 이내 재발 시 무한루프 방지를 위해
 * 수동 새로고침 버튼을 표시합니다.
 */
class ChunkErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, isChunkError: false };
    }

    static getDerivedStateFromError(error) {
        const isChunkError =
            error?.message?.includes('dynamically imported module') ||
            error?.message?.includes('Loading chunk') ||
            error?.name === 'ChunkLoadError';
        return { hasError: true, isChunkError };
    }

    componentDidCatch(error) {
        if (this.state.isChunkError) {
            const lastReload = sessionStorage.getItem('chunk_reload_at');
            const now = Date.now();
            if (!lastReload || now - parseInt(lastReload) > 3000) {
                sessionStorage.setItem('chunk_reload_at', String(now));
                window.location.reload();
            }
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    height: '100vh', flexDirection: 'column', gap: '16px', color: '#333'
                }}>
                    <p>페이지를 불러오지 못했습니다.</p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{ padding: '8px 20px', cursor: 'pointer', borderRadius: '6px', border: '1px solid #ccc' }}
                    >
                        새로고침
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ChunkErrorBoundary;
