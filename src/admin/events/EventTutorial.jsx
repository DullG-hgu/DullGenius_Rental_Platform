// 행사 시스템 튜토리얼 — 코드 모르는 후임자용 인앱 가이드
// EventsListPage / EventDetailPage 각 서브탭에서 호출 가능. initialSection으로 특정 섹션부터 열기.
import React, { useState, useEffect, useRef } from 'react';

const SECTIONS = [
  { id: 'overview',      icon: '🌱', title: '시작하기 — 행사 시스템이란?' },
  { id: 'create',        icon: '📝', title: '1단계 · 행사 만들기' },
  { id: 'info',          icon: '⚙️', title: '2단계 · 정보 입력 (가격·일정·콘텐츠)' },
  { id: 'publish',       icon: '🚀', title: '3단계 · 모집 공개' },
  { id: 'registrations', icon: '👥', title: '4단계 · 신청자 관리' },
  { id: 'payments',      icon: '💳', title: '5단계 · 입금 확인 (수동 매칭)' },
  { id: 'checkin',       icon: '✅', title: '6단계 · 당일 출석 체크' },
  { id: 'export',        icon: '📤', title: '7단계 · CSV로 명단 내보내기' },
  { id: 'tips',          icon: '💡', title: '자주 묻는 질문 · 팁' },
];

