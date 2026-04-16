#!/usr/bin/env node
/**
 * BGG API 파이프라인 - Mock 데이터로 검증
 * 목표: BGG API 연동 파이프라인 전체를 Mock 데이터로 테스트
 *
 * 실행: node scripts/bgg_pipeline_mock.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// 환경 변수 로드
const ENV_FILE = path.join(projectRoot, '.env.local');
const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#')) {
    const [key, ...rest] = line.split('=');
    env[key.trim()] = rest.join('=').trim();
  }
});

// Supabase 초기화
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Mock BGG 데이터 (실제 BGG API 응답 시뮬레이션)
 */
const mockBGGData = {
  11: { minPlayers: 2, maxPlayers: 4, playingtime: 60, weight: 2.5, name: 'Bonanza' },
  172403: { minPlayers: 2, maxPlayers: 5, playingtime: 45, weight: 1.8, name: 'Thieves of Gallows Peak' },
  303495: { minPlayers: 1, maxPlayers: 4, playingtime: 30, weight: 1.2, name: 'Paper Dungeons' },
  266192: { minPlayers: 2, maxPlayers: 5, playingtime: 35, weight: 2.0, name: 'Wishful Wishing' },
  2538: { minPlayers: 2, maxPlayers: 4, playingtime: 60, weight: 2.3, name: 'Seafarers of Catan' },
  6383: { minPlayers: 2, maxPlayers: 5, playingtime: 30, weight: 1.5, name: 'Da Vinci Code' },
  358055: { minPlayers: 2, maxPlayers: 6, playingtime: 50, weight: 1.9, name: 'CartaVentura: Oklahoma' },
  1927: { minPlayers: 1, maxPlayers: 5, playingtime: 60, weight: 1.3, name: 'Munchkin' },
  128668: { minPlayers: 2, maxPlayers: 4, playingtime: 40, weight: 2.1, name: 'Samurai Sword' },
  174430: { minPlayers: 1, maxPlayers: 4, playingtime: 60, weight: 2.2, name: 'Gloomhaven' },
};

/**
 * Mock BGG API 호출 (지연 포함)
 */
async function fetchBGGGameMock(bggId) {
  // 네트워크 지연 시뮬레이션
  await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

  // 실제 데이터
  if (mockBGGData[bggId]) {
    return mockBGGData[bggId];
  }

  // 일부 API 실패 시뮬레이션 (20% 확률)
  if (Math.random() < 0.2) {
    throw new Error(`Mock API failed for BGG ID ${bggId}`);
  }

  // 기본값 반환
  return {
    minPlayers: 2,
    maxPlayers: 4,
    playingtime: 45,
    weight: 2.0,
  };
}

/**
 * 메인 파이프라인 테스트
 */
async function main() {
  console.log('🎲 BGG API 파이프라인 - Mock 테스트\n');
  console.log('📋 이 스크립트는 실제 BGG API 호출 없이 파이프라인을 검증합니다.\n');

  // Step 1: Supabase에서 BGG ID 있는 게임 조회
  console.log('📥 Supabase에서 게임 데이터 조회 중...');
  const { data: games, error } = await supabase
    .from('games')
    .select('id, name, bgg_id, min_players, max_players, playingtime')
    .not('bgg_id', 'is', null);

  if (error) {
    console.error('❌ Supabase 조회 실패:', error.message);
    process.exit(1);
  }

  if (!games || games.length === 0) {
    console.error('❌ BGG ID가 있는 게임을 찾을 수 없습니다.');
    process.exit(1);
  }

  console.log(`✅ ${games.length}개 게임 조회 완료\n`);

  // Step 2: Mock BGG 데이터 수집
  const results = [];
  let successCount = 0;
  let failCount = 0;
  let updateCount = 0;

  for (let idx = 0; idx < games.length; idx++) {
    const game = games[idx];
    const num = idx + 1;

    process.stdout.write(`\n${num}. [ID:${game.id}] ${game.name}`);
    process.stdout.write(`\n   📍 BGG ID: ${game.bgg_id}`);

    try {
      // Mock BGG 데이터 조회
      const bggData = await fetchBGGGameMock(game.bgg_id);
      successCount++;

      // 현재 데이터와 비교
      const current = {
        min_players: game.min_players,
        max_players: game.max_players,
        playingtime: game.playingtime,
      };

      const updated = {
        min_players: bggData.minPlayers,
        max_players: bggData.maxPlayers,
        playingtime: bggData.playingtime,
      };

      // 변경 필요 여부 판단
      const needsUpdate =
        current.min_players !== updated.min_players ||
        current.max_players !== updated.max_players ||
        current.playingtime !== updated.playingtime;

      console.log(`\n   📊 현재값 → BGG값:`);
      console.log(`      - min: ${current.min_players} → ${updated.min_players}`);
      console.log(`      - max: ${current.max_players} → ${updated.max_players}`);
      console.log(`      - time: ${current.playingtime} → ${updated.playingtime}`);
      console.log(`      - difficulty: ${bggData.weight || 'N/A'}`);

      if (needsUpdate) {
        console.log(`   ⚠️  업데이트 필요`);
        updateCount++;
      } else {
        console.log(`   ✅ 데이터 일치`);
      }

      results.push({
        db_id: game.id,
        db_name: game.name,
        bgg_id: game.bgg_id,
        current,
        bgg_data: updated,
        weight: bggData.weight,
        needs_update: needsUpdate,
        status: 'success'
      });
    } catch (e) {
      failCount++;
      console.log(`\n   ❌ Mock API 호출 실패: ${e.message}`);
      results.push({
        db_id: game.id,
        db_name: game.name,
        bgg_id: game.bgg_id,
        status: 'failed',
        error: e.message
      });
    }

    // 진행 상황 표시
    const progress = ((idx + 1) / games.length * 100).toFixed(0);
    console.log(`   [진행률: ${progress}%]`);
  }

  // Step 3: 결과 저장
  const outputFile = path.join(projectRoot, 'bgg_pipeline_mock_results.json');
  const summary = {
    test_type: 'mock',
    test_time: new Date().toISOString(),
    total_games: games.length,
    success_count: successCount,
    fail_count: failCount,
    games_need_update: updateCount,
    results: results
  };

  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2), 'utf-8');

  // Step 4: 최종 리포트
  console.log('\n' + '='.repeat(60));
  console.log('📋 Mock 파이프라인 테스트 결과');
  console.log('='.repeat(60));
  console.log(`✅ 성공: ${successCount}/${games.length}`);
  console.log(`❌ 실패: ${failCount}/${games.length}`);
  console.log(`📈 업데이트 필요: ${updateCount}/${successCount}`);
  console.log(`\n📁 결과 파일: ${outputFile}`);

  // 업데이트 필요한 게임 목록
  if (updateCount > 0) {
    console.log(`\n⚠️  업데이트 필요한 게임 (${updateCount}개):`);
    results
      .filter(r => r.needs_update)
      .slice(0, 5)
      .forEach(game => {
        console.log(`   - [${game.db_id}] ${game.db_name}`);
        console.log(`     min: ${game.current.min_players} → ${game.bgg_data.min_players}, ` +
                    `max: ${game.current.max_players} → ${game.bgg_data.max_players}, ` +
                    `time: ${game.current.playingtime} → ${game.bgg_data.playingtime}`);
      });
    if (updateCount > 5) {
      console.log(`   ... 외 ${updateCount - 5}개`);
    }
  }

  console.log('\n✨ Mock 파이프라인 테스트 완료! (실제 API 연동은 배포 후 테스트)\n');
}

main().catch(err => {
  console.error('🚨 오류:', err);
  process.exit(1);
});
