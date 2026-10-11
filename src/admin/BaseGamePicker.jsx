// 게임 폼의 「본판」 칸 — 확장판을 본판에 연결한다 (games.base_game_id)
// 예전엔 SQL로만 채웠다. 코드 모르는 운영자가 폼에서 끝낼 수 있게 2026-10-11 추가.
import { useMemo, useState } from 'react';
import { filterGames } from '../lib/searchUtils';
import { baseGameCandidates, expansionsOf, looksLikeExpansion, suggestBaseGame } from './baseGame';

const MAX_RESULTS = 6;
const NO_GAMES = [];

export default function BaseGamePicker({ games = NO_GAMES, gamesLoading = false, gameId, name, category, baseGameId, bggIsExpansion, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const base = baseGameId != null ? games.find((g) => String(g.id) === String(baseGameId)) : null;
  const children = useMemo(() => expansionsOf(games, gameId), [games, gameId]);
  const candidates = useMemo(() => baseGameCandidates(games, gameId), [games, gameId]);
  const suggestion = useMemo(
    () => (baseGameId == null && (bggIsExpansion || looksLikeExpansion(name)) ? suggestBaseGame(games, { id: gameId, name, category }) : null),
    [games, gameId, name, category, baseGameId, bggIsExpansion],
  );
  const results = useMemo(
    () => (query.trim() ? filterGames(candidates, query.trim()).slice(0, MAX_RESULTS) : []),
    [candidates, query],
  );

  const pick = (id) => {
    onChange(id);
    setQuery('');
    setOpen(false);
  };

  // 본판인 게임은 확장판이 될 수 없다 (한 단계만).
  // 예전 SQL 작업으로 본판인데 본판 연결까지 걸린 게임이면 해제만 할 수 있게 둔다.
  if (children.length > 0) {
    return (
      <div className="admin-form-group">
        <label className="admin-label">본판 연결</label>
        <div className="game-ai-genre-note">
          이 게임에 딸린 확장판 {children.length}개: {children.map((g) => g.name).join(', ')}
        </div>
        {baseGameId != null && (
          <div className="admin-btn-row" style={{ alignItems: 'center', marginTop: '6px' }}>
            <span style={{ color: '#e67e22' }}>
              본판인데 「{base ? base.name : `게임 #${baseGameId}`}」의 확장판으로도 연결됨 — 해제 권장
            </span>
            <button type="button" className="admin-btn" onClick={() => onChange(null)} disabled={disabled}>
              연결 해제
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor="base-game-search">본판 연결 (확장판일 때만)</label>

      {baseGameId != null ? (
        <div className="admin-btn-row" style={{ alignItems: 'center' }}>
          <span style={{ color: 'var(--admin-text-main)', fontWeight: 600 }}>
            🔗 {base ? base.name : `게임 #${baseGameId} (목록에 없음)`}의 확장판
          </span>
          <button type="button" className="admin-btn" onClick={() => onChange(null)} disabled={disabled}>
            연결 해제
          </button>
        </div>
      ) : (
        <>
          {suggestion && (
            <div className="game-ai-genre">
              <span className="game-ai-genre-note">본판 후보</span>
              <button type="button" className="game-ai-genre-chip" onClick={() => pick(suggestion.id)} disabled={disabled}>
                + {suggestion.name}
              </button>
            </div>
          )}
          {games.length === 0 && gamesLoading ? (
            <div className="game-ai-genre-note">게임 목록 불러오는 중</div>
          ) : games.length === 0 ? (
            <div className="game-ai-genre-note">게임 목록 없음 — 본판 연결은 대여 현황 탭의 ✏️ 수정에서</div>
          ) : !open ? (
            <button type="button" className="admin-btn" onClick={() => setOpen(true)} disabled={disabled}>
              본판 직접 찾기
            </button>
          ) : (
            <>
              <input
                id="base-game-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="본판 이름 (초성 가능)"
                className="admin-input"
                style={{ width: '100%' }}
                autoComplete="off"
              />
              {results.length > 0 && (
                <div className="game-ai-genre" style={{ marginTop: '6px' }}>
                  {results.map((g) => (
                    <button key={g.id} type="button" className="game-ai-genre-chip" onClick={() => pick(g.id)} disabled={disabled}>
                      {g.name}{category && g.category && g.category !== category ? ` (${g.category})` : ''}
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && results.length === 0 && (
                <div className="game-ai-genre-note">일치하는 본판 없음 — 본판을 먼저 등록해 주세요</div>
              )}
            </>
          )}
          {bggIsExpansion && !suggestion && (
            <div className="game-ai-genre-note">BGG에 확장판으로 등록된 게임 — 본판 연결 권장</div>
          )}
        </>
      )}
      <div className="game-ai-genre-note">확장판으로 연결 시 월드컵 후보·랭킹 제외</div>
    </div>
  );
}
