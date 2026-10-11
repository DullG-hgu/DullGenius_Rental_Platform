import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import RenterWorkList, { RenterWorkListModal, groupRentalsByPerson, matchesPerson, needsAction } from '../src/admin/components/RenterWorkList';

const kst = (s) => new Date(`${s}+09:00`);
const NOW = kst('2026-10-11T15:00:00');

const games = [
  {
    id: 1, name: '카탄',
    rentals: [
      // 회원 찜 (renter_name 은 자리표시자 '회원')
      { rental_id: 'd1', type: 'DIBS', user_id: 'u1', renter_name: '회원', profiles: { name: '김민수' }, due_date: null, returned_at: null },
      // 비회원 수기 대여, 연체 (10/10 00:00 마감)
      { rental_id: 'r2', type: 'RENT', user_id: null, renter_name: '박수기', profiles: null, due_date: kst('2026-10-10T00:00:00').toISOString(), returned_at: null },
    ],
  },
  {
    id: 2, name: '스플렌더',
    rentals: [
      // 같은 회원의 대여 — 한 사람으로 묶인다
      { rental_id: 'r3', type: 'RENT', user_id: 'u1', renter_name: '김민수', profiles: { name: '김민수' }, due_date: kst('2026-10-18T23:59:59').toISOString(), returned_at: null },
      // 반납된 건은 빠진다
      { rental_id: 'r4', type: 'RENT', user_id: 'u2', renter_name: '이반납', due_date: null, returned_at: '2026-10-01T00:00:00Z' },
      // 연체 아닌 단순 대여
      { rental_id: 'r5', type: 'RENT', user_id: 'u3', renter_name: '구창민', profiles: { name: '구창민' }, due_date: kst('2026-10-18T23:59:59').toISOString(), returned_at: null },
    ],
  },
];
const users = [
  { id: 'u1', name: '김민수', student_id: '20231234', phone: '010-1111-2222' },
  { id: 'u3', name: '구창민', student_id: '20240001', phone: null },
];

describe('groupRentalsByPerson', () => {
  it('회원은 user_id, 비회원은 이름으로 묶고 반납된 건은 뺀다', () => {
    const people = groupRentalsByPerson(games, users, NOW);
    expect(people.map((p) => p.name)).toEqual(['김민수', '박수기', '구창민']); // 찜 → 연체 → 이름순
    const kim = people[0];
    expect(kim.rows.map((r) => r.rental.rental_id)).toEqual(['d1', 'r3']);
    expect(kim).toMatchObject({ dibs: 1, rents: 1, overdue: 0, studentId: '20231234', phone: '010-1111-2222', isMember: true });
    expect(people[1]).toMatchObject({ isMember: false, overdue: 1, maxOverdue: 2 }); // 10/10 00:00 마감 = 10/9 밤 12시 → 10/11 은 연체 2일
  });

  it('이름이 자리표시자뿐인 비회원 건은 서로 다른 사람일 수 있어 건별로 둔다', () => {
    const unnamed = [{ id: 9, name: '할리갈리', rentals: [
      { rental_id: 'x1', type: 'RENT', user_id: null, renter_name: '관리자', due_date: null, returned_at: null },
      { rental_id: 'x2', type: 'RENT', user_id: null, renter_name: '관리자', due_date: null, returned_at: null },
      { rental_id: 'x3', type: 'RENT', user_id: null, renter_name: '박수기', due_date: null, returned_at: null },
      { rental_id: 'x4', type: 'RENT', user_id: null, renter_name: '박 수기', due_date: null, returned_at: null },
    ] }];
    const people = groupRentalsByPerson(unnamed, [], NOW);
    expect(people.filter((p) => p.name === '관리자')).toHaveLength(2);
    expect(people.filter((p) => p.name.replace(/\s/g, '') === '박수기')).toHaveLength(1); // 이름이 있으면 묶는다
  });

  it('처리 필요 = 찜 또는 연체', () => {
    const people = groupRentalsByPerson(games, users, NOW);
    expect(people.filter(needsAction).map((p) => p.name)).toEqual(['김민수', '박수기']);
  });

  it('검색: 이름 일부·학번·초성만 친 경우 초성 매칭, 일반 글자는 초성으로 바꾸지 않는다', () => {
    const [kim, , gu] = groupRentalsByPerson(games, users, NOW);
    expect(matchesPerson(kim, '민수')).toBe(true);
    expect(matchesPerson(kim, '2023')).toBe(true);
    expect(matchesPerson(kim, 'ㄱㅁ')).toBe(true);
    // '김철' → 'ㄱㅊ' 으로 바꿔 비교하면 '구창민' 이 걸린다 (예전 공용 필터의 함정)
    expect(matchesPerson(gu, '김철')).toBe(false);
  });
});

