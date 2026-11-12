// 회비 이체 캡처로 바로 인증 (spec_dues_capture.md §8).
// 미납으로 막힌 부원에게만 보인다. 회비 금액 설정이 없으면 아무것도 그리지 않는다(기존 「운영진 확인」 흐름만 남는다).
import { useEffect, useRef, useState } from 'react';
import { fetchDuesAmount, fetchDuesProofStatus, submitDuesProof } from '../api';
import { LINKS } from '../infoData';
import './DuesProofUpload.css';

const REJECT_MESSAGES = {
  amount_mismatch: (amount) => `회비 ${amount.toLocaleString()}원이 보이지 않아요. 회비를 보낸 화면인지 확인해 주세요.`,
  duplicate: () => '이미 인증에 쓰인 캡처예요.',
};

const ERROR_MESSAGES = {
  daily_limit: '오늘은 더 올릴 수 없어요. 운영진에게 문의해 주세요.',
  bad_image: '사진을 읽지 못했어요. 다른 사진으로 다시 올려 주세요.',
  too_large: '사진이 너무 커요. 화면 캡처로 다시 올려 주세요.',
  auth: '로그인이 풀렸어요. 다시 로그인해 주세요.',
  network: '연결이 끊겼어요. 잠시 후 다시 올려 주세요.',
};
const FALLBACK_ERROR = '지금은 자동 확인이 어려워요. 입금 뒤 운영진이 확인하면 반영돼요.';

export default function DuesProofUpload({ onApproved }) {
  const inputRef = useRef(null);
  const [amount, setAmount] = useState(null);
  const [status, setStatus] = useState(null);       // dues_my_proof_status 결과
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [result, setResult] = useState(null);       // { tone: 'ok'|'wait'|'warn', text }

  useEffect(() => {
    let active = true;
    Promise.all([fetchDuesAmount(), fetchDuesProofStatus()])
      .then(([nextAmount, nextStatus]) => {
        if (!active) return;
        setAmount(nextAmount);
        setStatus(nextStatus);
        // 가입 전에 입부 폼으로 낸 회비가 방금 연결됐다
        if (nextStatus?.eligibility === 'paid') onApproved?.();
      })
      .catch(() => {});
    return () => { active = false; };
    // 처음 한 번만 확인한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!amount || !status) return null;
  if (status.eligibility === 'need_form') {
    return (
      <div className="dues-proof">
        <p className="dues-proof-msg is-warn">
          입부 신청서가 확인되지 않아요. 신청서를 먼저 작성해 주세요. 이미 냈다면 가입한 학번이 신청서와 같은지 확인해 주세요.
        </p>
        <a href={LINKS.recruit} target="_blank" rel="noreferrer" className="action-link">입부 신청서 열기</a>
      </div>
    );
  }
  if (status.eligibility !== 'ok') return null;

  const waiting = !result && status.latest?.status === 'pending_review';

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    const res = await submitDuesProof(file, attempt);
    setBusy(false);
    if (!res?.ok) {
      setResult({ tone: 'warn', text: ERROR_MESSAGES[res?.error] || FALLBACK_ERROR });
      return;
    }
    if (res.status === 'approved') {
      setResult({ tone: 'ok', text: '회비 납부가 확인됐어요.' });
      onApproved?.();
    } else if (res.status === 'pending_review') {
      setResult({ tone: 'wait', text: '캡처를 받았어요. 운영진이 확인하면 반영돼요.' });
    } else if (res.status === 'retry') {
      setAttempt(2);
      setResult({ tone: 'warn', text: '금액이 잘 읽히지 않아요. 금액이 보이게 다시 캡처해서 올려 주세요.' });
    } else {
      const message = REJECT_MESSAGES[res.reason];
      setResult({ tone: 'warn', text: message ? message(amount) : '이 캡처로는 확인하지 못했어요. 이체 완료 화면을 올려 주세요.' });
    }
  };

  return (
    <div className="dues-proof">
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} hidden />
      <button type="button" className="dues-proof-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? '캡처 확인하는 중' : result?.tone === 'warn' ? '캡처 다시 올리기' : '이체 캡처로 바로 인증'}
      </button>
      {result ? (
        <p className={`dues-proof-msg is-${result.tone}`} role="status">{result.text}</p>
      ) : waiting ? (
        <p className="dues-proof-msg is-wait">올린 캡처를 운영진이 확인하고 있어요.</p>
      ) : (
        <p className="dues-proof-msg">
          {amount.toLocaleString()}원을 보낸 이체 완료 화면을 올리면 바로 확인돼요. 캡처는 회비 확인에만 쓰고 학기가 끝나면 지워요.
        </p>
      )}
    </div>
  );
}
