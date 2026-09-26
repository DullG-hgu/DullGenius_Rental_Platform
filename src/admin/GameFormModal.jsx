// src/admin/GameFormModal.js
// 설명: 게임 정보 입력/수정용 공통 모달

import { useState, useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { searchBGG, fetchBGGGame, searchKoreanImages, checkGameExists, suggestGenresAI } from '../api';
import PoweredByBGG from '../components/PoweredByBGG';

const BGG_ALLOWED_TYPES = new Set(['boardgame', 'boardgameexpansion']);

// AI 장르 제안을 못 쓸 때 사유 (함수 jev-genre-suggest의 reason 값)
const AI_UNAVAILABLE_LABEL = {
  unconfigured: '키 미설정',
  quota: '크레딧 소진',
  rate_limited: '요청 한도',
  timeout: '응답 지연',
  upstream: 'AI 서버 오류',
  bgg_unavailable: 'BGG 응답 없음',
  bgg_not_found: 'BGG 항목 없음',
  network: '네트워크 오류',
  http_404: '개발 서버에서는 함수 없음',
};

// BGG 최소/최대 시간 → "30분" / "60~120분". 둘 다 없으면 null.
// 최소가 5분 미만인데 최대는 있는 경우(예: 1~30분)는 최대만 쓴다.
export function formatPlayingTime(minPlaytime, maxPlaytime) {
  let min = minPlaytime > 0 ? minPlaytime : null;
  const max = maxPlaytime > 0 ? maxPlaytime : null;
  if (min && min < 5 && max && max >= 5) min = null;
  if (!min && !max) return null;
  if (!min || !max || min === max) return `${max || min}분`;
  return `${min}~${max}분`;
}

function GameFormModal({ isOpen, onClose, initialData, onSubmit, title, onDuplicateGame, busy = false }) {
  const bggRequestRef = useRef(0);
  const bggBusyRef = useRef(false);
  const manualBggInputRef = useRef(null);
  const [bggSelectionPending, setBggSelectionPending] = useState(false);
  const { showToast } = useToast(); // [NEW]
  const [formData, setFormData] = useState({
    name: "",
    bgg_id: "",
    category: "보드게임",
    difficulty: "",
    genres: null,
    min_players: null,
    max_players: null,
    min_playtime: null,
    max_playtime: null,
    playingtime: "",
    tags: "",
    image: "",
    video_url: "",
    recommendation_text: "",
    manual_url: "",
    owner: "",
    is_rentable: true,
    ...initialData
  });

  // [NEW] BGG 연동 상태
  const [bggSearchResults, setBggSearchResults] = useState([]);
  const [bggSearching, setBggSearching] = useState(false);
  const [bggFetching, setBggFetching] = useState(false);
  useEffect(() => {
    bggBusyRef.current = false;
    setBggFetching(false);
    setBggSelectionPending(false);
    return () => { bggRequestRef.current += 1; };
  }, [isOpen, initialData]);
  const [showBggPanel, setShowBggPanel] = useState(false);
  const [manualBggId, setManualBggId] = useState('');
  const [bggMechanics, setBggMechanics] = useState(null); // BGG 메커니즘 참고용
  const [genresInput, setGenresInput] = useState('');
  const [bggCategories, setBggCategories] = useState(null); // BGG 영문 카테고리 — 참고용, 장르에 자동으로 넣지 않는다
  const [aiGenres, setAiGenres] = useState({ status: 'idle', suggestions: [], reason: '' });
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageSearchResults, setImageSearchResults] = useState([]);
  const [imageSearching, setImageSearching] = useState(false);

  // 모달이 열릴 때마다 초기 데이터(initialData)로 폼을 리셋
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: "", category: "보드게임", difficulty: "", genres: null, min_players: null, max_players: null, min_playtime: null, max_playtime: null, playingtime: "", tags: "", image: "", video_url: "", recommendation_text: "", manual_url: "", owner: "", is_rentable: true, bgg_id: "",
        ...initialData
      });
      setBggSearchResults([]);
      setShowBggPanel(false);
      setManualBggId('');
      setBggMechanics(null);
      setBggCategories(null);
      setAiGenres({ status: 'idle', suggestions: [], reason: '' });
      setGenresInput(Array.isArray(initialData?.genres) ? initialData.genres.join(', ') : '');
      setImageSearchQuery('');
      setImageSearchResults([]);
      setImageSearching(false);
    }
  }, [isOpen, initialData]);

  // 머더미스터리는 동아리 운영 기준 난이도 2.5를 사용한다.
  useEffect(() => {
    if (isOpen && formData.category === '머더미스터리' && String(formData.difficulty) !== '2.5') {
      setFormData(prev => ({ ...prev, difficulty: '2.5' }));
    }
  }, [isOpen, formData.category, formData.difficulty]);

  // 모달에서 다른 정보를 입력하는 동안 한국판 이미지를 백그라운드에서 미리 찾는다.
  useEffect(() => {
    const name = formData.name?.trim();
    if (!isOpen || !name) {
      setImageSearchResults([]);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      const categoryHint = formData.category === '머더미스터리'
        ? '머더미스터리 패키지'
        : '';
      setImageSearching(true);
      try {
        const results = await searchKoreanImages(`${name} ${categoryHint}`.trim());
        if (active) setImageSearchResults(results);
      } catch (error) {
        console.error('[관리자 게임 추가 모달][NAVER 이미지 자동 검색 실패]', {
          gameName: name,
          category: formData.category,
          error,
        });
        if (active) setImageSearchResults([]);
      } finally {
        if (active) setImageSearching(false);
      }
    }, 600);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, formData.name, formData.category]);

  // 등록 모달이 열리면 왼쪽 BGG 후보도 자동으로 검색한다.
  // 오른쪽 NAVER 이미지 검색 effect와 독립적으로 실행되어 두 결과가 병렬로 채워진다.
  useEffect(() => {
    const name = formData.name?.trim();
    if (!isOpen || !name) {
      setBggSearchResults([]);
      setShowBggPanel(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setBggSearching(true);
      setShowBggPanel(true);
      setBggSearchResults([]);
      try {
        const results = await searchBGG(name);
        if (!active) return;
        setBggSearchResults(results);
        setShowBggPanel(results.length > 0);
      } catch (error) {
        console.error('[관리자 게임 추가 모달][BGG 자동 검색 실패]', {
          gameName: name,
          error,
        });
        if (active) {
          setBggSearchResults([]);
          setShowBggPanel(false);
        }
      } finally {
        if (active) setBggSearching(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, formData.name]);

  const handleSubmit = () => {
    if (busy || bggBusyRef.current || bggSelectionPending) return;
    if (!formData.name) return showToast("이름은 필수입니다.", { type: "warning" });
    if (formData.difficulty === "") return showToast("난이도를 입력해주세요.", { type: "warning" }); // [NEW] 난이도 필수 검증 추가
    onSubmit(formData); // 부모 컴포넌트에게 입력된 데이터 전달
  };

  // [NEW] BGG 게임 검색
  const handleBggSearch = async () => {
    if (!formData.name) return showToast("게임 이름을 먼저 입력하세요.", { type: "warning" });
    setBggSearching(true);
    setShowBggPanel(true);
    setBggSearchResults([]);
    try {
      const results = await searchBGG(formData.name);
      if (results.length === 0) {
        setShowBggPanel(false);
      } else {
        // 드롭다운만 표시 (자동 선택 안 함)
        setBggSearchResults(results);
        showToast(`${results.length}개 결과를 찾았습니다. 아래에서 선택해주세요.`, { type: "info" });
      }
    } catch (e) {
      console.error("BGG 검색 에러:", e);
      showToast("BGG 검색 오류: " + e.message, { type: "error" });
    } finally {
      setBggSearching(false);
    }
  };

  // [NEW] 검색 결과 선택 또는 수동 ID 입력 후 상세 조회 → 폼 자동 채움
  const updateGenresInput = (value) => {
    setGenresInput(value);
    setFormData(prev => ({
      ...prev,
      genres: value ? value.split(',').map(g => g.trim()).filter(Boolean) : null,
    }));
  };

  const currentGenres = genresInput.split(',').map(g => g.trim()).filter(Boolean);

  const addGenre = (genre) => {
    if (currentGenres.includes(genre)) return;
    updateGenresInput([...currentGenres, genre].join(', '));
  };

  // AI(Jev) 장르 제안. 실패해도 폼은 그대로 — 제안 영역에 사유만 짧게 보인다.
  const requestAiGenres = async () => {
    if (!formData.bgg_id || aiGenres.status === 'loading') return;
    setAiGenres({ status: 'loading', suggestions: [], reason: '' });
    const result = await suggestGenresAI(formData.bgg_id, formData.name);
    setAiGenres(result.available
      ? { status: 'done', suggestions: result.suggestions || [], reason: '' }
      : { status: 'unavailable', suggestions: [], reason: result.reason || '' });
  };

  const applyBggData = async (bggId) => {
    if (busy || bggBusyRef.current) return;
    bggBusyRef.current = true;
    const requestId = ++bggRequestRef.current;
    setBggSelectionPending(true);
    setBggFetching(true);
    try {
      // 이 콜백은 신규 등록에서만 전달한다. 수정 모달은 기존 동작을 유지한다.
      if (onDuplicateGame) {
        const matches = await checkGameExists(bggId);
        if (requestId !== bggRequestRef.current) return;
        if (matches.length > 1) {
          showToast('같은 BGG ID의 게임이 여러 개입니다. 게임 목록에서 재고를 추가할 대상을 선택해주세요.', { type: 'warning' });
          return;
        }
        if (matches.length === 1) {
          onDuplicateGame(matches[0]);
          return;
        }
      }
      const detail = await fetchBGGGame(bggId);
      if (requestId !== bggRequestRef.current) return;
      if (!detail) throw new Error("게임 정보를 찾을 수 없습니다.");
      // 보드게임·확장판이 아닌 항목(TRPG 아이템, 비디오게임 등)은 폼에 넣지 않는다.
      // 2026-09 점검에서 이런 오연결이 60건 넘게 발견됨.
      if (detail.type && !BGG_ALLOWED_TYPES.has(detail.type)) {
        throw new Error(`BGG ID ${detail.id}는 보드게임이 아닙니다 (${detail.type}). 이름으로 다시 검색해주세요.`);
      }

      // 0 또는 빈 값은 "정보 없음"이라 기존 값을 유지한다 (BGG는 미기재 항목을 0으로 준다)
      const num = (v) => { const n = parseInt(v, 10); return n > 0 ? n : null; };
      const minPlayers = num(detail.minPlayers);
      const maxPlayers = num(detail.maxPlayers);
      const minPlaytime = num(detail.minPlaytime);
      const maxPlaytime = num(detail.maxPlaytime);
      // 난이도는 투표가 있을 때만 (투표 0인 항목의 0.00이 그대로 저장되던 문제 방지)
      const weight = parseFloat(detail.weight);
      const hasWeight = Number.isFinite(weight) && weight > 0 && (detail.numWeights ?? 1) > 0;

      setFormData(prev => ({
        ...prev,
        bgg_id: detail.id,
        image: prev.image || detail.thumbnail || '',
        difficulty: hasWeight ? detail.weight : prev.difficulty,
        min_players: minPlayers ?? prev.min_players,
        max_players: maxPlayers ?? prev.max_players,
        min_playtime: minPlaytime ?? prev.min_playtime,
        max_playtime: maxPlaytime ?? prev.max_playtime,
        playingtime: formatPlayingTime(minPlaytime, maxPlaytime) ?? prev.playingtime,
      }));
      // 장르는 운영자가 한글로 손질하는 값이라 BGG 영문 카테고리로 덮어쓰지 않는다 (2026-09 장르 오염 원인).
      setBggCategories(detail.genres?.length ? detail.genres : null);
      setAiGenres({ status: 'idle', suggestions: [], reason: '' });

      // 메커니즘 참고용 저장
      if (detail.mechanics && detail.mechanics.length > 0) {
        setBggMechanics(detail.mechanics);
      }

      showToast("BGG 정보가 자동으로 채워졌습니다.", { type: "success" });
      setShowBggPanel(false);
      setBggSearchResults([]);
      setManualBggId('');
      setBggSelectionPending(false);
    } catch (e) {
      if (requestId !== bggRequestRef.current) return;
      console.error('applyBggData 에러:', e);
      showToast("BGG 정보 조회 오류: " + e.message, { type: "error" });
    } finally {
      if (requestId === bggRequestRef.current) {
        bggBusyRef.current = false;
        setBggFetching(false);
      }
    }
  };

  // [NEW] 수동 BGG ID 조회
  const handleManualBggFetch = () => {
    const trimmed = manualBggId.trim();
    if (!trimmed) return showToast("BGG ID를 입력하세요.", { type: "warning" });
    if (!/^\d+$/.test(trimmed)) {
      return showToast("BGG ID는 숫자만 입력하세요. (예: 266192)", { type: "warning" });
    }
    // [FIXED] applyBggData 내에서 자동 초기화됨 (setManualBggId('') in finally)
    applyBggData(trimmed);
  };

  // [NEW] BGG 웹사이트에서 직접 검색
  const openBGGWebSearch = () => {
    if (!formData.name) return showToast("게임 이름을 먼저 입력해주세요.", { type: "warning" });
    const url = `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(formData.name)}`;
    window.open(url, '_blank');
  };

  const stripHtml = (value = '') => value.replace(/<[^>]*>?/g, '');

  const handleKoreanImageSearch = async () => {
    if (!formData.name && !imageSearchQuery.trim()) {
      return showToast('게임 이름을 먼저 입력하세요.', { type: 'warning' });
    }

    const categoryHint = formData.category === '머더미스터리'
      ? '머더미스터리 패키지'
      : '';
    const query = imageSearchQuery.trim() || `${formData.name} ${categoryHint}`.trim();

    setImageSearching(true);
    setImageSearchResults([]);
    try {
      const results = await searchKoreanImages(query);
      setImageSearchResults(results);
      if (!results.length) {
        showToast('한국판 이미지 검색 결과가 없습니다.', { type: 'info' });
      }
    } catch (e) {
      console.error('한국판 이미지 검색 실패:', e);
      showToast(`한국판 이미지 검색 오류: ${e.message}`, { type: 'error' });
    } finally {
      setImageSearching(false);
    }
  };

  const renderBggSideModal = () => (
    <aside className="modal-content game-bgg-side-modal">
      <h3 style={{ margin: 0, color: '#3498db' }}>BGG 검색 결과</h3>
      <div style={{ fontSize: '0.82em', color: 'var(--admin-text-sub)' }}>
        등록할 게임과 일치하는 항목을 선택하면 상세정보를 가져옵니다.
      </div>

      <button
        type="button"
        onClick={handleBggSearch}
        disabled={bggSearching || bggFetching}
        style={{
          width: '100%', padding: '9px', background: '#2c3e50', color: 'white',
          border: '1px solid #3498db', borderRadius: '6px', cursor: 'pointer',
          opacity: (bggSearching || bggFetching) ? 0.6 : 1,
        }}
      >
        {bggSearching ? '검색 중...' : '🔍 BGG 다시 검색'}
      </button>

      {showBggPanel && bggSearchResults.length > 0 && (
        <div className="game-bgg-results">
          {bggSearchResults.map(item => (
            <button
              type="button"
              key={item.id}
              onClick={() => applyBggData(item.id)}
              disabled={bggFetching}
              className={String(formData.bgg_id) === String(item.id) ? 'is-selected' : ''}
            >
              <strong>
                {item.name}
                {item.isExpansion && <em className="game-bgg-expansion-badge">확장판</em>}
              </strong>
              <span>
                {item.year ? `${item.year} · ` : ''}BGG ID ${item.id}
              </span>
            </button>
          ))}
        </div>
      )}

      {bggSelectionPending && !bggFetching && !busy && (
        <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85em' }}>
          BGG 항목을 다시 선택하거나 ID를 다시 조회해주세요.
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          ref={manualBggInputRef}
          value={manualBggId}
          onChange={e => setManualBggId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleManualBggFetch()}
          placeholder="BGG ID 직접 입력"
          aria-label="BGG ID 직접 입력"
          className="admin-input"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" onClick={handleManualBggFetch} disabled={bggFetching}>
          {bggFetching ? '조회 중' : '가져오기'}
        </button>
      </div>

      {formData.bgg_id && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '0.8em', color: '#3498db' }}>
          <span>선택된 BGG ID: {formData.bgg_id}</span>
          <button
            type="button"
            disabled={busy || bggFetching}
            onClick={() => {
              setManualBggId(String(formData.bgg_id));
              manualBggInputRef.current?.focus();
              manualBggInputRef.current?.scrollIntoView({ block: 'nearest' });
            }}
            title="올바른 BGG ID를 입력하고 가져오기를 눌러 변경합니다."
            aria-label="선택된 BGG ID 변경"
            style={{
              padding: '5px 10px', borderRadius: '6px', fontSize: '0.8rem',
              background: 'var(--admin-card-bg)', color: 'var(--admin-text-sub)',
              border: '1px solid var(--admin-border)', cursor: 'pointer',
            }}
          >
            변경
          </button>
        </div>
      )}

      <button type="button" onClick={openBGGWebSearch} className="game-bgg-web-button">
        🌐 BGG 웹사이트에서 검색
      </button>

      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <PoweredByBGG variant="dark" height={22} />
        <span style={{ fontSize: '0.72em', color: 'var(--admin-text-sub)' }}>Game data from BoardGameGeek</span>
      </div>
    </aside>
  );

  if (!isOpen) return null;

  // Admin.css styles are applied via class names where possible
  // Inline styles are used for layout but colors are handled by CSS variables in class context

  return (
    <div className="modal-overlay" style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
    }}>
      <div className="game-modal-workspace">
      {renderBggSideModal()}
      <div className="modal-content game-form-modal" style={{
        padding: "25px", borderRadius: "15px", width: "94%", maxWidth: "1100px",
        boxShadow: "0 5px 20px rgba(0,0,0,0.5)"
        /* maxHeight/overflow 는 Admin.css .game-form-modal 에서 — 모바일에선 workspace 하나만 스크롤 */
      }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>

        <div className="game-form-layout">
          <div className="game-form-fields">

        <div className="admin-form-group">
          <label className="admin-label">이름</label>
          <input
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-grid-auto" style={{ '--min': '140px' }}>
          <div className="admin-form-group">
            <label className="admin-label" htmlFor="category-select">카테고리</label>
            <select
              id="category-select"
              value={formData.category}
              onChange={e => {
                const category = e.target.value;
                setFormData(prev => ({
                  ...prev,
                  category,
                  difficulty: category === '머더미스터리' ? '2.5' : prev.difficulty,
                }));
              }}
              className="admin-select"
              style={{ width: "100%", padding: "10px", borderRadius: "6px" }}
            >
              <option>보드게임</option>
              <option>머더미스터리</option>
              <option>TRPG</option>
              <option>TCG</option>
            </select>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">난이도 (0.0~5.0)</label>
            <input
              type="number" step="0.1" min="0" max="5"
              value={formData.difficulty || ""}
              onChange={e => setFormData({ ...formData, difficulty: e.target.value })}
              placeholder="예: 2.5"
              disabled={formData.category === '머더미스터리'}
              className="admin-input"
              style={{ width: "100%" }}
            />
            {formData.category === '머더미스터리' && (
              <div style={{ marginTop: "5px", fontSize: "0.75em", color: "var(--admin-text-sub)" }}>
                머더미스터리 운영 기준값 2.5로 고정됩니다.
              </div>
            )}
          </div>
        </div>

        <div className="admin-form-group">
          <label className="admin-label">장르</label>
          <input
            value={genresInput}
            onChange={e => {
              updateGenresInput(e.target.value);
            }}
            placeholder="예: 전략, 추리, 파티"
            className="admin-input"
            style={{ width: "100%" }}
          />
          <div className="game-ai-genre">
            <button
              type="button"
              className="admin-btn"
              onClick={requestAiGenres}
              disabled={!formData.bgg_id || aiGenres.status === 'loading'}
              title={formData.bgg_id ? 'BGG 정보로 장르 후보를 받습니다' : 'BGG 연결 후 사용할 수 있습니다'}
            >
              {aiGenres.status === 'loading' ? '🤖 제안 받는 중…' : '🤖 AI 장르 제안'}
            </button>
            {!formData.bgg_id && <span className="game-ai-genre-note">BGG를 연결하면 사용할 수 있어요</span>}
            {aiGenres.status === 'done' && aiGenres.suggestions.length === 0 && (
              <span className="game-ai-genre-note">뚜렷한 후보가 없습니다</span>
            )}
            {aiGenres.status === 'unavailable' && (
              <span className="game-ai-genre-note">지금은 AI 제안을 쓸 수 없습니다 — 직접 입력해주세요 ({AI_UNAVAILABLE_LABEL[aiGenres.reason] || aiGenres.reason})</span>
            )}
            {aiGenres.suggestions.map(({ genre, p }) => {
              const added = currentGenres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  className={`game-ai-genre-chip${added ? ' is-added' : ''}`}
                  onClick={() => addGenre(genre)}
                  disabled={added}
                  title={`Jev 확률 ${Math.round(p * 100)}% — 눌러서 장르에 추가`}
                >
                  {added ? '✓ ' : '+ '}{genre} <small>{Math.round(p * 100)}%</small>
                </button>
              );
            })}
          </div>
          {aiGenres.suggestions.length > 0 && (
            <div className="game-ai-genre-note">AI 후보는 참고용입니다. 테마를 장르로 착각할 때가 있으니 맞는 것만 골라주세요.</div>
          )}
          {bggCategories && (
            <div className="game-ai-genre-note">BGG 카테고리(참고): {bggCategories.join(', ')}</div>
          )}
        </div>

        {/* 메커니즘 참고용 (BGG에서 가져온 정보) */}
        {bggMechanics && bggMechanics.length > 0 && (
          <div className="admin-form-group" style={{ padding: "12px", borderRadius: "6px", backgroundColor: "rgba(100, 100, 100, 0.08)", borderLeft: "3px solid #999" }}>
            <label className="admin-label" style={{ color: "var(--admin-text-sub)", fontSize: "0.9em", marginBottom: "8px" }}>⚙️ BGG 메커니즘 (참고용)</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {bggMechanics.map((m, i) => (
                <span key={i} style={{ backgroundColor: "rgba(150, 150, 150, 0.3)", padding: "4px 10px", borderRadius: "4px", fontSize: "0.85em", color: "var(--admin-text-sub)" }}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="admin-grid-auto" style={{ '--min': '140px' }}>
          <div className="admin-form-group">
            <label className="admin-label">최소 인원</label>
            <input
              type="number"
              min="1"
              value={formData.min_players || ""}
              onChange={e => setFormData({ ...formData, min_players: e.target.value ? parseInt(e.target.value) : null })}
              placeholder="예: 2"
              className="admin-input"
              style={{ width: "100%" }}
            />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">최대 인원</label>
            <input
              type="number"
              min="1"
              value={formData.max_players || ""}
              onChange={e => setFormData({ ...formData, max_players: e.target.value ? parseInt(e.target.value) : null })}
              placeholder="예: 4"
              className="admin-input"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="admin-grid-auto" style={{ '--min': '140px' }}>
          <div className="admin-form-group">
            <label className="admin-label">최소 플레이 시간 (분)</label>
            <input
              type="number"
              min="0"
              value={formData.min_playtime || ""}
              onChange={e => setFormData({ ...formData, min_playtime: e.target.value ? parseInt(e.target.value) : null })}
              placeholder="예: 10"
              className="admin-input"
              style={{ width: "100%" }}
            />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">최대 플레이 시간 (분)</label>
            <input
              type="number"
              min="0"
              value={formData.max_playtime || ""}
              onChange={e => setFormData({ ...formData, max_playtime: e.target.value ? parseInt(e.target.value) : null })}
              placeholder="예: 60"
              className="admin-input"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="admin-form-group">
          <label className="admin-label">태그 (#으로 구분)</label>
          <input
            value={formData.tags || ""}
            onChange={e => setFormData({ ...formData, tags: e.target.value })}
            placeholder="#전략 #파티"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">추천 멘트 (한줄평)</label>
          <textarea
            value={formData.recommendation_text || ""}
            onChange={e => setFormData({ ...formData, recommendation_text: e.target.value })}
            placeholder="예: 초보자도 쉽게 즐길 수 있는 파티 게임!"
            className="admin-input"
            style={{ width: "100%", minHeight: "60px", resize: "vertical" }}
          />
        </div>

        {/* [NEW] 영상/설명서 링크 */}
        <div className="admin-form-group">
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "8px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label className="admin-label">설명 영상 URL (유튜브)</label>
            </div>
            <button
              onClick={() => {
                if (!formData.name) return showToast("게임 이름을 먼저 입력하세요.", { type: "warning" });
                const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(formData.name)}`;
                window.open(youtubeUrl, '_blank');
              }}
              style={{
                padding: "8px 12px",
                background: "#FF0000",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.85em",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                marginBottom: "2px"
              }}
              title="유튜브에서 게임 제목으로 검색"
            >
              🔍 유튜브 검색
            </button>
          </div>
          <input
            value={formData.video_url || ""}
            onChange={e => setFormData({ ...formData, video_url: e.target.value })}
            placeholder="예: https://youtu.be/..."
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">설명서 링크 (PDF, 노션 등)</label>
          <input
            value={formData.manual_url || ""}
            onChange={e => setFormData({ ...formData, manual_url: e.target.value })}
            placeholder="예: https://..."
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">소유자</label>
          <input
            value={formData.owner || ""}
            onChange={e => setFormData({ ...formData, owner: e.target.value })}
            placeholder="예: 김철수"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "15px", marginBottom: "10px" }}>
          <input
            type="checkbox"
            id="is-rentable-checkbox"
            checked={formData.is_rentable !== false}
            onChange={e => setFormData({ ...formData, is_rentable: e.target.checked })}
            style={{ width: "20px", height: "20px", cursor: "pointer" }}
          />
          <label htmlFor="is-rentable-checkbox" style={{ fontWeight: "bold", color: "var(--admin-text-main)", cursor: "pointer" }}>
            대여 가능 여부 (체크 해제 시 게임 상세 페이지에서 대여/찜 불가)
          </label>
        </div>

          </div>

          <aside className="game-image-panel">
            <div className="admin-form-group">
              <label className="admin-label">선택한 이미지</label>
              <input
                value={formData.image || ""}
                onChange={e => setFormData({ ...formData, image: e.target.value })}
                placeholder="이미지 URL을 직접 입력할 수도 있습니다."
                className="admin-input"
                style={{ width: "100%" }}
              />
              {formData.image && (
                <img
                  src={formData.image}
                  alt="선택한 게임 표지"
                  style={{ width: "100%", height: "210px", objectFit: "contain", marginTop: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.08)" }}
                />
              )}
            </div>

            <div className="admin-form-group" style={{
              border: "1px solid rgba(3, 199, 90, 0.35)", borderRadius: "8px",
              padding: "12px", background: "rgba(3, 199, 90, 0.05)"
            }}>
              <label className="admin-label" style={{ color: "#03c75a", fontWeight: "bold" }}>
                한국판 이미지 검색 {imageSearching ? '· 검색 중…' : ''}
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  value={imageSearchQuery}
                  onChange={e => setImageSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleKoreanImageSearch()}
                  placeholder={`${formData.name || '게임명'} ${formData.category === '머더미스터리' ? '머더미스터리 패키지' : ''}`.trim()}
                  className="admin-input"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={handleKoreanImageSearch}
                  disabled={imageSearching}
                  style={{
                    padding: "8px 12px", background: "#03c75a", color: "white",
                    border: "none", borderRadius: "6px", cursor: "pointer",
                    whiteSpace: "nowrap", opacity: imageSearching ? 0.6 : 1
                  }}
                >
                  다시 검색
                </button>
              </div>

              {imageSearchResults.length > 0 && (
                <div className="game-image-results">
                  {imageSearchResults.map((item, index) => {
                    const selected = formData.image === item.image;
                    return (
                      <button
                        type="button"
                        key={`${item.image}-${index}`}
                        onClick={() => setFormData(prev => ({ ...prev, image: item.image }))}
                        title={stripHtml(item.title)}
                        style={{
                          padding: "5px", borderRadius: "7px", cursor: "pointer",
                          border: selected ? "3px solid #03c75a" : "1px solid rgba(255,255,255,0.18)",
                          background: selected ? "rgba(3,199,90,0.12)" : "rgba(0,0,0,0.08)"
                        }}
                      >
                        <img
                          src={item.thumbnail}
                          alt={stripHtml(item.title) || '한국판 검색 이미지'}
                          loading="lazy"
                          style={{ width: "100%", height: "105px", objectFit: "contain" }}
                        />
                        <span className="game-image-title" style={{
                          marginTop: "4px", fontSize: "0.7em",
                          color: "var(--admin-text-sub)"
                        }}>
                          {stripHtml(item.title) || (item.width && item.height ? `${item.width}×${item.height}` : '')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
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
            ✕ 취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || bggFetching || bggSelectionPending}
            style={styles.saveBtn}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'rgba(52, 152, 219, 1)';
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
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
            ✓ 저장
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

const styles = {
  // Most styles are now handled by CSS classes in Admin.css
  cancelBtn: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" },
  saveBtn: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(52, 152, 219, 0.95)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default GameFormModal;
