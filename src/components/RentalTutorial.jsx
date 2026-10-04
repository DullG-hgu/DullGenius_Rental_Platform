// src/components/RentalTutorial.jsx
// 최종 수정일: 2026.10.04
// 설명: 신규 부원용 대여 튜토리얼 — 한 장씩 넘기는 카드형 (스와이프·이전/다음·진행 점)
//   - 대여 4장 뒤에, 비로그인이면 「먼저 사이트 가입」 장, 비부원(비로그인·회비 미납)이면 「부원이 아니어도」 갈래 장이 붙는다
//   - 수령 장은 회비 검사 토글(app_config.payment_check_enabled)을 보고 평소/무료 대여 기간 문구를 바꾼다
//     (오피스아워 안내는 무료 대여 기간에만 의미가 있어 그때만 보여준다)
//   - 장마다 그림(public/tutorial/*.webp, 실제 화면 캡처)이 있으면 아이콘 대신 보여준다
//   - InfoModal 「이용 안내」 탭을 대체한다 (2026-10-04)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { fetchPaymentCheckEnabled } from '../api';
import { CLUB_INFO, LINKS } from '../infoData';
import { isPaidMember } from '../lib/membership';
import './RentalTutorial.css';

const SWIPE_THRESHOLD = 50;
const ROOM = CLUB_INFO.location.trim().replace(/\.$/, '');
// 키오스크엔 바로 대여 버튼이 없다(RentalModal 미사용) — 찜 → 「찜 수령하기」가 유일한 대여 경로
const PICKUP_IMAGE = { src: '/tutorial/kiosk-pickup.webp', alt: '키오스크 첫 화면 오른쪽 위의 찜 수령하기 버튼' };
// 열 때 한꺼번에 미리 받아 둔다 — 장을 넘길 때마다 빈칸에서 그림이 튀어나오지 않게
const TUTORIAL_IMAGES = ['/tutorial/search.webp', '/tutorial/dibs.webp', PICKUP_IMAGE.src, '/tutorial/kiosk-return.webp'];

// 받는 동안엔 자리표시(반짝임)로 자리를 잡아 두고, 다 받으면 서서히 드러낸다. 실패하면 아이콘으로 대신한다
function TutorialFigure({ image, icon }) {
    const [state, setState] = useState('loading');
    const imgRef = useRef(null);
    useEffect(() => {
        // 미리 받아 둔 그림은 onLoad 전에 이미 complete 일 수 있다
        const img = imgRef.current;
        if (img?.complete && img.naturalWidth) setState('loaded');
    }, []);
    if (state === 'error') return <div className="rt-icon" aria-hidden="true">{icon}</div>;
    return (
        <div className={`rt-figure${state === 'loaded' ? ' is-loaded' : ''}`}>
            <img
                ref={imgRef}
                src={image.src}
                alt={image.alt}
                decoding="async"
                onLoad={() => setState('loaded')}
                onError={() => setState('error')}
            />
        </div>
    );
}

