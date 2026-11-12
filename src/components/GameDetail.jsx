import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { fetchGameById, sendMiss, fetchReviews, addReview, updateReview, deleteReview, increaseViewCount, dibsGame, cancelDibsGame, sendLog, fetchPaymentCheckEnabled, fetchMyDuesAccounts } from '../api';
import { TEXTS } from '../constants';
import { translateGenre } from '../constants/genreMap';
import { useAuth } from '../contexts/AuthContext';
import { useGameData } from '../contexts/GameDataContext';
import { useToast } from '../contexts/ToastContext';
import NotFound from './NotFound';
import ConfirmModal from './ConfirmModal';
import QuizBadge from '../fun/quiz/QuizBadge';
import { GameTierCard, isMurder, ReviewerTierBadge, useTierBadges } from '../fun/tier/tierConnect';
import { fetchQuizBadges } from '../api_fun';
import InfoModal from './InfoModal';
import LazyImage from './common/LazyImage'; // [NEW] Lazy Image
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import { isPaidMember } from '../lib/membership';
import { rentalDDayLabel } from '../lib/rentalDue';
import { userMessage } from '../lib/userMessage';
import { CLUB_INFO } from '../infoData';
import DuesProofUpload from './DuesProofUpload';
import './GameDetail.css'; // [NEW] External CSS

const ROOM = CLUB_INFO.location.trim().replace(/\.$/, '');
const KST_DAY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
const KST_TIME = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

/** 수령 마감까지 남은 시간: 「27분」. 1분 미만도 「1분」으로 올려 보여 준다 */
const minutesLeft = (dueDate, nowMs) => Math.max(1, Math.ceil((Date.parse(dueDate) - nowMs) / 60000));

/**
 * 남이 잡고 있는 게임이 언제 풀리는지 한 줄. 알 수 없으면 null.
 * rentals 의 due_date 는 비회원에게도 열려 있는 컬럼이다 (이름·user_id 는 쓰지 않는다).
 */
const describeReturn = (rentals, nowMs) => {
  const active = (rentals || []).filter(r => r && !r.returned_at && r.due_date && !Number.isNaN(Date.parse(r.due_date)));
  const byDue = (a, b) => Date.parse(a.due_date) - Date.parse(b.due_date);
  const rent = active.filter(r => r.type === 'RENT').sort(byDue)[0];
  if (rent) {
    const due = Date.parse(rent.due_date);
    // 00:00 마감은 「그 전날 밤 12시」 — rentalDue.js 와 같은 기준으로 1ms 전 날짜를 반납일로 본다
    return due > nowMs ? `반납 예정일은 ${KST_DAY.format(new Date(due - 1))}이에요.` : '반납 기한이 지난 대여예요. 돌아오는 날은 아직 알 수 없어요.';
  }
  const dibs = active.filter(r => r.type === 'DIBS' && Date.parse(r.due_date) > nowMs).sort(byDue)[0];
  if (dibs) return `다른 부원이 찜했어요. ${KST_TIME.format(new Date(dibs.due_date))}까지 받아 가지 않으면 다시 풀려요.`;
  return null;
};

function GameDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, roles, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { games, loading: gamesLoading, error: gamesError, refreshGames } = useGameData();
  const { loading: authLoading } = useAuth();
  const loggedGameId = useRef(null);
  const [detail, setDetail] = useState(null);
  const [retry, setRetry] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [reviewsError, setReviewsError] = useState(null);
  const [quizBadges, setQuizBadges] = useState({});
  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const globalGame = games.find(item => String(item.id) === String(id));
  const currentDetail = detail?.id === id && detail?.userId === (user?.id ?? null) ? detail : null;
  const game = authLoading ? null : globalGame || currentDetail?.game;
  const loading = authLoading || (!game && (gamesLoading || !currentDetail));
  const gameError = globalGame ? gamesError : currentDetail?.error;
  const myRental = game?.rentals?.find(rental => user && rental.user_id === user.id && !rental.returned_at &&
    (rental.type === 'RENT' || (rental.type === 'DIBS' && Date.parse(rental.due_date) > Date.now())));
  // 상태 계산이 대표 대여자만 넘겨 주는 경우(renterId)까지 내 찜으로 본다
  const isMyDibs = myRental?.type === 'DIBS' ||
    (!myRental && (game?.status === "예약됨" || game?.status === "찜") && Boolean(user) && String(game.renterId) === String(user.id));
  const returnHint = game && !myRental ? describeReturn(game.rentals, Date.now()) : null;
  const [newReview, setNewReview] = useState({ rating: "5", comment: "" });
  const [cooldown, setCooldown] = useState(0);
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [editForm, setEditForm] = useState({ rating: "5", content: "" });
  const [isUpdating, setIsUpdating] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const tierBadges = useTierBadges(game, reviews); // 머더: 티어표를 공개한 리뷰 작성자의 등급
  const [videoId, setVideoId] = useState(null);

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    type: "info",
    subContent: null,
  });
  const [showTermsModal, setShowTermsModal] = useState(false);

  // 회비 검사: 서버는 찜을 받아 주고 키오스크 수령에서만 막는다. 걸어간 뒤에 거절당하지 않게 화면에서 먼저 막는다.
  // 검사 토글(무료 대여 기간이면 꺼짐)·면제 역할을 서버와 같은 기준으로 본다. 설정을 아직 못 읽었으면(null) 막지 않는다.
  const isMember = isPaidMember(user, profile, roles);
  const [paymentCheck, setPaymentCheck] = useState(null);
  const [isRecheckingDues, setIsRecheckingDues] = useState(false);
  const duesBlocked = Boolean(user) && !isMember && paymentCheck === true;
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 회비 계좌는 관리자 설정값 — 막힌 사람에게만 읽어 온다. 없거나 못 읽으면 문의 안내로 대신한다
  const [duesAccounts, setDuesAccounts] = useState([]);
  useEffect(() => {
    if (!duesBlocked) return;
    let active = true;
    fetchMyDuesAccounts().then(accounts => { if (active) setDuesAccounts(accounts); }).catch(() => {});
    return () => { active = false; };
  }, [duesBlocked]);

  useEffect(() => {
    if (authLoading || !user || isMember) return;
    let active = true;
    fetchPaymentCheckEnabled()
      .then(enabled => { if (active) setPaymentCheck(enabled); })
      .catch(() => {});
    return () => { active = false; };
  }, [authLoading, user, isMember]);

  // 찜 수령 마감 카운트다운 — 내 찜이 있을 때만 돈다
  const myDibsDue = myRental?.type === 'DIBS' ? myRental.due_date : null;
  useEffect(() => {
    if (!myDibsDue) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [myDibsDue]);

  const copyDuesAccount = async (number) => {
    try {
      await navigator.clipboard.writeText(number);
      showToast("계좌번호를 복사했어요.");
    } catch {
      showToast("복사하지 못했어요. 번호를 길게 눌러 복사해 주세요.", { type: "warning" });
    }
  };

  const recheckDues = async () => {
    if (isRecheckingDues) return;
    setIsRecheckingDues(true);
    try {
      await refreshProfile?.();
      setPaymentCheck(await fetchPaymentCheckEnabled());
    } catch {
      showToast("납부 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", { type: "error" });
    } finally {
      setIsRecheckingDues(false);
    }
  };

  const showConfirmModal = (title, message, onConfirm, type = "info", subContent = null) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type, subContent });
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null, type: "info", subContent: null });
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (id) increaseViewCount(id);
  }, [id]);

  useEffect(() => {
    if (!game || loggedGameId.current === id) return;
    loggedGameId.current = id;
    if (game.status !== '대여가능' && game.status !== '대여 불가') {
      sendLog(id, 'OUT_OF_STOCK_VIEW', { current_status: game.status });
    }
  }, [id, game]);

  useEffect(() => {
    if (authLoading || gamesLoading || globalGame) return;
    let active = true;
    setDetail(null);
    fetchGameById(id).then(game => {
      if (active) setDetail({ id, userId: user?.id ?? null, game, error: null });
    }).catch(error => {
      if (active) setDetail({ id, userId: user?.id ?? null, game: null, error });
    });
    return () => { active = false; };
  }, [id, user?.id, authLoading, gamesLoading, globalGame, retry]);

  useEffect(() => {
    let active = true;
    setReviews([]);
    setReviewsError(null);
    setIsReviewsLoading(true);
    fetchReviews(id).then(result => {
      if (!active) return;
      setReviews(result || []);
      // 성향검사 배지: 작성자가 마이페이지에서 공개를 켠 경우만 서버가 돌려준다. 실패해도 리뷰는 그대로 보인다
      fetchQuizBadges((result || []).map(r => r.user_id))
        .then(b => { if (active) setQuizBadges(b || {}); })
        .catch(() => {});
    }).catch(error => {
      if (active) setReviewsError(error);
    }).finally(() => { if (active) setIsReviewsLoading(false); });
    return () => { active = false; };
  }, [id, retry, reviewRefresh]);

  const retryData = () => {
    setDetail(null);
    setRetry(value => value + 1);
    refreshGames();
  };

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const getYoutubeId = (url) => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const openVideo = (url) => {
    sendLog(game.id, 'RESOURCE_CLICK', {
      type: 'YouTube Video',
      url: url
    });

    const vid = getYoutubeId(url);
    if (vid) {
      setVideoId(vid);
      setVideoModalOpen(true);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleRent = async () => {
    if (!user) {
      showConfirmModal("로그인 필요", "찜하려면 덜지니어스 부원 계정으로 로그인해야 해요.\n로그인 화면으로 이동할까요?", () => {
        navigate("/login", { state: { from: location.pathname + location.search } });
      }, "info");
      return;
    }
    if (duesBlocked) return;

    const termsNotice = (
      <div style={{ marginTop: '12px', padding: '8px 12px', background: '#f1ecfd', borderRadius: '8px', fontSize: '0.875rem', color: '#5f5c6c', lineHeight: '1.5', textAlign: 'left' }}>
        <span>대여 시 </span>
        <button onClick={() => setShowTermsModal(true)} style={{ background: 'none', border: 'none', padding: 0, color: '#5b2bd6', fontWeight: 'bold', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
          동아리 이용 약관
        </button>
        <span>에 동의한 것으로 간주합니다.</span>
      </div>
    );

    showConfirmModal(
      "찜하기 확인",
      `'${game.name}'을(를) 찜할까요?\n30분 안에 동아리방(${ROOM}) 태블릿에서 받아야 해요.`,
      async () => {
        try {
          const result = await dibsGame(game.id, user.id);

          if (result.success) {
            await refreshGames({ gamesOnly: true });
            setRetry(value => value + 1);
            showToast("찜 완료. 아래 안내대로 30분 안에 받아 주세요.");
          } else {
            showToast(result.message || "찜하지 못했어요.", { type: "error" });
          }
        } catch {
          showToast("찜하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.", { type: "error" });
        }
      },
      "primary",
      termsNotice
    );
  };

  const handleCancelDibs = async () => {
    showConfirmModal(
      "찜 취소",
      `'${game.name}' 찜을 취소할까요?`,
      async () => {
        try {
          const result = await cancelDibsGame(game.id, user.id);
          if (result.success) {
            await refreshGames({ gamesOnly: true });
            setRetry(value => value + 1);
            showToast("찜이 취소되었습니다.");
          } else {
            showToast(result.message || "찜을 취소하지 못했어요.", { type: "error" });
          }
        } catch {
          showToast("찜을 취소하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.", { type: "error" });
        }
      },
      "danger"
    );
  };

  const handleMiss = async () => {
    showConfirmModal(
      "입고 요청",
      TEXTS.ALERT_MISS_CONFIRM,
      async () => {
        await sendMiss(game.id);
        // [NEW] 입고 요청 로그 기록
        sendLog(game.id, 'STOCK_REQUEST', { game_name: game.name });
        showToast(TEXTS.ALERT_MISS_SUCCESS);
      },
      "info"
    );
  };

  const handleSubmitReview = async () => {
    if (!user) return showToast("로그인이 필요합니다.", { type: "warning" });
    if (!newReview.comment) return showToast("내용을 입력해주세요.", { type: "warning" });
    if (cooldown > 0) return showToast(`조금만 기다려주세요(${cooldown}초)`, { type: "info" });

    setIsReviewSubmitting(true);
    try {
      await addReview({
        ...newReview,
        game_id: game.id,
        user_name: profile?.name || user.email?.split('@')[0] || "익명",
      });

      showToast(TEXTS.ALERT_REVIEW_SUCCESS);
      setNewReview({ rating: "5", comment: "" });
      setCooldown(10);

      setReviewRefresh(value => value + 1);

    } catch (e) {
      showToast(userMessage(e, "리뷰를 등록하지 못했어요. 잠시 후 다시 시도해 주세요."), { type: "error" });
    } finally {
      setIsReviewSubmitting(false);
    }
  };

  const handleStartEdit = (review) => {
    setEditingReviewId(review.review_id);
    setEditForm({ rating: String(review.rating), content: review.content });
  };

  const handleCancelEdit = () => {
    setEditingReviewId(null);
    setEditForm({ rating: "5", content: "" });
  };

  const handleUpdateReview = async (reviewId) => {
    if (!editForm.content.trim()) return showToast("내용을 입력해주세요.", { type: "warning" });
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await updateReview(reviewId, editForm);
      showToast(TEXTS.ALERT_REVIEW_UPDATE_SUCCESS);
      handleCancelEdit();
      setReviewRefresh(value => value + 1);
    } catch (e) {
      showToast(userMessage(e, "리뷰를 수정하지 못했어요. 잠시 후 다시 시도해 주세요."), { type: "error" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteReview = (reviewId) => {
    showConfirmModal(
      "리뷰 삭제",
      "정말로 이 리뷰를 삭제하시겠습니까?",
      async () => {
        try {
          await deleteReview(reviewId);
          showToast(TEXTS.ALERT_REVIEW_DELETE_SUCCESS);
          setReviewRefresh(value => value + 1);
        } catch (e) {
          showToast(userMessage(e, "리뷰를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요."), { type: "error" });
        }
      },
      "danger"
    );
  };

  if (loading && !game) return <div className="loading-container"><div className="spinner"></div></div>;
  if (!game && gameError) return <div role="alert" style={{ padding: "20px", textAlign: "center" }}>
    <p>게임 정보를 불러오지 못했습니다.</p><button onClick={retryData}>다시 시도</button>
  </div>;
  if (!game) return <NotFound title="게임을 찾을 수 없습니다." description="주소를 확인하거나 다른 게임을 검색해 주세요." />;

  const handleBack = () => {
    if (location.state?.from) {
      navigate(location.state.from);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="game-detail-container">
      <button onClick={handleBack} className="detail-back-btn">← 뒤로가기</button>

      {gameError && <div role="alert"><p>최신 게임 정보를 불러오지 못했습니다. 표시된 재고가 달라질 수 있습니다.</p><button onClick={retryData}>다시 시도</button></div>}
      {/* 게임 정보 카드 */}
      <div className="detail-card">
        {game.image && (
          <LazyImage
            src={getOptimizedImageUrl(game.image, 600)}
            fallbackSrc={game.image}
            alt={game.name}
            className="detail-img"
            style={{ height: '300px', backgroundColor: 'transparent', width: '100%' }}
            aspectRatio={null}
          />
        )}
        <h2 className="detail-title">{game.name}</h2>

        {/* 스마트 뱃지 버튼 */}
        <div className="detail-actions">
          {game.video_url && (
            <button
              onClick={() => openVideo(game.video_url)}
              className="action-btn video"
            >
              영상 가이드
            </button>
          )}
          {game.manual_url && (
            <button
              onClick={() => {
                sendLog(game.id, 'RESOURCE_CLICK', {
                  type: 'Manual PDF',
                  url: game.manual_url
                });
                window.open(game.manual_url, '_blank');
              }}
              className="action-btn manual"
            >
              설명서 보기
            </button>
          )}
        </div>
        <p className="detail-category">
          {game.category}
          {game.genres && game.genres.length > 0 && ` | ${game.genres.map(translateGenre).join(', ')}`}
        </p>

        {/* 플레이 가능 인원 */}
        {(game.min_players || game.max_players) && (
          <p className="detail-players">
            {game.min_players && game.min_players === game.max_players ? `${game.min_players}명` : `${game.min_players || "?"}~${game.max_players || "?"}명`}
          </p>
        )}

        {/* 추천 문구 */}
        {game.recommendation_text && (
          <div className="detail-recommendation">
            {game.recommendation_text}
          </div>
        )}

        <div className="detail-stats">
          <div>
            <div className="stat-label">난이도</div>
            <div className="stat-value difficulty">{game.difficulty || "-"}<span className="stat-label"> / 5</span></div>
          </div>
          <div>
            <div className="stat-label">상태</div>
            <div className={`stat-value ${game.status === "대여가능" ? "status-available" : "status-unavailable"}`}>
              {game.status}
              {game.status === "대여가능" && game.available_count > 0 && (
                <span className="stat-sub">{game.available_count}{game.quantity >= 2 ? ` / ${game.quantity}` : ""}개 남음</span>
              )}
            </div>
          </div>
          {game.playingtime && (
            <div>
              <div className="stat-label">플레이 시간</div>
              <div className="stat-value">{game.playingtime}{typeof game.playingtime === 'number' ? '분' : ''}</div>
            </div>
          )}
        </div>

        {/* 머더: 왼쪽 모두의 티어 · 오른쪽 내 티어(없으면 평가하러 가기) */}
        {isMurder(game) && <GameTierCard game={game} />}

        <div className="main-action-area">
          {game.status === "대여 불가" ? (
            <button disabled className="main-btn using">대여 불가 (열람 전용)</button>
          ) : isMyDibs ? (
            <section className="pickup-panel" aria-label="찜 수령 안내">
              <p className="pickup-head">
                <strong>찜 완료</strong>
                {myDibsDue && <span className="pickup-left">수령 마감까지 {minutesLeft(myDibsDue, nowMs)}분</span>}
              </p>
              <ol className="pickup-steps">
                <li>동아리방({ROOM})으로 와요. {CLUB_INFO.roomDays}에 이용할 수 있어요.</li>
                <li>문을 열자마자 오른쪽 책상 위 태블릿에서 「찜 수령하기」를 눌러요.</li>
                <li>내 이름을 골라요.</li>
              </ol>
              {duesBlocked ? (
                <p className="pickup-note is-warn">이번 학기 회비 납부가 확인돼야 받을 수 있어요.</p>
              ) : (
                <p className="pickup-note">시간 안에 받지 않으면 찜이 자동으로 풀려요.</p>
              )}
              <button onClick={handleCancelDibs} className="main-btn cancel">찜 취소</button>
            </section>
          ) : myRental?.type === 'RENT' ? (
            <div className="action-note">
              <strong>내가 빌린 게임</strong>
              <p>{rentalDDayLabel(myRental.due_date)}</p>
              <Link to="/mypage" className="action-link">마이페이지에서 대여 확인</Link>
            </div>
          ) : game.status === "대여가능" ? (
            duesBlocked ? (
              <div className="action-note">
                <strong>회비 납부 후 대여 가능</strong>
                <p>이번 학기 회비 납부가 확인되면 찜할 수 있어요.</p>
                {duesAccounts.length > 0 ? (
                  <>
                    {duesAccounts.map((account) => (
                      <div key={account.number} className="dues-account">
                        <span>회비 계좌{duesAccounts.length > 1 ? ' (아무 곳이나)' : ''}</span>
                        <strong>{account.bank} {account.number}</strong>
                        {account.holder && <span>예금주 {account.holder}</span>}
                        <button onClick={() => copyDuesAccount(account.number)} className="action-link">계좌번호 복사</button>
                      </div>
                    ))}
                    <p>입금 뒤 운영진이 확인하면 반영돼요.</p>
                  </>
                ) : (
                  <p>납부 방법은 운영진에게 문의해 주세요.</p>
                )}
                <button onClick={recheckDues} disabled={isRecheckingDues} className="action-link">
                  {isRecheckingDues ? "확인하는 중" : "방금 냈다면 다시 확인"}
                </button>
                <DuesProofUpload onApproved={recheckDues} />
              </div>
            ) : (
              <>
                <button onClick={handleRent} className="main-btn rent">찜하기 (30분)</button>
                <p className="action-hint">30분 동안 잡아 두고, 동아리방 태블릿에서 받아 가요.<br />동아리방 이용일은 {CLUB_INFO.roomDays}이에요.</p>
              </>
            )
          ) : game.status === "예약됨" || game.status === "찜" || game.status === "대여중" || game.status === "이용중" ? (
            <>
              <button disabled className="main-btn using">지금은 빌릴 수 없어요</button>
              {returnHint && <p className="action-hint">{returnHint}</p>}
            </>
          ) : (
            <button onClick={handleMiss} className="main-btn miss">아쉬워요 (입고 요청)</button>
          )}
        </div>
      </div>

      {/* 리뷰 섹션 */}
      <div className="review-section">
        <h3>리뷰 남기기</h3>
        {!user ? (
          <div className="login-plz">
            <p>로그인 후 리뷰를 남길 수 있습니다.</p>
            <button onClick={() => navigate("/login", { state: { from: location.pathname + location.search } })} className="login-btn-small">로그인하기</button>
          </div>
        ) : (
          <div className="review-input-box">
            <div className="review-header-row">
              <div style={{ fontWeight: "bold", color: "#5f5c6c" }}>
                작성자: <span style={{ color: "#1d1a26" }}>{profile?.name || "익명"}</span>
              </div>
              <select
                className="review-rating-select"
                value={newReview.rating}
                onChange={e => setNewReview({ ...newReview, rating: e.target.value })}
                aria-label="별점 선택"
              >
                <option value="5">⭐⭐⭐⭐⭐ (5점)</option>
                <option value="4">⭐⭐⭐⭐ (4점)</option>
                <option value="3">⭐⭐⭐ (3점)</option>
                <option value="2">⭐⭐ (2점)</option>
                <option value="1">⭐ (1점)</option>
              </select>
            </div>
            <div className="review-body-row">
              <textarea
                className="review-text-input"
                placeholder={isMurder(game) ? "후기를 남겨주세요 · 진상·범인 언급은 금지" : "후기를 남겨주세요"}
                value={newReview.comment}
                onChange={e => setNewReview({ ...newReview, comment: e.target.value })}
              />
              <button
                onClick={handleSubmitReview}
                disabled={isReviewSubmitting || cooldown > 0}
                className="review-submit-btn"
                style={{
                  background: cooldown > 0 ? "#8f8b9c" : "#5b2bd6",
                  cursor: cooldown > 0 ? "not-allowed" : "pointer"
                }}
              >
                {cooldown > 0 ? `${cooldown} s` : "등록"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 리뷰 목록 */}
      <div className="review-list">
        <h4 className="review-list-title">
          리뷰 ({reviews.length})
        </h4>
        {reviewsError && <div role="alert">리뷰를 불러오지 못했습니다. <button onClick={() => setReviewRefresh(value => value + 1)}>리뷰 다시 시도</button></div>}
        {isReviewsLoading ? <div>리뷰 불러오는 중...</div> : (
          (reviews || []).map(r => (
            <div key={r.review_id} className="review-item">
              {editingReviewId === r.review_id ? (
                /* 인라인 수정 폼 */
                <div className="review-edit-form">
                  <div className="review-edit-header">
                    <strong>{r.author_name || r.user_name || "익명"}</strong>
                    <select
                      className="review-rating-select"
                      value={editForm.rating}
                      onChange={e => setEditForm({ ...editForm, rating: e.target.value })}
                      aria-label="별점 선택"
                    >
                      <option value="5">⭐⭐⭐⭐⭐ (5점)</option>
                      <option value="4">⭐⭐⭐⭐ (4점)</option>
                      <option value="3">⭐⭐⭐ (3점)</option>
                      <option value="2">⭐⭐ (2점)</option>
                      <option value="1">⭐ (1점)</option>
                    </select>
                  </div>
                  <textarea
                    className="review-text-input"
                    value={editForm.content}
                    onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                    style={{ marginTop: "8px" }}
                  />
                  <div className="review-edit-actions">
                    <button className="review-action-btn save" onClick={() => handleUpdateReview(r.review_id)} disabled={isUpdating}>{isUpdating ? "저장 중..." : "저장"}</button>
                    <button className="review-action-btn cancel" onClick={handleCancelEdit} disabled={isUpdating}>취소</button>
                  </div>
                </div>
              ) : (
                /* 일반 리뷰 표시 */
                <>
                  <div className="review-item-header">
                    <span className="review-author">
                      <strong>{r.author_name || r.user_name || "익명"}</strong>
                      {quizBadges[r.user_id] && <QuizBadge badge={quizBadges[r.user_id]} authorName={r.author_name || r.user_name || "익명"} />}
                      <ReviewerTierBadge tier={tierBadges[r.user_id]} />
                    </span>
                    <span style={{ color: "#f1c40f" }}>{"⭐".repeat(r.rating)}</span>
                  </div>
                  <div style={{ color: "#333", whiteSpace: "pre-wrap" }}>{r.content}</div>
                  <div className="review-item-footer">
                    <span className="review-date">{new Date(r.created_at).toLocaleDateString()}</span>
                    {user && r.user_id === user.id && (
                      <div className="review-owner-actions">
                        <button className="review-action-btn edit" onClick={() => handleStartEdit(r)}>수정</button>
                        <button className="review-action-btn delete" onClick={() => handleDeleteReview(r.review_id)}>삭제</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
        {reviews.length === 0 && !isReviewsLoading && !reviewsError && <div style={{ color: "#5f5c6c", textAlign: "center", padding: "20px" }}>아직 리뷰가 없습니다. 첫 리뷰를 남겨주세요!</div>}
      </div>

      {/* 유튜브 모달 */}
      {
        videoModalOpen && (
          <div className="video-modal-overlay" onClick={() => setVideoModalOpen(false)}>
            <div className="video-modal-content">
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
              <button
                onClick={(e) => { e.stopPropagation(); setVideoModalOpen(false); }}
                className="video-close-btn"
              >
                &times;
              </button>
            </div>
          </div>
        )
      }

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        subContent={confirmModal.subContent}
      />
      <InfoModal isOpen={showTermsModal} onClose={() => setShowTermsModal(false)} initialTab="terms" />
    </div >
  );
}
export default GameDetail;
