#!/usr/bin/env node
/**
 * BGG API 실제 데이터 수집 및 검증
 * Phase 1 + Phase 2: 데이터 수집 → 검증
 *
 * 사용 방법:
 *   개발 환경: npm run dev (터미널1) → node scripts/bgg_collect_and_validate.mjs (터미널2)
 *   프로덕션: NODE_ENV=production node scripts/bgg_collect_and_validate.mjs
 *
 * 환경 변수:
 *   API_BASE (선택사항): API 기본 URL (기본값: http://localhost:3000)
 *   LIMIT (선택사항): 조회할 게임 수 (기본값: 10)
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
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

// 설정
const isProduction = process.env.NODE_ENV === 'production';
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const LIMIT = parseInt(process.env.LIMIT || '10');

console.log('🎲 BGG API 실제 데이터 수집 및 검증\n');
console.log('⚙️  설정:');
console.log(`   - 환경: ${isProduction ? '🌐 프로덕션' : '🔧 개발'}`);
console.log(`   - API Base: ${API_BASE}`);
console.log(`   - 조회 수: ${LIMIT}개`);
console.log(`   - 모드: 실제 API 호출\n`);
console.log('📝 주의: 개발 환경에서는 "npm run dev" 후 실행하세요.\n');

/**
 * BGG XML API 직접 호출 (토큰 사용)
 */
