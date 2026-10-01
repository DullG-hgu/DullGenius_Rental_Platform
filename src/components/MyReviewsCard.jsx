// 마이페이지 「내가 쓴 리뷰」 — 내 리뷰를 한곳에서 보고, 누르면 그 게임 상세(리뷰 수정·삭제 가능)로 간다.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyReviews } from '../api';
import { useGameData } from '../contexts/GameDataContext';

const PREVIEW = 5;

const MyReviewsCard = ({ userId }) => {
  const { games } = useGameData();
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetchMyReviews(userId).then(setReviews).catch(() => setError('리뷰를 불러오지 못했어요.'));
  }, [userId]);

  if (error) return <p role="alert" style={styles.note}>{error}</p>;
  if (!reviews) return <p style={styles.note}>불러오는 중…</p>;
  if (reviews.length === 0) return <p style={styles.note}>아직 쓴 리뷰가 없어요. 해 본 게임의 상세 화면에서 남겨 보세요.</p>;

  const nameOf = (gid) => games.find((g) => String(g.id) === String(gid))?.name || '삭제된 게임';
  const visible = showAll ? reviews : reviews.slice(0, PREVIEW);

  return (
    <div>
      <p style={styles.note}>리뷰 {reviews.length}개 · 누르면 그 게임 화면에서 수정·삭제할 수 있어요.</p>
      <ul style={styles.list}>
        {visible.map((r) => (
          <li key={r.review_id} style={styles.item}>
            <Link to={`/game/${r.game_id}`} style={styles.link}>
              <div style={styles.head}>
                <strong>{nameOf(r.game_id)}</strong>
                <span style={styles.stars} aria-label={`별점 ${r.rating}점`}>{'⭐'.repeat(r.rating || 0)}</span>
              </div>
              <div style={styles.content}>{r.content}</div>
              <div style={styles.date}>{new Date(r.created_at).toLocaleDateString()}</div>
            </Link>
          </li>
        ))}
      </ul>
      {reviews.length > PREVIEW && (
        <button type="button" onClick={() => setShowAll(!showAll)} style={styles.more}>
          {showAll ? '접기' : `${reviews.length - PREVIEW}개 더 보기`}
        </button>
      )}
    </div>
  );
};

const styles = {
  note: { margin: '0 0 12px', color: '#666', fontSize: '0.9em' },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { borderBottom: '1px solid #f1f2f6' },
  link: { display: 'block', padding: '12px 0', color: 'inherit', textDecoration: 'none' },
  head: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' },
  stars: { color: '#f1c40f', whiteSpace: 'nowrap' },
  content: {
    color: '#444', fontSize: '0.92em', whiteSpace: 'pre-wrap',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  date: { color: '#999', fontSize: '0.8em', marginTop: '4px' },
  more: {
    marginTop: '10px', minHeight: '44px', width: '100%', border: '1px solid #eee', borderRadius: '10px',
    background: '#fff', color: '#4a2b8c', fontWeight: 600, cursor: 'pointer',
  },
};

export default MyReviewsCard;