export default function EventTutorial({ initialSection = 'overview', onClose }) {
  const [active, setActive] = useState(initialSection);
  const contentRef = useRef(null);

  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [active]);

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const idx = SECTIONS.findIndex((s) => s.id === active);
  const prev = idx > 0 ? SECTIONS[idx - 1] : null;
  const next = idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        {/* 헤더 */}
        <div style={header}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)' }}>📖 행사 시스템 튜토리얼</div>
            <h2 style={{ margin: '2px 0 0', fontSize: '1.1rem' }}>{SECTIONS[idx]?.icon} {SECTIONS[idx]?.title}</h2>
          </div>
          <button onClick={onClose} style={closeBtn} title="닫기 (ESC)">✕</button>
        </div>

        <div style={body}>
          {/* 좌측 목차 */}
          <nav style={sidebar}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{ ...sideItem, ...(s.id === active ? sideItemActive : {}) }}
              >
                <span style={{ width: 22, display: 'inline-block' }}>{s.icon}</span>
                <span>{s.title.replace(/^\d+단계 · /, '')}</span>
              </button>
            ))}
          </nav>

          {/* 우측 본문 */}
          <div ref={contentRef} style={content}>
            <SectionContent id={active} />

            <div style={navRow}>
              {prev ? (
                <button onClick={() => setActive(prev.id)} style={navBtn}>← {prev.icon} {prev.title.replace(/^\d+단계 · /, '')}</button>
              ) : <span />}
              {next ? (
                <button onClick={() => setActive(next.id)} style={navBtnPrimary}>{next.icon} {next.title.replace(/^\d+단계 · /, '')} →</button>
              ) : (
                <button onClick={onClose} style={navBtnPrimary}>완료 ✓</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// === 각 섹션 본문 ===
function SectionContent({ id }) {
  switch (id) {
    case 'overview': return <OverviewSection />;
    case 'create': return <CreateSection />;
    case 'info': return <InfoSection />;
    case 'publish': return <PublishSection />;
    case 'registrations': return <RegistrationsSection />;
    case 'payments': return <PaymentsSection />;
    case 'checkin': return <CheckinSection />;
    case 'export': return <ExportSection />;
    case 'tips': return <TipsSection />;
    default: return null;
  }
}

function OverviewSection() {
  return (
    <Article>
      <P>
        이 시스템은 동아리에서 개최하는 <Strong>유료/무료 행사</Strong>(예: 할리갈리 학부 대항전)의 모집 페이지·신청 접수·입금 확인·당일 출석 체크·명단 정리까지 한 곳에서 처리하는 도구입니다.
      </P>
      <Callout type="info" title="이 튜토리얼의 흐름">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>행사 만들기 → 정보 입력 → 모집 공개</li>
          <li>참가자가 신청 → 입금 → (운영진이) 입금 확인</li>
          <li>당일 출석 체크 → 종료 후 CSV로 명단 받기</li>
        </ol>
      </Callout>
      <H>핵심 개념 3가지</H>
      <Grid>
        <ConceptCard icon="🎫" title="신청 = 입금 대기">
          참가자가 신청하면 곧바로 확정되는 게 아니라 "입금 대기" 상태가 됩니다. 운영진이 통장 입금 내역을 보고 매칭해서 "입금 완료"로 바꿔야 자리가 확보됩니다.
        </ConceptCard>
        <ConceptCard icon="💰" title="3단계 가격">
          한 행사에 <Code>정회원 / 비회원 / 현장결제</Code> 3가지 가격을 따로 설정합니다. 시스템이 신청자의 회비 납부 여부를 보고 자동으로 가격을 계산합니다.
        </ConceptCard>
        <ConceptCard icon="🔢" title="정원 관리">
          정원이 차면 자동으로 "대기자"가 됩니다. 누가 취소하면 운영진이 대기자를 한 명씩 "승계" 시킬 수 있습니다.
        </ConceptCard>
      </Grid>
      <Callout type="tip" title="결제 방식">
        카드 결제(PG)는 사용하지 않습니다. <Strong>계좌 입금</Strong>으로 받고, 운영진이 통장을 보면서 매칭하는 방식입니다. 토스/카카오페이 송금 링크는 자동으로 만들어 안내합니다.
      </Callout>
    </Article>
  );
}

function CreateSection() {
  return (
    <Article>
      <P>행사 목록 화면에서 시작합니다.</P>
      <Steps>
        <Step n={1}>
          좌측 메뉴 또는 관리자 홈에서 <Strong>🎪 행사 관리</Strong> 클릭
        </Step>
        <Step n={2}>
          우측 상단 <Strong>+ 새 행사</Strong> 버튼 클릭
        </Step>
        <Step n={3}>
          <Strong>행사명</Strong> 입력 — 예: "할리갈리 학부 대항전"
        </Step>
        <Step n={4}>
          <Strong>슬러그(URL)</Strong> 입력 — 예: <Code>halligalli-2026</Code>
          <Sub>주소창에 들어갈 영문 식별자입니다. 영문 소문자·숫자·하이픈만 가능, 3~64자.<br />공개 페이지 주소가 됩니다: <Code>/event/halligalli-2026</Code></Sub>
        </Step>
        <Step n={5}>
          <Strong>만들기</Strong> 클릭 → 자동으로 정보 입력 화면으로 이동
        </Step>
      </Steps>
      <Callout type="info" title="초안(draft) 상태로 만들어집니다">
        만들자마자 일반 사용자에게 노출되지 않습니다. 정보를 다 채운 다음에 "공개"로 바꾸면 됩니다. <Strong>걱정 말고 만드세요.</Strong>
      </Callout>
      <Callout type="tip" title="비슷한 행사를 또 열 때는?">
        목록에서 <Strong>복제</Strong> 버튼을 누르면 콘텐츠·디자인·가격은 그대로 복사되고 일정과 신청자만 비워진 새 초안이 생깁니다. 매번 처음부터 만들지 마세요.
      </Callout>
    </Article>
  );
}

function InfoSection() {
  return (
    <Article>
      <P>"정보" 탭에서 행사의 모든 세부 사항을 입력합니다. 위에서 아래로 차례대로 채워주세요.</P>
      <Steps>
        <Step n={1} title="기본 정보">
          제목·부제목·설명. <Strong>설명</Strong>은 모집 페이지의 본문이 됩니다 (줄바꿈 그대로 표시).
        </Step>
        <Step n={2} title="디자인">
          배경색·강조색·메인 이미지. 색상은 클릭해서 고르거나 hex 코드(<Code>#ff7700</Code>) 직접 입력. 메인 이미지는 모집 페이지 상단 배너로 들어갑니다.
        </Step>
        <Step n={3} title="일정·장소">
          모집 시작/마감, 행사 시작/종료, 장소.
          <Sub>모집 마감이 지나면 신청 버튼이 비활성화됩니다. 행사 시작 시각은 모집 마감보다 뒤여야 합니다.</Sub>
        </Step>
        <Step n={4} title="정원·참가 방식">
          <Strong>정원</Strong> 비우면 무제한, 숫자 입력하면 그만큼만 받고 이후엔 대기자.
          <Sub>참가 방식: 개인전 / 팀전 / 둘 다 — 팀전은 팀장이 팀을 만들고 초대 코드로 팀원을 모읍니다.</Sub>
        </Step>
        <Step n={5} title="가격 (3단계)">
          <Strong>정회원 / 비회원 / 현장결제</Strong> 각각 입력.
          <Sub>예: 정회원 5,000원 · 비회원 8,000원 · 현장 10,000원. <br />0원이면 무료. <br />"현장결제 허용" 체크박스를 끄면 사전 입금만 받습니다.</Sub>
        </Step>
        <Step n={6} title="결제 안내">
          은행/계좌번호/예금주, 입금 마감 시간(시간 단위), 토스·카카오페이 송금 링크.
          <Sub>입력하면 신청자에게 "X시간 안에 입금하세요" 안내와 송금 버튼이 자동 생성됩니다.</Sub>
        </Step>
        <Step n={7} title="콘텐츠">
          진행 일정 / FAQ / 상품 안내 / 환불 정책 — 모집 페이지 하단에 보일 내용. 비워둬도 OK.
        </Step>
        <Step n={8} title="추가 질문 (선택)">
          신청서에 받을 질문 추가. 예: "선호 부서?", "식사 옵션?". 텍스트·드롭다운·체크박스 가능.
        </Step>
        <Step n={9} title="동의 항목">
          개인정보 수집 동의(필수 권장), 사진 촬영 동의 — 신청 폼에 자동 표시.
        </Step>
      </Steps>
      <Callout type="warn" title="저장하는 걸 잊지 마세요">
        화면 하단 <Strong>저장</Strong> 버튼을 눌러야 반영됩니다. 다른 탭으로 이동하기 전에 꼭 저장하세요.
      </Callout>
    </Article>
  );
}

function PublishSection() {
  return (
    <Article>
      <P>정보 입력이 끝났으면 모집을 시작합니다.</P>
      <Steps>
        <Step n={1}>
          정보 탭 상단 <Strong>상태</Strong>를 <Code>초안(draft)</Code>에서 <Code>모집중(recruiting)</Code>으로 변경
        </Step>
        <Step n={2}>
          하단 <Strong>저장</Strong> 클릭
        </Step>
        <Step n={3}>
          상단 <Strong>👁️ 공개 페이지 보기</Strong> 버튼으로 실제 노출 화면 확인
          <Sub>새 탭에서 열려요. 이미지·가격·일정이 의도대로 나오는지 점검.</Sub>
        </Step>
        <Step n={4}>
          링크(<Code>/event/슬러그</Code>)를 카톡·인스타·포스터 QR로 배포
        </Step>
      </Steps>
      <H>상태 종류</H>
      <Table>
        <tr><Td><Code>draft</Code></Td><Td>초안 — 일반 사용자에게 보이지 않음</Td></tr>
        <tr><Td><Code>recruiting</Code></Td><Td>모집중 — 신청 가능</Td></tr>
        <tr><Td><Code>closed</Code></Td><Td>마감 — 페이지는 보이지만 신청 불가</Td></tr>
        <tr><Td><Code>ongoing</Code></Td><Td>진행중 — 행사 당일 (출석 체크 단계)</Td></tr>
        <tr><Td><Code>finished</Code></Td><Td>종료 — 모든 신청·정산 마무리</Td></tr>
      </Table>
      <Callout type="tip" title="모집 시간으로 자동 제어됩니다">
        상태를 <Code>recruiting</Code>으로 두어도 "모집 시작" 시각 전이거나 "모집 마감" 이후면 신청 버튼이 자동으로 비활성화됩니다. 굳이 매번 상태를 바꿀 필요는 없어요.
      </Callout>
    </Article>
  );
}

function RegistrationsSection() {
  return (
    <Article>
      <P>"신청자" 탭에서 누가 신청했는지·어떤 상태인지를 한눈에 봅니다.</P>
      <H>표 보는 법</H>
      <Steps>
        <Step n={1} title="상단 통계">
          입금대기 / 입금완료 / 대기자 / 취소 — 한 줄 요약. 클릭이 아니라 그냥 카운터.
        </Step>
        <Step n={2} title="필터·검색">
          상태·팀·이름/학번으로 좁혀 보기. 여러 필터를 같이 적용 가능.
        </Step>
        <Step n={3} title="액션 버튼">
          각 줄 우측에 상황별 버튼이 나타납니다.
          <Sub>
            · 입금대기 → <Strong>입금확인</Strong> (버튼 한 번에 입금 완료 처리)<br />
            · 입금완료 → <Strong>입금취소</Strong> (실수로 눌렀을 때) / <Strong>환불</Strong><br />
            · 대기자 → <Strong>승계</Strong> (정원에 자리가 났을 때 한 명 끌어올림)<br />
            · 모든 활성 → <Strong>취소</Strong> (운영자 취소, 사유 입력)
          </Sub>
        </Step>
      </Steps>
      <H>수동 등록 / 무료 초대</H>
      <Steps>
        <Step n={1} title="+ 수동 등록">
          현장에서 신청서 받지 않고 바로 등록할 때. 회원 검색 → 등급 선택 → "입금 완료로 처리" 체크 가능.
        </Step>
        <Step n={2} title="🎁 무료 초대">
          심사위원·게스트 등 <Strong>무료 참가자</Strong>를 초청할 때. 자동으로 초대 등급(invited)·금액 0원·입금 완료 상태로 들어갑니다.
        </Step>
      </Steps>
    </Article>
  );
}

function PaymentsSection() {
  return (
    <Article>
      <P>은행 앱에서 입금 내역을 보면서 누가 냈는지 매칭하는 화면입니다.</P>
      <Callout type="info" title="자동 매칭의 핵심: 예상 입금자명">
        신청자가 신청할 때 "어떤 이름으로 입금할지" 미리 적습니다. 시스템은 그 이름과 실제 입금 내역의 이름을 비교해서 자동 매칭합니다.
      </Callout>
      <H>가장 빠른 처리 방법</H>
      <Steps>
        <Step n={1}>
          은행 앱·홈페이지에서 해당 계좌 거래 내역 조회 → <Strong>입금자명만</Strong> 복사
          <Sub>예시:<br />홍길동<br />김철수<br />이영희</Sub>
        </Step>
        <Step n={2}>
          좌측 <Strong>"입금자명 붙여넣기"</Strong> 박스에 그대로 붙여넣기
          <Sub>이름은 한 줄에 하나씩. 시스템이 띄어쓰기·대소문자 무시하고 자동 매칭.</Sub>
        </Step>
        <Step n={3}>
          우측 표가 초록색으로 표시되는 줄들 = 자동 매칭됨
        </Step>
        <Step n={4}>
          <Strong>"매칭 항목 모두 선택"</Strong> 버튼 → <Strong>"✓ 선택 N건 입금 확인"</Strong> 클릭
        </Step>
        <Step n={5}>
          매칭 안 된 사람(이름 다르게 입금한 경우 등)은 개별로 <Strong>입금확인</Strong> 버튼 클릭
        </Step>
      </Steps>
      <H>마감 시간 처리</H>
      <P>입금 마감 시간이 지난 미입금 신청은 <Strong>⏰ 미입금 만료 처리</Strong> 버튼 한 번으로 일괄 취소됩니다. 정원에 묶여 있던 자리가 풀려서 대기자가 들어올 수 있게 됩니다.</P>
      <Callout type="warn" title="만료는 신중하게">
        만료 처리는 한 번에 모두 취소되니, 정말 마감이 지났는지 확인하고 누르세요. 실수로 만료시킨 사람은 "수동 등록"으로 다시 넣을 수 있습니다.
      </Callout>
    </Article>
  );
}

function CheckinSection() {
  return (
    <Article>
      <P>당일 행사장 입구에서 한 명씩 빠르게 체크하기 위한 화면입니다. 노트북·태블릿 모두 OK.</P>
      <Steps>
        <Step n={1}>
          행사장에서 노트북 켜고 이 탭 열기 → 검색창에 자동 포커스됨
        </Step>
        <Step n={2}>
          참가자에게 <Strong>학번이나 이름</Strong> 물어보고 입력
          <Sub>학번이 더 빠르고 동명이인 걱정 없음.</Sub>
        </Step>
        <Step n={3}>
          한 명만 검색되면 <Strong>Enter</Strong> 키로 바로 출석 처리
          <Sub>여러 명이면 목록에서 우측 "✓ 출석" 버튼 클릭.</Sub>
        </Step>
        <Step n={4}>
          체크 후 검색창이 자동으로 비워짐 → 곧바로 다음 사람 처리
        </Step>
      </Steps>
      <H>상단 통계</H>
      <P><Strong>출석 대상 / 완료 / 남음</Strong> 카운터로 진행도 한눈에. 90% 넘기면 입장 정리하는 식으로 활용.</P>
      <Callout type="tip" title="기본 필터 = 출석 대상만">
        화면에 입금 완료한 사람만 보입니다. 입금 안 된 사람을 체크하려면 우측 드롭다운을 "모든 신청"으로 바꾸세요 (확인 알림이 뜹니다).
      </Callout>
    </Article>
  );
}

function ExportSection() {
  return (
    <Article>
      <P>회계 정산·이력 보관·대학 행정 제출용 명단을 Excel로 만드는 화면입니다.</P>
      <Steps>
        <Step n={1} title="범위 선택">
          활성 신청만 / 입금완료만 / 전체 — 보통은 <Strong>입금완료만</Strong>으로 받으면 됩니다.
        </Step>
        <Step n={2} title="컬럼 선택">
          필요한 항목만 체크 (이름·학번·연락처·금액·입금자명 등). 기본값으로도 충분한 경우가 많습니다.
        </Step>
        <Step n={3} title="추가 질문 답변 포함">
          정보 탭에서 추가 질문을 만들었다면 체크하세요. 답변이 컬럼으로 추가됩니다.
        </Step>
        <Step n={4} title="미리보기 확인 → 다운로드">
          우측에 첫 5행이 미리 보입니다. 이상 없으면 <Strong>⬇ CSV 다운로드</Strong>.
          <Sub>파일명: <Code>슬러그_신청자_YYYY-MM-DD.csv</Code></Sub>
        </Step>
      </Steps>
      <Callout type="info" title="Excel에서 한글 깨짐 방지">
        UTF-8 BOM이 자동으로 들어가서 Excel에서 그냥 더블클릭해 열어도 한글이 안 깨집니다.
      </Callout>
    </Article>
  );
}

function TipsSection() {
  return (
    <Article>
      <H>자주 묻는 질문</H>
      <FAQ q="신청자가 잘못된 이름으로 입금했어요.">
        "신청자" 탭에서 그 사람을 찾아 <Strong>입금확인</Strong>을 직접 눌러주세요. 또는 입금 탭에서 개별 입금확인 버튼 사용.
      </FAQ>
      <FAQ q="정원을 늘리고 싶어요.">
        "정보" 탭에서 정원을 수정하고 저장. 자리가 늘어나면 대기자들에게 자동으로 자리가 가지는 않으므로, "신청자" 탭에서 대기자별로 <Strong>승계</Strong> 버튼을 눌러주세요.
      </FAQ>
      <FAQ q="현장에서 카드/현금으로 받았어요.">
        "+ 수동 등록"에서 회원 선택 후 <Strong>등급=현장결제</Strong>, <Strong>"입금 완료로 처리" 체크</Strong>. 메모란에 "현장 현금 5천원" 같은 기록을 남기면 좋습니다.
      </FAQ>
      <FAQ q="비회원 가격을 깜빡하고 정회원 가격으로 신청했어요.">
        해당 신청을 취소하고 다시 신청하라고 안내하거나, "신청자" 탭에서 운영자 취소 후 "+ 수동 등록"으로 다시 등록(올바른 등급으로). 부분 환불 기능은 없습니다.
      </FAQ>
      <FAQ q="환불 처리하면 자동으로 돈이 돌아가나요?">
        아니요. 환불은 <Strong>상태만 바뀝니다</Strong>. 실제 송금은 운영진이 은행 앱으로 직접 보내야 합니다. 시스템은 "환불됨" 기록만 남깁니다.
      </FAQ>
      <FAQ q="행사를 잘못 만들었어요. 지울 수 있나요?">
        목록에서 <Strong>삭제</Strong> 버튼. 신청자가 있어도 삭제 가능 (소프트 삭제 — 복구는 개발자에게 문의). 진짜 잘못 만들었으면 일찍 지우는 게 낫습니다.
      </FAQ>
      <FAQ q="모집 페이지 디자인이 마음에 안 들어요.">
        "정보 → 디자인"에서 배경색·강조색·메인 이미지를 바꾸고 저장 → 공개 페이지 보기로 확인. 색상만 바꿔도 분위기가 크게 달라집니다.
      </FAQ>
      <FAQ q="작년 행사를 또 열고 싶어요.">
        목록에서 <Strong>복제</Strong> → 일정만 새로 입력. 콘텐츠·가격·디자인은 그대로 복사됩니다.
      </FAQ>
      <H>운영 팁</H>
      <Ul>
        <li><Strong>모집 마감 24시간 전</Strong>에 미입금자에게 카톡 안내 한 번 돌리면 입금률이 크게 올라요.</li>
        <li><Strong>입금 마감 직후</Strong>에 "미입금 만료" 누르고, 대기자들에게 자리 났다고 안내.</li>
        <li><Strong>당일 1시간 전</Strong>에 출석 화면 미리 열어두기 (노트북·충전기·인터넷 확인).</li>
        <li><Strong>행사 종료 직후</Strong> CSV 받아두기 — 시간이 지나면 누가 왔는지 기억이 안 납니다.</li>
      </Ul>
    </Article>
  );
}

// === 작은 부품들 ===
const Article = ({ children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>;
const P = ({ children }) => <p style={{ margin: 0, lineHeight: 1.65, color: 'var(--admin-text-main)' }}>{children}</p>;
const H = ({ children }) => <h3 style={{ margin: '6px 0 0', fontSize: '1rem', color: 'var(--admin-text-main)', borderBottom: '1px solid var(--admin-border)', paddingBottom: 6 }}>{children}</h3>;
const Strong = ({ children }) => <strong style={{ color: 'var(--admin-primary)' }}>{children}</strong>;
const Sub = ({ children }) => <div style={{ marginTop: 6, fontSize: '0.85rem', color: 'var(--admin-text-sub)', lineHeight: 1.6 }}>{children}</div>;
const Code = ({ children }) => <code style={{ background: 'var(--admin-bg)', padding: '2px 6px', borderRadius: 3, fontSize: '0.85em', color: 'var(--admin-text-main)' }}>{children}</code>;
const Ul = ({ children }) => <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: 'var(--admin-text-main)' }}>{children}</ul>;

const Steps = ({ children }) => <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</ol>;
const Step = ({ n, title, children }) => (
  <li style={{ display: 'flex', gap: 12, padding: 12, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 6 }}>
    <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--admin-primary)', color: '#000', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>{n}</div>
    <div style={{ flex: 1, color: 'var(--admin-text-main)', lineHeight: 1.6 }}>
      {title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>}
      {children}
    </div>
  </li>
);

const Callout = ({ type = 'info', title, children }) => {
  const palette = {
    info: { bg: 'rgba(52,152,219,0.08)', bd: '#3498db', icon: 'ℹ️' },
    tip:  { bg: 'rgba(39,174,96,0.08)',  bd: '#27ae60', icon: '💡' },
    warn: { bg: 'rgba(230,126,34,0.1)',  bd: '#e67e22', icon: '⚠️' },
  }[type];
  return (
    <div style={{ background: palette.bg, borderLeft: `3px solid ${palette.bd}`, padding: '10px 14px', borderRadius: 4 }}>
      <div style={{ fontWeight: 600, color: 'var(--admin-text-main)', marginBottom: 4 }}>{palette.icon} {title}</div>
      <div style={{ color: 'var(--admin-text-main)', fontSize: '0.9rem', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
};

const Grid = ({ children }) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>{children}</div>;
const ConceptCard = ({ icon, title, children }) => (
  <div style={{ padding: 12, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 6 }}>
    <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{icon}</div>
    <div style={{ fontWeight: 600, color: 'var(--admin-text-main)', marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)', lineHeight: 1.55 }}>{children}</div>
  </div>
);

const Table = ({ children }) => (
  <div style={{ background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, overflow: 'hidden' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
  </div>
);
const Td = ({ children }) => <td style={{ padding: '8px 12px', borderTop: '1px solid var(--admin-border)', color: 'var(--admin-text-main)', fontSize: '0.88rem' }}>{children}</td>;

const FAQ = ({ q, children }) => (
  <details style={{ background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 6 }}>
    <summary style={{ padding: 12, cursor: 'pointer', color: 'var(--admin-text-main)', fontWeight: 600 }}>Q. {q}</summary>
    <div style={{ padding: '0 12px 12px', color: 'var(--admin-text-main)', fontSize: '0.9rem', lineHeight: 1.65 }}>{children}</div>
  </details>
);

// === 스타일 ===
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modal = { background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 10, width: '100%', maxWidth: 980, height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'var(--admin-text-main)' };
const header = { padding: '14px 20px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 };
const closeBtn = { width: 32, height: 32, borderRadius: 4, background: 'transparent', border: '1px solid var(--admin-border)', color: 'var(--admin-text-main)', cursor: 'pointer', fontSize: '1rem' };
const body = { flex: 1, display: 'flex', minHeight: 0 };
const sidebar = { width: 240, background: 'var(--admin-bg)', borderRight: '1px solid var(--admin-border)', padding: 12, overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 };
const sideItem = { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--admin-text-sub)', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem', lineHeight: 1.4 };
const sideItemActive = { background: 'var(--admin-card-bg)', color: 'var(--admin-text-main)', fontWeight: 600, borderLeft: '3px solid var(--admin-primary)' };
const content = { flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 };
const navRow = { marginTop: 'auto', paddingTop: 20, display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--admin-border)' };
const navBtn = { padding: '8px 14px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' };
const navBtnPrimary = { padding: '8px 16px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' };