async function fetchBGGGameDirect(bggId) {
  try {
    const url = `https://www.boardgamegeek.com/xmlapi2/thing?id=${bggId}&type=boardgame&stats=1`;
    const bggToken = env.VITE_BGG_API_TOKEN;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${bggToken}`,
        'User-Agent': 'DulGenius-Board-Game-Rental/1.0'
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await response.text();

    // XML 파싱
    const minPlayersMatch = xmlText.match(/<minplayers[^>]*value="(\d+)"/);
    const maxPlayersMatch = xmlText.match(/<maxplayers[^>]*value="(\d+)"/);
    const playtimeMatch = xmlText.match(/<playingtime[^>]*value="(\d+)"/);
    const weightMatch = xmlText.match(/<averageweight[^>]*value="([^"]+)"/);

    return {
      minPlayers: minPlayersMatch ? parseInt(minPlayersMatch[1]) : null,
      maxPlayers: maxPlayersMatch ? parseInt(maxPlayersMatch[1]) : null,
      playingtime: playtimeMatch ? parseInt(playtimeMatch[1]) : null,
      weight: weightMatch ? parseFloat(weightMatch[1]) : null,
    };
  } catch (e) {
    throw e;
  }
}

/**
 * 프록시를 통한 BGG API 호출 (개발 환경용)
 */
async function fetchBGGGameViaProxy(bggId) {
  try {
    // Vite 프록시 사용 (/bgg-thing으로 요청)
    const url = `${API_BASE}/bgg-thing?id=${bggId}&stats=1`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await response.text();

    // XML 파싱
    const minPlayersMatch = xmlText.match(/<minplayers[^>]*value="(\d+)"/);
    const maxPlayersMatch = xmlText.match(/<maxplayers[^>]*value="(\d+)"/);
    const playtimeMatch = xmlText.match(/<playingtime[^>]*value="(\d+)"/);
    const weightMatch = xmlText.match(/<averageweight[^>]*value="([^"]+)"/);

    return {
      minPlayers: minPlayersMatch ? parseInt(minPlayersMatch[1]) : null,
      maxPlayers: maxPlayersMatch ? parseInt(maxPlayersMatch[1]) : null,
      playingtime: playtimeMatch ? parseInt(playtimeMatch[1]) : null,
      weight: weightMatch ? parseFloat(weightMatch[1]) : null,
    };
  } catch (e) {
    throw e;
  }
}

/**
 * 데이터 검증
 */
function validateBGGData(game, bggData) {
  const errors = [];
  const warnings = [];

  if (!bggData) {
    errors.push('API 응답 없음');
    return { valid: false, errors, warnings };
  }

  // 필드 존재 여부
  if (bggData.minPlayers === null || bggData.minPlayers === undefined) {
    warnings.push('minPlayers 필드 없음');
  }
  if (bggData.maxPlayers === null || bggData.maxPlayers === undefined) {
    warnings.push('maxPlayers 필드 없음');
  }

  // 값의 범위 체크
  if (bggData.minPlayers && bggData.maxPlayers) {
    if (bggData.minPlayers > bggData.maxPlayers) {
      errors.push(`min(${bggData.minPlayers}) > max(${bggData.maxPlayers})`);
    }
    if (bggData.minPlayers <= 0 || bggData.maxPlayers <= 0) {
      errors.push('플레이어 수가 양수가 아님');
    }
  }

  if (bggData.playingtime && bggData.playingtime <= 0) {
    warnings.push('playtime이 양수가 아님');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 메인 프로세스
 */
async function main() {
  try {
    // Step 1: Supabase에서 게임 조회
    console.log('📥 Supabase에서 게임 데이터 조회 중...');
    const { data: games, error } = await supabase
      .from('games')
      .select('id, name, bgg_id, min_players, max_players, playingtime')
      .not('bgg_id', 'is', null)
      .limit(LIMIT);

    if (error) {
      throw new Error(`Supabase 조회 실패: ${error.message}`);
    }

    if (!games || games.length === 0) {
      throw new Error('BGG ID가 있는 게임을 찾을 수 없습니다.');
    }

    console.log(`✅ ${games.length}개 게임 조회 완료\n`);

    // Step 2: BGG 데이터 수집 및 검증
    const results = [];
    let successCount = 0;
    let validCount = 0;
    let warningCount = 0;
    let failCount = 0;

    for (let idx = 0; idx < games.length; idx++) {
      const game = games[idx];
      const num = idx + 1;

      process.stdout.write(`${num}/${games.length}. [ID:${game.id}] ${game.name} (BGG:${game.bgg_id})`);

      try {
        // BGG 데이터 조회
        let bggData;
        try {
          // 먼저 직접 API 시도
          bggData = await fetchBGGGameDirect(game.bgg_id);
          process.stdout.write(' ✅');
        } catch (e) {
          // 실패하면 프록시 시도
          process.stdout.write(' (proxy)');
          bggData = await fetchBGGGameViaProxy(game.bgg_id);
          process.stdout.write(' ✅');
        }

        // 검증
        const validation = validateBGGData(game, bggData);

        // 업데이트 필요 여부
        const needsUpdate =
          game.min_players !== bggData.minPlayers ||
          game.max_players !== bggData.maxPlayers ||
          game.playingtime !== bggData.playingtime;

        const resultEntry = {
          db_id: game.id,
          db_name: game.name,
          bgg_id: game.bgg_id,
          current: {
            min_players: game.min_players,
            max_players: game.max_players,
            playingtime: game.playingtime,
          },
          bgg_data: bggData,
          validation: validation,
          needs_update: needsUpdate,
          status: validation.valid ? 'valid' : 'warning'
        };

        results.push(resultEntry);

        if (validation.valid) {
          validCount++;
          process.stdout.write(' ✔️');
        } else if (validation.warnings.length > 0) {
          warningCount++;
          process.stdout.write(' ⚠️');
        } else {
          failCount++;
          process.stdout.write(' ❌');
        }

        successCount++;
        console.log();
      } catch (e) {
        failCount++;
        console.log(` ❌ ${e.message}`);
        results.push({
          db_id: game.id,
          db_name: game.name,
          bgg_id: game.bgg_id,
          status: 'failed',
          error: e.message
        });
      }

      // Rate limiting
      if (idx < games.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Step 3: 결과 저장
    const timestamp = new Date().toISOString().split('T')[0];
    const outputFile = path.join(projectRoot, `bgg_collected_data_${timestamp}.json`);
    const summary = {
      test_time: new Date().toISOString(),
      environment: isProduction ? 'production' : 'development',
      api_method: 'direct_api_call',
      total_games: games.length,
      success_count: successCount,
      valid_count: validCount,
      warning_count: warningCount,
      fail_count: failCount,
      results: results
    };

    fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2), 'utf-8');

    // Step 4: 리포트
    console.log('\n' + '='.repeat(60));
    console.log('📋 수집 및 검증 결과');
    console.log('='.repeat(60));
    console.log(`✅ 성공: ${successCount}/${games.length}`);
    console.log(`   - 유효: ${validCount}`);
    console.log(`   - 경고: ${warningCount}`);
    console.log(`❌ 실패: ${failCount}`);
    console.log(`\n📁 데이터 파일: ${outputFile}\n`);

    // 다음 단계 안내
    console.log('📌 다음 단계:');
    console.log('   1. 수집된 데이터 검토: bgg_collected_data_*.json');
    console.log('   2. SQL 마이그레이션 생성: node scripts/generate_migration.mjs');
    console.log('   3. 마이그레이션 적용 및 테스트\n');
  } catch (e) {
    console.error('🚨 오류:', e.message);
    process.exit(1);
  }
}

main();
