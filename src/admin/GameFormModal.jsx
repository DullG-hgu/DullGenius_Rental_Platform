// src/admin/GameFormModal.js
// 설명: 게임 정보 입력/수정용 공통 모달

import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { searchBGG, fetchBGGGame, searchKoreanImages } from '../api';
import PoweredByBGG from '../components/PoweredByBGG';

function GameFormModal({ isOpen, onClose, initialData, onSubmit, title }) {
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
  const [showBggPanel, setShowBggPanel] = useState(false);
  const [manualBggId, setManualBggId] = useState('');
  const [bggMechanics, setBggMechanics] = useState(null); // BGG 메커니즘 참고용
  const [genresInput, setGenresInput] = useState('');
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
        : '보드게임 한글판';
      setImageSearching(true);
      try {
        const results = await searchKoreanImages(`${name} ${categoryHint}`);
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
  const applyBggData = async (bggId) => {
    setBggFetching(true);
    try {
      const detail = await fetchBGGGame(bggId);
      if (!detail) throw new Error("게임 정보를 찾을 수 없습니다.");

      setFormData(prev => ({
        ...prev,
        bgg_id: detail.id,
        image: prev.image || detail.thumbnail || '',
        difficulty: detail.weight || prev.difficulty,
        min_players: detail.minPlayers || prev.min_players,
        max_players: detail.maxPlayers || prev.max_players,
        min_playtime: detail.minPlaytime || prev.min_playtime,
        max_playtime: detail.maxPlaytime || prev.max_playtime,
        genres: detail.genres?.length ? detail.genres : prev.genres,
        playingtime: (detail.minPlaytime && detail.maxPlaytime)
          ? (detail.minPlaytime === detail.maxPlaytime
              ? `${detail.minPlaytime}분`
              : `${detail.minPlaytime}~${detail.maxPlaytime}분`)
          : prev.playingtime,
      }));
      if (detail.genres?.length) setGenresInput(detail.genres.join(', '));

      // 메커니즘 참고용 저장
      if (detail.mechanics && detail.mechanics.length > 0) {
        setBggMechanics(detail.mechanics);
      }

      showToast("BGG 정보가 자동으로 채워졌습니다.", { type: "success" });
      setShowBggPanel(false);
      setBggSearchResults([]);
      setManualBggId('');
    } catch (e) {
      console.error('applyBggData 에러:', e);
      showToast("BGG 정보 조회 오류: " + e.message, { type: "error" });
    } finally {
      setBggFetching(false);
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
      : '보드게임 한글판';
    const query = imageSearchQuery.trim() || `${formData.name} ${categoryHint}`;

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
              <strong>{item.name}</strong>
              <span>
                {item.year ? `${item.year} · ` : ''}BGG ID ${item.id}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          value={manualBggId}
          onChange={e => setManualBggId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleManualBggFetch()}
          placeholder="BGG ID 직접 입력"
          className="admin-input"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" onClick={handleManualBggFetch} disabled={bggFetching}>
          {bggFetching ? '조회 중' : '가져오기'}
        </button>
      </div>

      {formData.bgg_id && (
        <div style={{ fontSize: '0.8em', color: '#3498db' }}>
          선택된 BGG ID: {formData.bgg_id}
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
        boxShadow: "0 5px 20px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto"
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
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
              const value = e.target.value;
              setGenresInput(value);
              setFormData(prev => ({
                ...prev,
                genres: value ? value.split(',').map(g => g.trim()).filter(Boolean) : null,
              }));
            }}
            placeholder="예: 전략, 추리, 파티"
            className="admin-input"
            style={{ width: "100%" }}
          />
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
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
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "8px" }}>
            <div style={{ flex: 1 }}>
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
                  placeholder={`${formData.name || '게임명'} ${formData.category === '머더미스터리' ? '머더미스터리 패키지' : '보드게임 한글판'}`}
                  className="admin-input"
                  style={{ flex: 1, minWidth: 0, fontSize: "0.85em" }}
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
                        <span style={{
                          display: "block", marginTop: "4px", fontSize: "0.7em",
                          color: "var(--admin-text-sub)", overflow: "hidden",
                          whiteSpace: "nowrap", textOverflow: "ellipsis"
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
