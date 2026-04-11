import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LINKS, CONTACTS } from '../infoData';
import { ORG_RENTAL_TEXTS } from '../constants';
import InfoModal from '../components/InfoModal';
import './OrgRental.css';

const OrgRental = () => {
    const navigate = useNavigate();
    const [showTerms, setShowTerms] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="org-rental-container">
            <header className="org-header">
                <button className="back-btn" onClick={() => navigate(-1)}>
                    ← 뒤로가기
                </button>
                <h2>{ORG_RENTAL_TEXTS.TITLE}</h2>
            </header>

            <div className="org-content">
                <section className="org-section">
                    <h3>{ORG_RENTAL_TEXTS.GUIDE_TITLE}</h3>
                    <p>{ORG_RENTAL_TEXTS.GUIDE_DESC}</p>
                    <ul>
                        {ORG_RENTAL_TEXTS.RULES.map((rule, idx) => (
                            <li key={idx}><strong>{rule.label}:</strong> {rule.desc}</li>
                        ))}
                    </ul>
                </section>

                <section className="org-section caution">
                    <h3>{ORG_RENTAL_TEXTS.CAUTION_TITLE}</h3>
                    <ul>
                        {ORG_RENTAL_TEXTS.CAUTIONS.map((caution, idx) => (
                            <li key={idx}>{caution}</li>
                        ))}
                    </ul>
                </section>

                <div className="org-contact">
                    <p>문의사항: <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a></p>
                </div>

                <div className="org-action">
                    <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '10px', lineHeight: '1.5' }}>
                        신청 시{' '}
                        <button
                            onClick={() => setShowTerms(true)}
                            style={{ background: 'none', border: 'none', padding: 0, color: '#4a6cf7', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
                        >
                            동아리 이용 약관
                        </button>
                        에 동의한 것으로 간주합니다.
                    </p>
                    <a
                        href={LINKS.orgRentalForm}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="org-apply-btn"
                    >
                        {ORG_RENTAL_TEXTS.BTN_APPLY}
                    </a>
                </div>
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
