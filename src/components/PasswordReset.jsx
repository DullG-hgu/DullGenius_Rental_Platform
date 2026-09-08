import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CONTACTS, DEVELOPERS } from '../infoData';
import { getSafeReturnPath } from '../lib/pendingRoute';

export default function PasswordReset() {
    const [searchParams] = useSearchParams();
    const returnPath = getSafeReturnPath(searchParams.get('redirect'));
    const loginPath = returnPath ? `/login?redirect=${encodeURIComponent(returnPath)}` : '/login';
    const contactEmail = DEVELOPERS[0]?.email || CONTACTS.email;
    const subject = encodeURIComponent('보드게임 대여소 비밀번호 초기화 요청');
    const body = encodeURIComponent('비밀번호 초기화를 요청합니다.\n이름: \n학번: \n\n본인 확인 절차를 안내해주세요.');

    return (
        <main style={styles.container}>
            <Link to={loginPath}>← 로그인으로 돌아가기</Link>
            <h1 style={{ fontSize: '1.5rem', marginTop: 24 }}>비밀번호 초기화 안내</h1>
            <p style={styles.paragraph}>비밀번호를 잊으셨다면 운영진에게 초기화를 요청해주세요. 본인 확인 후 초기화해 드립니다.</p>
            <a href={`mailto:${contactEmail}?subject=${subject}&body=${body}`} style={styles.button}>
                운영진에게 초기화 요청하기
            </a>
            <p style={styles.paragraph}>메일 앱이 열리지 않으면 동아리 채팅방이나 동아리방에서 운영진에게 이름과 학번을 알려주세요. 기존 비밀번호는 보내지 마세요.</p>
            <p style={styles.paragraph}>초기화 안내를 받으면 로그인한 뒤 <strong>마이페이지 → 비밀번호 변경</strong>에서 본인만 아는 비밀번호로 바꿔주세요.</p>
            <Link to={loginPath} style={{ display: 'inline-block', padding: '12px 0' }}>로그인하기</Link>
        </main>
    );
}

const styles = {
    container: { maxWidth: 440, margin: '60px auto', padding: 24, backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: 12 },
    paragraph: { lineHeight: 1.7, margin: '20px 0' },
    button: { display: 'block', padding: '14px 18px', backgroundColor: '#333', color: '#fff', borderRadius: 6, textAlign: 'center', textDecoration: 'none', fontWeight: 'bold' },
};
