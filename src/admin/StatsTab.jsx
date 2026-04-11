// src/admin/StatsTab.jsx
// 설명: 관리자 통계 탭 — 대여 현황, 인기 게임, 채널별 비율, 인기 검색어

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { supabase } from '../lib/supabaseClient.jsx';

const CARD_STYLE = {
  background: 'var(--admin-card-bg)',
  border: '1px solid var(--admin-border)',
  borderRadius: '8px',
  padding: '20px',
};

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--admin-card-bg)',
    border: '1px solid var(--admin-border)',
    color: 'var(--admin-text-main)',
  },
};

const SOURCE_LABELS = {
  kiosk: '키오스크',
  app: '앱(찜)',
  admin: '관리자',
};

const SOURCE_COLORS = {
  kiosk: '#667eea',
  app: '#48bb78',
  admin: '#ed8936',
};

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

export default function StatsTab() {
  const [period, setPeriod] = useState(30);
  const [rentalStats, setRentalStats] = useState([]);
  const [topGames, setTopGames] = useState([]);
  const [overdueStats, setOverdueStats] = useState(null);
  const [sourceBreakdown, setSourceBreakdown] = useState([]);
  const [popularSearches, setPopularSearches] = useState([]);
  const [loading, setLoading] = useState(false);

  // 한 번만 로드되는 집계 카드 데이터
  const [currentlyRented, setCurrentlyRented] = useState(null);
  const [totalGames, setTotalGames] = useState(null);

  // 단독 쿼리 (period 무관)
  useEffect(() => {
    async function loadStaticStats() {
      try {
        const [rentedRes, gamesRes] = await Promise.all([
          supabase
            .from('rentals')
            .select('rental_id', { count: 'exact' })
            .eq('type', 'RENT')
            .is('returned_at', null),
          supabase.from('games').select('id', { count: 'exact' }),
        ]);
        if (rentedRes.error) console.error('rentals count error:', rentedRes.error);
        else setCurrentlyRented(rentedRes.count ?? 0);
        if (gamesRes.error) console.error('games count error:', gamesRes.error);
        else setTotalGames(gamesRes.count ?? 0);
      } catch (e) {
        console.error('loadStaticStats error:', e);
      }
    }
    loadStaticStats();
  }, []);

  // period 변경 시 RPC 동시 호출
  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      try {
        const [
          rentalStatsRes,
          topGamesRes,
          overdueStatsRes,
          sourceBreakdownRes,
          popularSearchesRes,
        ] = await Promise.all([
          supabase.rpc('get_rental_stats', { p_days: period }),
          supabase.rpc('get_top_rented_games', { p_limit: 10, p_days: period }),
          supabase.rpc('get_overdue_stats', { p_days: period }),
          supabase.rpc('get_rental_source_breakdown', { p_days: period }),
          supabase.rpc('get_popular_searches', { p_limit: 20, p_days: period }),
        ]);

        if (rentalStatsRes.error) console.error('get_rental_stats error:', rentalStatsRes.error);
        else setRentalStats(rentalStatsRes.data ?? []);

        if (topGamesRes.error) console.error('get_top_rented_games error:', topGamesRes.error);
        else setTopGames(topGamesRes.data ?? []);

        if (overdueStatsRes.error) console.error('get_overdue_stats error:', overdueStatsRes.error);
        else setOverdueStats(overdueStatsRes.data?.[0] ?? null);

        if (sourceBreakdownRes.error) console.error('get_rental_source_breakdown error:', sourceBreakdownRes.error);
        else setSourceBreakdown(sourceBreakdownRes.data ?? []);

        if (popularSearchesRes.error) console.error('get_popular_searches error:', popularSearchesRes.error);
        else setPopularSearches(popularSearchesRes.data ?? []);
      } catch (e) {
        console.error('StatsTab loadStats error:', e);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [period]);

  const totalRentCount = rentalStats.reduce((sum, row) => sum + (row.rent_count ?? 0), 0);

  const rentalChartData = rentalStats.map((row) => ({
    ...row,
    date: formatDate(row.date),
  }));

  const pieData = sourceBreakdown.map((row) => ({
    name: SOURCE_LABELS[row.source] ?? row.source,
    value: row.count ?? 0,
    source: row.source,
  }));

  return (
    <div style={{ color: 'var(--admin-text-main)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* 1. 기간 선택 버튼 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[7, 30, 90].map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: '8px 18px',
              borderRadius: '6px',
              border: '1px solid var(--admin-border)',
              background: period === p ? '#667eea' : 'var(--admin-card-bg)',
              color: period === p ? '#fff' : 'var(--admin-text-main)',
              cursor: 'pointer',
              fontWeight: period === p ? 'bold' : 'normal',
              transition: 'background 0.2s',
            }}
          >
            {p}일
          </button>
        ))}
      </div>

      {/* 2. 요약 카드 4개 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        {[
          { label: '총 대여 건수', value: loading ? '...' : totalRentCount },
          { label: '현재 대여 중', value: currentlyRented === null ? '...' : currentlyRented },
          { label: '연체율', value: loading ? '...' : `${overdueStats?.overdue_rate ?? 0}%` },
          { label: '총 게임 수', value: totalGames === null ? '...' : totalGames },
        ].map(({ label, value }) => (
          <div key={label} style={{ ...CARD_STYLE, textAlign: 'center' }}>
            <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--admin-text-main)' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ opacity: loading ? 0.4 : 1, pointerEvents: loading ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
        {/* 3. 대여량 추이 BarChart */}
        <div style={{ ...CARD_STYLE, marginBottom: '24px' }}>
          <h3 style={{ color: 'var(--admin-text-main)', marginTop: 0, marginBottom: '16px' }}>대여량 추이 (최근 {period}일)</h3>
          {rentalChartData.length === 0 ? (
            <div style={{ color: 'var(--admin-text-sub)', textAlign: 'center', padding: '40px' }}>데이터가 없습니다.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rentalChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" />
                <XAxis dataKey="date" stroke="#a0a0a0" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                <YAxis stroke="#a0a0a0" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ color: 'var(--admin-text-main)' }} />
                <Bar dataKey="rent_count" name="대여" fill="#667eea" />
                <Bar dataKey="return_count" name="반납" fill="#48bb78" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 4. 인기 게임 TOP 10 가로 BarChart */}
        <div style={{ ...CARD_STYLE, marginBottom: '24px' }}>
          <h3 style={{ color: 'var(--admin-text-main)', marginTop: 0, marginBottom: '16px' }}>인기 게임 TOP 10</h3>
          {topGames.length === 0 ? (
            <div style={{ color: 'var(--admin-text-sub)', textAlign: 'center', padding: '40px' }}>데이터가 없습니다.</div>
          ) : (
            <ResponsiveContainer width="100%" height={topGames.length * 40 + 40}>
              <BarChart
                layout="vertical"
                data={topGames}
                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" />
                <XAxis type="number" stroke="#a0a0a0" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="game_name"
                  width={140}
                  stroke="#a0a0a0"
                  tick={{ fill: '#a0a0a0', fontSize: 12 }}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value, name, props) => {
                    const avg = props?.payload?.avg_duration_hours;
                    return [
                      `${value}건${avg != null ? ` (평균 ${Math.round(avg)}시간)` : ''}`,
                      '대여 횟수',
                    ];
                  }}
                />
                <Bar dataKey="rent_count" name="대여 횟수" fill="#ed8936" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 5. 채널별 대여 비율 PieChart */}
        <div style={{ ...CARD_STYLE, marginBottom: '24px' }}>
          <h3 style={{ color: 'var(--admin-text-main)', marginTop: 0, marginBottom: '16px' }}>채널별 대여 비율</h3>
          {pieData.length === 0 ? (
            <div style={{ color: 'var(--admin-text-sub)', textAlign: 'center', padding: '40px' }}>데이터 수집 중</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
              <ResponsiveContainer width={220} height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#a0a0a0' }}
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={SOURCE_COLORS[entry.source] ?? '#718096'}
                      />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              {/* 범례 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {pieData.map((entry) => (
                  <div key={entry.source} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '3px', background: SOURCE_COLORS[entry.source] ?? '#718096' }} />
                    <span style={{ color: 'var(--admin-text-main)', fontSize: '0.9rem' }}>
                      {entry.name}: {entry.value}건
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 6. 인기 검색어 TOP 20 */}
        <div style={CARD_STYLE}>
          <h3 style={{ color: 'var(--admin-text-main)', marginTop: 0, marginBottom: '16px' }}>인기 검색어 TOP 20</h3>
          {popularSearches.length === 0 ? (
            <div style={{ color: 'var(--admin-text-sub)', textAlign: 'center', padding: '40px' }}>아직 검색 로그가 없습니다.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
                  {['순위', '검색어', '검색 횟수'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === '순위' ? 'center' : 'left',
                        padding: '8px 12px',
                        color: 'var(--admin-text-sub)',
                        fontWeight: 'normal',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {popularSearches.map((row, idx) => (
                  <tr
                    key={idx}
                    style={{ borderBottom: '1px solid var(--admin-border)' }}
                  >
                    <td style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--admin-text-sub)' }}>{idx + 1}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--admin-text-main)' }}>{row.query ?? '-'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--admin-text-main)' }}>{row.search_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
