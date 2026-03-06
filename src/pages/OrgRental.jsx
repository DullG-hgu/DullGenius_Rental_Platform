import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LINKS, CONTACTS } from '../infoData';
import './OrgRental.css';

const OrgRental = () => {
    const navigate = useNavigate();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="org-rental-container">
            <header className="org-header">
                <button className="back-btn" onClick={() => navigate(-1)}>
                    ← 뒤로가기
                </button>
                <h2>🏢 외부 단체 대여 안내</h2>
            </header>

            <div className="org-content">
                <section className="org-section">
                    <h3>📌 대여 안내 및 규정</h3>
                    <p>
                        한동대학교 총학생회, NGO 등 학내외 자치 기구 및 단체 행사를 위한 보드게임 대여를 지원합니다.
                        원활한 대여 진행을 위해 아래 규정을 숙지해 주시기 바랍니다.
                    </p>
                    <ul>
                        <li><strong>신청 기간:</strong> 픽업 희망일 최소 3일 전까지 신청</li>
                        <li><strong>최대 개수:</strong> 단체당 1회 최대 10개 (협의 가능)</li>
                        <li><strong>대여 기간:</strong> 기본 2박 3일 (협의 후 연장 가능)</li>
                        <li><strong>보증금:</strong> 게임당 5,000원 (반납 시 파손/분실 확인 후 전액 환불)</li>
                        <li><strong>수령/반납 장소:</strong> 학관 2층 231호 동아리방 앞 (오피스아워 중 방문)</li>
                    </ul>
                </section>

                <section className="org-section caution">
                    <h3>🚨 주의사항</h3>
                    <ul>
                        <li>컴포넌트(말, 카드 등) 분실 및 고의 파손 시 정가의 100%를 배상해야 합니다.</li>
                        <li>반납 기한 연체 시 일자별로 패널티(보증금 차감)가 발생할 수 있습니다.</li>
                    </ul>
                </section>

                <div className="org-contact">
                    <p>문의사항: <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a></p>
                </div>

                <div className="org-action">
                    <a
                        href={LINKS.orgRentalForm}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="org-apply-btn"
                    >
                        📝 단체 대여 신청서 작성하기
                    </a>
                </div>
            </div>
        </div>
    );
};

export default OrgRental;