function RentalTutorial({ isOpen, onClose, onOpenReport }) {
    const { user, profile, roles } = useAuth();
    const navigate = useNavigate();
    const [index, setIndex] = useState(0);
    // null = 아직 모름 → 평소(회비 검사 켜짐) 문구로 보여준다
    const [paymentCheck, setPaymentCheck] = useState(null);
    const touchStartX = useRef(null);
    const containerRef = useFocusTrap({ active: isOpen, onEscape: onClose });

    useEffect(() => {
        if (!isOpen) return;
        setIndex(0);
        TUTORIAL_IMAGES.forEach((src) => { const img = new Image(); img.src = src; });
        let active = true;
        fetchPaymentCheckEnabled()
            .then((v) => { if (active) setPaymentCheck(v); })
            .catch(() => { if (active) setPaymentCheck(true); });
        return () => { active = false; };
    }, [isOpen]);

    const goAndClose = (path) => {
        onClose();
        navigate(path);
    };

    const isFreePeriod = paymentCheck === false;
    const isMember = isPaidMember(user, profile, roles);

    const pages = useMemo(() => {
        const list = [];
        list.push(
            {
                key: 'search',
                icon: '🔍',
                image: { src: '/tutorial/search.webp', alt: '검색 화면 맨 위의 게임 이름 검색창' },
                title: '게임 찾기',
                body: (
                    <>
                        <p>검색창이나 카테고리로 빌리고 싶은 게임을 찾아요.</p>
                        <p>게임마다 <strong>대여 가능 · 찜 · 대여중</strong> 상태가 표시돼요.</p>
                    </>
                ),
            },
            {
                key: 'dibs',
                icon: '⚡',
                image: { src: '/tutorial/dibs.webp', alt: '게임 상세 아래쪽의 주황색 찜하기 버튼' },
                title: '찜하기',
                body: (
                    <>
                        <p>빌리려면 먼저 게임 상세에서 「찜하기」를 눌러요. <strong>30분 동안</strong> 나를 위해 잡아둬요.</p>
                        <p>30분 안에 받지 않으면 찜이 자동으로 풀려요.</p>
                        <p className="rt-note">동아리방에서 고를 땐 태블릿 화면의 QR을 폰으로 찍어 찜하면 돼요.</p>
                    </>
                ),
            },
            isFreePeriod ? {
                key: 'pickup',
                icon: '🆓',
                image: PICKUP_IMAGE,
                title: '지금은 무료 대여 기간!',
                body: (
                    <>
                        <p><strong>회비 없이</strong> 누구나 빌릴 수 있어요. 홈 위쪽에 「오피스아워 진행 중」이 떠 있을 때 동아리방({ROOM})으로 오세요.</p>
                        <p>문을 열자마자 <strong>오른쪽 책상 위 태블릿</strong>에서 「찜 수령하기」를 누르고 내 이름을 골라요.</p>
                    </>
                ),
            } : {
                key: 'pickup',
                icon: '🏠',
                image: PICKUP_IMAGE,
                title: '동아리방에서 받기',
                body: (
                    <>
                        <p>동아리방({ROOM}) 문을 열자마자 <strong>오른쪽 책상 위 태블릿</strong>에서 「찜 수령하기」를 누르고 내 이름을 골라요.</p>
                        <p>💳 <strong>회비를 낸 부원만</strong> 빌릴 수 있어요. 회비는 학기 초에 따로 안내해요.</p>
                    </>
                ),
            },
            {
                key: 'return',
                icon: '📦',
                image: { src: '/tutorial/kiosk-return.webp', alt: '키오스크 첫 화면 오른쪽 아래의 반납하기 버튼' },
                title: '다음날 자정까지 반납',
                body: (
                    <>
                        <p>다음 사람을 위해 <strong>빌린 다음날 자정까지</strong> 같은 태블릿에서 「반납하기」를 눌러 주세요.</p>
                        <p>빌린 게임은 <strong>마이페이지</strong>에서 확인할 수 있어요.</p>
                        <p className="rt-note">부품이 없어졌거나 망가졌다면 바로 알려 주세요.</p>
                        {onOpenReport && (
                            <div className="rt-actions">
                                <button type="button" className="rt-btn" onClick={() => { onClose(); onOpenReport(); }}>
                                    🚨 파손/분실 신고
                                </button>
                            </div>
                        )}
                    </>
                ),
            },
        );
        // 대여 흐름을 먼저 보여주고, 가입·비부원 갈래는 뒤에 붙인다
        if (!user) {
            list.push({
                key: 'join',
                icon: '👋',
                title: '빌리려면 사이트 가입이 필요해요',
                body: (
                    <>
                        <p>덜지니어스 보드게임은 <strong>동아리 부원</strong>이라면 빌릴 수 있어요.</p>
                        <p>이미 부원이라면 사이트에 가입하고 로그인해 주세요.</p>
                        <div className="rt-actions">
                            <button type="button" className="rt-btn is-primary" onClick={() => goAndClose('/signup')}>
                                ✨ 회원가입
                            </button>
                        </div>
                        <p className="rt-note">아직 부원이 아니라면 다음 장에서 방법을 골라 보세요.</p>
                    </>
                ),
            });
        }
        if (!isMember) {
            list.push({
                key: 'paths',
                icon: '🧭',
                compact: true, // 갈래 셋이 한 화면에 들어오게 아이콘을 줄인다
                title: '부원이 아니어도 빌릴 수 있어요',
                body: (
                    <div className="rt-paths">
                        <div className="rt-path">
                            <strong>🙋 덜지니어스 가입</strong>
                            <p>부원이 되면 다음 학기 1주차까지 무제한으로 보드게임을 빌릴 수 있어요.</p>
                            <a href={LINKS.recruit} target="_blank" rel="noopener noreferrer" className="rt-btn">
                                입부 신청하기 →
                            </a>
                        </div>
                        <div className={`rt-path${isFreePeriod ? ' is-live' : ''}`}>
                            <strong>🆓 무료 대여 기간 {isFreePeriod && <span className="rt-badge">지금 진행 중!</span>}</strong>
                            <p>학기 초 오피스아워에는 사이트에 가입만 하면 회비 없이 빌릴 수 있어요.</p>
                            {!user && (
                                <button type="button" className="rt-btn" onClick={() => goAndClose('/signup')}>
                                    사이트 회원가입 →
                                </button>
                            )}
                        </div>
                        <div className="rt-path">
                            <strong>🏢 비회원 단기 대여</strong>
                            <p>동아리·단체 행사용 유료 대여예요. 픽업 3일 전까지 신청해 주세요.</p>
                            <button type="button" className="rt-btn" onClick={() => goAndClose('/org-rental')}>
                                단기 대여 안내 →
                            </button>
                        </div>
                    </div>
                ),
            });
        }
        return list;
        // goAndClose·onClose는 렌더마다 새로 만들어지지만 동작이 같아 의존성에서 뺀다
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isMember, isFreePeriod, onOpenReport]);

    const last = pages.length - 1;
    const safeIndex = Math.min(index, last);
    const page = pages[safeIndex];

    const prev = () => setIndex((i) => Math.max(0, Math.min(i, last) - 1));
    const next = () => setIndex((i) => Math.min(last, i + 1));

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => {
            if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, last]);

    if (!isOpen) return null;

    const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
    const onTouchEnd = (e) => {
        if (touchStartX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (dx <= -SWIPE_THRESHOLD) next();
        else if (dx >= SWIPE_THRESHOLD) prev();
    };

    return (
        <div className="rt-overlay" onClick={onClose}>
            <div
                ref={containerRef}
                className="rt-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rt-title"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >
                <div className="rt-top">
                    <span className="rt-count">{safeIndex + 1} / {pages.length}</span>
                    <button type="button" className="rt-skip" onClick={onClose}>
                        {safeIndex === last ? '닫기' : '건너뛰기'}
                    </button>
                </div>

                <div className={`rt-page${page.compact ? ' is-compact' : ''}`} key={page.key} aria-live="polite">
                    {page.image ? (
                        <TutorialFigure image={page.image} icon={page.icon} />
                    ) : (
                        <div className="rt-icon" aria-hidden="true">{page.icon}</div>
                    )}
                    <h2 id="rt-title" className="rt-title">{page.title}</h2>
                    <div className="rt-body">{page.body}</div>
                </div>

                <div className="rt-dots" aria-hidden="true">
                    {pages.map((p, i) => (
                        <span key={p.key} className={i === safeIndex ? 'is-active' : ''} />
                    ))}
                </div>

                <div className="rt-nav">
                    <button type="button" className="rt-btn" onClick={prev} disabled={safeIndex === 0}>
                        ← 이전
                    </button>
                    {safeIndex < last ? (
                        <button type="button" className="rt-btn is-primary" onClick={next}>
                            다음 →
                        </button>
                    ) : user ? (
                        <button type="button" className="rt-btn is-primary" onClick={() => goAndClose('/search')}>
                            게임 둘러보기
                        </button>
                    ) : (
                        <button type="button" className="rt-btn is-primary" onClick={() => goAndClose('/signup')}>
                            회원가입하러 가기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default RentalTutorial;
