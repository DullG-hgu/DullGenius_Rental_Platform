#!/usr/bin/env node
/**
 * BGG API 프로토타입 - Node.js 기반
 * 목표: BGG API 연동 확인 및 10개 게임 샘플 수집
 *
 * 실행 방법:
 *   DEV:  npm run dev 후, 다른 터미널에서: node scripts/bgg_api_prototype.mjs
 *   PROD: node scripts/bgg_api_prototype.mjs (자동으로 Netlify 함수 호출)
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

// BGG 토큰
const bggToken = env.VITE_BGG_API_TOKEN;

// API 기본 URL (프로덕션)
const isProduction = process.env.NODE_ENV === 'production';
const API_BASE = process.env.API_BASE || 'https://dullgboardgamerent.netlify.app';

/**
 * BGG XML 파싱 (상세 정보)
 */
function parseBGGDetail(xmlText) {
  const getId = (regex) => {
    const match = xmlText.match(regex);
    return match ? match[1] : null;
  };

  const getAttr = (pattern) => {
    const match = xmlText.match(pattern);
    return match ? match[1] : null;
  };

  return {
    minPlayers: getAttr(/<minplayers[^>]*value="(\d+)"/),
    maxPlayers: getAttr(/<maxplayers[^>]*value="(\d+)"/),
    playingtime: getAttr(/<playingtime[^>]*value="(\d+)"/),
    weight: getAttr(/<averageweight[^>]*value="([^"]+)"/),
  };
}

/**
 * BGG API 호출 (프로덕션)
 */
async function fetchBGGGameProd(bggId) {
  try {
    const url = `${API_BASE}/.netlify/functions/bgg-proxy?action=detail&id=${bggId}`;
    console.log(`   📡 API 호출: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      minPlayers: data.minPlayers,
      maxPlayers: data.maxPlayers,
      playingtime: data.maxPlaytime || data.playingtime,
      weight: data.weight,
    };
  } catch (e) {
    console.log(`   ⚠️  에러: ${e.message}`);
    return null;
  }
}

/**
 * BGG XML API 직접 호출 (토큰 사용)
 */
async function fetchBGGGameDirect(bggId) {
  try {
    const url = `https://www.boardgamegeek.com/xmlapi2/thing?id=${bggId}&type=boardgame&stats=1`;
    console.log(`   📡 직접 API 호출: ${url}`);

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
    const data = parseBGGDetail(xmlText);
    return {
      minPlayers: parseInt(data.minPlayers) || null,
      maxPlayers: parseInt(data.maxPlayers) || null,
      playingtime: parseInt(data.playingtime) || null,
      weight: data.weight ? parseFloat(data.weight) : null,
    };
  } catch (e) {
    console.log(`   ⚠️  에러: ${e.message}`);
    return null;
  }
}

/**
 * 메인 프로토타입 실행
 */
async function main() {
  console.log('🎲 BGG API 프로토타입 - Node.js 버전\n');
  console.log('⚙️  환경 설정:');
  console.log(`   - Supabase URL: ${supabaseUrl}`);
  console.log(`   - BGG Token: ${bggToken ? '✅ 설정됨' : '❌ 없음'}`);
  console.log(`   - API Base: ${API_BASE}`);
  console.log(`   - 모드: ${isProduction ? '🌐 프로덕션' : '🔧 개발'}\n`);

  // Step 1: Supabase에서 BGG ID 있는 게임 10개 조회
  console.log('📥 Supabase에서 게임 데이터 조회 중...');
  const { data: games, error } = await supabase
    .from('games')
    .select('id, name, bgg_id, min_players, max_players, playingtime')
    .not('bgg_id', 'is', null)
    .limit(10);

  if (error) {
    console.error('❌ Supabase 조회 실패:', error.message);
    process.exit(1);
  }

  if (!games || games.length === 0) {
    console.error('❌ BGG ID가 있는 게임을 찾을 수 없습니다.');
    process.exit(1);
  }

  console.log(`✅ ${games.length}개 게임 조회 완료\n`);

  // Step 2: 각 게임의 BGG 데이터 수집
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let idx = 0; idx < games.length; idx++) {
    const game = games[idx];
    const num = idx + 1;

    console.log(`\n${num}. [ID:${game.id}] ${game.name}`);
    console.log(`   📍 BGG ID: ${game.bgg_id}`);

    // BGG 데이터 조회
    let bggData;
    if (isProduction) {
      bggData = await fetchBGGGameProd(game.bgg_id);
    } else {
      bggData = await fetchBGGGameDirect(game.bgg_id);
    }

    if (bggData) {
      successCount++;

      // 비교
      console.log(`   📊 DB 현재값:`);
      console.log(`      - min_players: ${game.min_players}`);
      console.log(`      - max_players: ${game.max_players}`);
      console.log(`      - playingtime: ${game.playingtime}`);

      console.log(`   📊 BGG API 값:`);
      console.log(`      - minPlayers: ${bggData.minPlayers}`);
      console.log(`      - maxPlayers: ${bggData.maxPlayers}`);
      console.log(`      - playingtime: ${bggData.playingtime}`);

      // 변경 필요 여부 표시
      const needsUpdate =
        game.min_players !== bggData.minPlayers ||
        game.max_players !== bggData.maxPlayers ||
        game.playingtime !== bggData.playingtime;

      if (needsUpdate) {
        console.log(`   ⚠️  업데이트 필요`);
      } else {
        console.log(`   ✅ 데이터 일치`);
      }

      results.push({
        db_id: game.id,
        db_name: game.name,
        bgg_id: game.bgg_id,
        current: {
          min_players: game.min_players,
          max_players: game.max_players,
          playingtime: game.playingtime,
        },
        bgg_data: {
          minPlayers: bggData.minPlayers,
          maxPlayers: bggData.maxPlayers,
          playingtime: bggData.playingtime,
          weight: bggData.weight,
        },
        needs_update: needsUpdate,
        status: 'success'
      });
    } else {
      failCount++;
      results.push({
        db_id: game.id,
        db_name: game.name,
        bgg_id: game.bgg_id,
        status: 'failed'
      });
      console.log(`   ❌ BGG API 호출 실패`);
    }

    // Rate limiting
    if (idx < games.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Step 3: 결과 저장
  const outputFile = path.join(projectRoot, 'bgg_api_prototype_results.json');
  const summary = {
    test_time: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development',
    api_base: API_BASE,
    total_games: games.length,
    success_count: successCount,
    fail_count: failCount,
    results: results
  };

  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2), 'utf-8');

  // Step 4: 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log('📋 결과 요약');
  console.log('='.repeat(60));
  console.log(`✅ 성공: ${successCount}/${games.length}`);
  console.log(`❌ 실패: ${failCount}/${games.length}`);
  console.log(`📁 결과 파일: ${outputFile}\n`);

  // 업데이트 필요한 게임 목록
  const needsUpdate = results.filter(r => r.needs_update);
  if (needsUpdate.length > 0) {
    console.log('⚠️  업데이트 필요한 게임:');
    needsUpdate.forEach(game => {
      console.log(`   - [${game.db_id}] ${game.db_name}`);
    });
  }
}

main().catch(err => {
  console.error('🚨 오류:', err);
  process.exit(1);
});
