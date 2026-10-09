// src/pages/OrgRental.jsx — 행사·단체 대여 안내 (2026-10-09 개편, 구 '단기 대여')
// 신청은 구글 폼(LINKS.orgRentalForm) 그대로. 폼 제출은 Apps Script → ingest_rental_request 로 관리자 「외부 대여 신청」 탭에 쌓인다.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LINKS, CONTACTS } from '../infoData';
import { ORG_RENTAL_TEXTS as T } from '../constants';
import InfoModal from '../components/InfoModal';
import './OrgRental.css';

const OrgRental = () => {
    const navigate = useNavigate();
    const [showTerms, setShowTerms] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // 외부 공유 링크로 바로 들어오면 뒤로 갈 곳이 없으므로 홈으로
    const goBack = () => {
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/');
    };

    return (
        <div className="org-page">
            <header className="org-top">
                <button type="button" className="org-back" onClick={goBack} aria-label="뒤로가기">
                    ←
                </button>
                <span>{T.TITLE}</span>
            </header>

            <section className="org-hero">
                <h1>{T.TITLE}</h1>
                <p className="org-lead">{T.LEAD}</p>
                <p className="org-desc">{T.DESC}</p>
            </section>

            <section className="org-plans">
                {T.PLANS.map((plan) => (
                    <div key={plan.key} className={`org-plan is-${plan.key}`}>
                        <div className="org-plan-head">
                            <span className="org-badge">{plan.badge}</span>
                            <strong>{plan.title}</strong>
                        </div>
                        {plan.examples && (
                            <p className="org-plan-examples">{plan.examples.join(' · ')} 등</p>
                        )}
                        {plan.prices && (
                            <ul className="org-price-list">
                                {plan.prices.map((p) => (
                                    <li key={p.label}>
                                        <span>{p.label}</span>
                                        <strong>{p.price}</strong>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {plan.note && <p className="org-plan-note">{plan.note}</p>}
                    </div>
                ))}
            </section>

            <section className="org-section">
                <h2>{T.STEPS_TITLE}</h2>
                <ol className="org-steps">
                    {T.STEPS.map((step) => (
                        <li key={step.title}>
                            <strong>{step.title}</strong>
                            <span>{step.desc}</span>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="org-section">
                <h2>{T.PREPARE_TITLE}</h2>
                <ul className="org-checklist">
                    {T.PREPARE.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
                <Link to="/search" className="org-browse">{T.BROWSE_LINK} →</Link>
            </section>

            <section className="org-section org-caution">
                <h2>{T.CAUTION_TITLE}</h2>
                <ul>
                    {T.CAUTIONS.map((caution) => (
                        <li key={caution}>{caution}</li>
                    ))}
                </ul>
            </section>

            <p className="org-contact">
                문의 <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
            </p>

            <div className="org-cta">
                <a
                    href={LINKS.orgRentalForm}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="org-apply-btn"
                >
                    {T.BTN_APPLY}
                </a>
                <p>
                    신청 시{' '}
                    <button type="button" className="org-terms-link" onClick={() => setShowTerms(true)}>
                        동아리 이용 약관
                    </button>
                    에 동의한 것으로 간주합니다.
                </p>
            </div>

            <InfoModal
                isOpen={showTerms}
                onClose={() => setShowTerms(false)}
                initialTab="terms"
            />
        </div>
    );
};

export default OrgRental;