describe('RenterWorkList (모달 내용)', () => {
  const handlers = () => ({
    onReceive: vi.fn(), onCancelDibs: vi.fn(), onReturn: vi.fn(), onExtend: vi.fn(), onMarkLost: vi.fn(),
  });
  const setup = (props = {}) => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const utils = render(<RenterWorkList games={games} users={users} {...h} {...props} />);
    return { h, ...utils };
  };
  afterEach(() => vi.useRealTimers());

  it('기본은 연체 칩, 사람별 묶음은 접혀 있고 머리줄에 대여·연체·찜 건수', () => {
    const { h } = setup();
    expect(screen.getByRole('button', { name: '연체 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '찜 수령 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '전체 3' })).toBeTruthy();

    const toggle = screen.getByRole('button', { name: /박수기/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(toggle).getByText('대여 1')).toBeTruthy();
    expect(within(toggle).getByText('연체 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '↩️ 반납' })).toBeNull(); // 접힘

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('연체 2일')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '↩️ 반납' }));
    expect(h.onReturn).toHaveBeenCalledWith(games[0], 'r2');
    fireEvent.click(screen.getByRole('button', { name: '📅 연장' }));
    expect(h.onExtend).toHaveBeenCalledWith(games[0], 'r2');
  });

  it('찜 수령 칩으로 바꿔 수령까지', () => {
    const { h } = setup();
    fireEvent.click(screen.getByRole('button', { name: '찜 수령 1' }));
    const toggle = screen.getByRole('button', { name: /김민수/ });
    expect(within(toggle).getByText('찜 1')).toBeTruthy();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '🤝 수령' }));
    expect(h.onReceive).toHaveBeenCalledWith(games[0], 'd1');
    expect(screen.getByRole('link', { name: /김민수 전화/ }).getAttribute('href')).toBe('tel:010-1111-2222');
  });

  it('처리 후 재조회(games 새 배열)에도 펼침·검색어 유지', () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { rerender } = render(<RenterWorkList games={games} users={users} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: '전체 3' }));
    fireEvent.click(screen.getByRole('button', { name: /김민수/ }));
    fireEvent.change(screen.getByLabelText('대여자 검색'), { target: { value: '민' } });

    rerender(<RenterWorkList games={structuredClone(games)} users={users} {...h} />);
    expect(screen.getByLabelText('대여자 검색').value).toBe('민');
    expect(screen.getByRole('button', { name: /김민수/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /구창민/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('검색은 칩과 무관하게 이름이 맞는 사람, 한 명이면 바로 펼치고 다시 접을 수 있다', () => {
    setup();
    act(() => { fireEvent.change(screen.getByLabelText('대여자 검색'), { target: { value: '창민' } }); });
    const gu = screen.getByRole('button', { name: /구창민/ });
    expect(gu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(gu);
    expect(gu.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('김민수')).toBeNull();
    act(() => { fireEvent.change(screen.getByLabelText('대여자 검색'), { target: { value: '없는사람' } }); });
    expect(screen.getByText('일치하는 대여자 없음')).toBeTruthy();
  });
});

describe('RenterWorkListModal', () => {
  const base = { games, users, onReceive: vi.fn(), onCancelDibs: vi.fn(), onReturn: vi.fn(), onExtend: vi.fn(), onMarkLost: vi.fn() };

  it('닫혀 있으면 아무것도 없고, 열면 대화상자. ESC·✕로 닫힌다', () => {
    const onClose = vi.fn();
    const { rerender } = render(<RenterWorkListModal isOpen={false} onClose={onClose} {...base} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<RenterWorkListModal isOpen onClose={onClose} {...base} />);
    expect(screen.getByRole('dialog', { name: /대여자별 처리/ })).toBeTruthy();
    // 첫 포커스(닫기 버튼)는 useFocusTrap 이 offsetParent 로 거르는데 jsdom 은 항상 null 이라 여기선 확인 불가 — 실기기 측정 항목
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('위에 확인 모달(.modal-overlay)이 떠 있으면 ESC 로 같이 닫히지 않는다', () => {
    const onClose = vi.fn();
    render(<><RenterWorkListModal isOpen onClose={onClose} {...base} /><div className="modal-overlay" /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('단체 대여(HOLD) 행', () => {
  // 기한 10/10 23:59:59 KST → 10/10 당일은 연체 아님, 10/11 부터 단체 연체 1일
  const holdGames = [{ id: 7, name: '아컴호러', rentals: [
    { rental_id: 'h1', type: 'HOLD', user_id: null, renter_name: '행사팀', due_date: kst('2026-10-10T23:59:59').toISOString(), returned_at: null },
  ] }];
  const base = { onReceive: vi.fn(), onCancelDibs: vi.fn(), onReturn: vi.fn(), onExtend: vi.fn(), onMarkLost: vi.fn() };

  it('반납 핸들러가 없으면 안내만, 있으면 「단체 반납」이 (game, rental) 로 부른다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { unmount } = render(<RenterWorkList games={holdGames} users={[]} {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /행사팀/ })); // 단체 연체도 연체 칩에 뜬다 — 펼쳐서 확인
    expect(screen.getByText('단체 연체 1일')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '↩️ 단체 반납' })).toBeNull();
    unmount();

    const onReturnHold = vi.fn();
    render(<RenterWorkList games={holdGames} users={[]} {...base} onReturnHold={onReturnHold} />);
    fireEvent.click(screen.getByRole('button', { name: /행사팀/ }));
    fireEvent.click(screen.getByRole('button', { name: '↩️ 단체 반납' }));
    expect(onReturnHold).toHaveBeenCalledWith(holdGames[0], holdGames[0].rentals[0]);
    vi.useRealTimers();
  });

  it('기한 당일은 단체 연체가 아니다', () => {
    const people = groupRentalsByPerson(holdGames, [], kst('2026-10-10T20:00:00'));
    expect(people[0].overdue).toBe(0);
    expect(needsAction(people[0])).toBe(false);
  });
});
