import React from 'react';
import { Link } from 'react-router-dom';
import './NotFound.css';

export default function NotFound({
  title = '페이지를 찾을 수 없습니다.',
  description = '주소가 올바른지 확인해 주세요. 페이지가 이동되었거나 삭제되었을 수 있습니다.',
  admin = false,
  onRetry,
}) {
  return (
    <main className={`not-found${admin ? ' admin-container not-found-admin' : ''}`}>
      <div className="not-found-content" role={onRetry ? 'alert' : undefined}>
        <p className="not-found-code">{onRetry ? '잠시만요' : '404'}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <nav className="not-found-actions" aria-label="페이지 이동">
          {onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
          <Link to={admin ? '/admin-secret/events' : '/'}>{admin ? '행사 목록으로' : '홈으로 가기'}</Link>
          {!admin && <Link to="/search">게임 검색</Link>}
        </nav>
      </div>
    </main>
  );
}
