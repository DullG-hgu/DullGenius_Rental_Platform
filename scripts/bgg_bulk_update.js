const fs = require('fs');
const path = require('path');

// ============================================================================
// 환경변수 로딩
// ============================================================================

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local 파일을 찾을 수 없습니다');
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value.trim();
    }
  });
  return env;
}

// ============================================================================
// 유틸리티
// ============================================================================

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function formatPlayingTime(minTime, maxTime) {
  if (!minTime && !maxTime) return null;
  if (!maxTime || minTime === maxTime) {
    return minTime ? `${minTime}분` : null;
  }
  return `${minTime}~${maxTime}분`;
}

// ============================================================================
// BGG XML 파싱 (api.jsx와 동일)
// ============================================================================

function parseBGGDetail(xmlText) {
  const idMatch = xmlText.match(/<item[^>]*id="(\d+)"/);
  // primary 이름을 먼저 찾고, 없으면 alternate 이름 사용 (다국어 지원)
  const primaryNameMatch = xmlText.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/);
  const alternateNameMatch = xmlText.match(/<name[^>]*type="alternate"[^>]*value="([^"]+)"/);
  const nameMatch = primaryNameMatch || alternateNameMatch;
  const minPMatch = xmlText.match(/<minplayers[^>]*value="(\d+)"/);
  const maxPMatch = xmlText.match(/<maxplayers[^>]*value="(\d+)"/);
  const weightMatch = xmlText.match(/<averageweight[^>]*value="([^"]+)"/);
  const minPTimeMatch = xmlText.match(/<minplaytime[^>]*value="(\d+)"/);
  const maxPTimeMatch = xmlText.match(/<maxplaytime[^>]*value="(\d+)"/);

  const genres = [];
  const categoryRegex = /<link[^>]*type="boardgamecategory"[^>]*value="([^"]+)"/g;
  let categoryMatch;
  while ((categoryMatch = categoryRegex.exec(xmlText)) !== null) {
    genres.push(categoryMatch[1]);
  }

  const mechanics = [];
  const mechanicRegex = /<link[^>]*type="boardgamemechanic"[^>]*value="([^"]+)"/g;
  let mechanicMatch;
  while ((mechanicMatch = mechanicRegex.exec(xmlText)) !== null) {
    mechanics.push(mechanicMatch[1]);
  }

  return {
    id: idMatch ? idMatch[1] : '',
    minPlayers: minPMatch ? minPMatch[1] : '',
    maxPlayers: maxPMatch ? maxPMatch[1] : '',
    weight: weightMatch ? parseFloat(weightMatch[1]).toFixed(2) : '',
    minPlaytime: minPTimeMatch ? minPTimeMatch[1] : '',
    maxPlaytime: maxPTimeMatch ? maxPTimeMatch[1] : '',
    genres: genres,
    mechanics: mechanics
  };
}

// ============================================================================
// BGG 검색 API (Phase 1용)
// ============================================================================

async function searchBGGDirect(query, bggToken) {
  if (!query) return [];

  try {
    const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/xml, text/xml, */*'
    };

    if (bggToken) {
      headers['Authorization'] = `Bearer ${bggToken}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await response.text();

    // 검색 결과 파싱
    const items = [];
    const itemRegex = /<item[^>]*type="boardgame"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      const id = match[1];
      const inner = match[2];
      const nameMatch = inner.match(/<name[^>]*type="primary"[^>]*value="([^"]+)"/);
      const yearMatch = inner.match(/<yearpublished[^>]*value="([^"]+)"/);
      if (nameMatch) {
        items.push({
          id,
          name: nameMatch[1],
          year: yearMatch ? yearMatch[1] : ''
        });
      }
    }
    return items;
  } catch (e) {
    log(`  ⚠️  BGG 검색 실패: ${e.message}`);
    return [];
  }
}

// ============================================================================
// BGG XML API 직접 호출 (Phase 2용)
// ============================================================================

async function fetchBGGGameDirect(bggId, bggToken) {
  if (!bggId) return null;

  try {
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;

    // 202 Retry 로직
    let attempts = 0;
    let response;
    while (attempts < 3) {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };

      // Authorization 헤더 추가 (BGG API 요구사항)
      if (bggToken) {
        headers['Authorization'] = `Bearer ${bggToken}`;
      }

      response = await fetch(url, { headers });
      if (response.status !== 202) break;
      log(`  ⏳ BGG 처리 중... 1.5초 대기`);
      await sleep(1500);
      attempts++;
    }

    if (response.status === 202) {
      throw new Error('BGG 서버 타임아웃');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await response.text();
    return parseBGGDetail(xmlText);
  } catch (e) {
    log(`  ❌ BGG 상세 조회 실패: ${e.message}`);
    return null;
  }
}

// ============================================================================
// Supabase REST API
// ============================================================================

async function supabaseSelect(url, key, query) {
  const response = await fetch(`${url}/rest/v1/${query}`, {
    method: 'GET',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase: ${response.status}`);
  }
  return await response.json();
}

async function supabaseUpdate(url, key, table, id, data) {
  const response = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    throw new Error(`Supabase: ${response.status}`);
  }
  return true;
}

// ============================================================================
// 메인 (Phase 2 & 3만)
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    const env = loadEnv();
    const supabaseUrl = env.VITE_SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    const bggToken = env.VITE_BGG_API_TOKEN || env.BGG_API_TOKEN;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('VITE_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다');
    }

    if (!bggToken) {
      log('⚠️  경고: BGG_API_TOKEN이 없습니다. BGG API는 토큰 없이 403 에러를 반환할 수 있습니다.');
    }

    const modeLabel = dryRun ? '[DRY-RUN]' : '[실행]';
    log(`${modeLabel} BGG 일괄 업데이트 시작`);

    // ========================================================================
    // Phase 1: bgg_id 없는 게임 검색 후 자동 저장
    // ========================================================================
    log('\n📍 Phase 1: bgg_id 없는 게임 검색 중...');
    const gamesWithoutBggId = await supabaseSelect(supabaseUrl, supabaseKey, 'games?bgg_id=is.null&select=id,name');
    log(`  총 ${gamesWithoutBggId.length}개 게임 (bgg_id 없음)`);

    let phase1Found = 0;
    for (let i = 0; i < gamesWithoutBggId.length; i++) {
      const game = gamesWithoutBggId[i];
      process.stdout.write(`\r  [${i + 1}/${gamesWithoutBggId.length}] ${game.name.substring(0, 40)}`);

      const searchResults = await searchBGGDirect(game.name, bggToken);
      if (searchResults.length === 0) {
        if (i < gamesWithoutBggId.length - 1) await sleep(3000);
        continue;
      }

      // 이름이 정확히 일치하는 게임 찾기
      const normalizedGameName = game.name.toLowerCase().trim();
      const exactMatch = searchResults.find(r => r.name.toLowerCase().trim() === normalizedGameName);

      if (exactMatch) {
        if (!dryRun) {
          await supabaseUpdate(supabaseUrl, supabaseKey, 'games', game.id, { bgg_id: parseInt(exactMatch.id) });
        }
        phase1Found++;
      }

      if (i < gamesWithoutBggId.length - 1) await sleep(3000);
    }
    console.log('');
    log(`  ✅ Phase 1 완료: ${phase1Found}개 게임 bgg_id 찾음`);

    // ========================================================================
    // Phase 2: bgg_id 있는 게임 상세 정보 (Phase 1에서 새로 찾은 것 포함)
    // ========================================================================
    log('\n📍 Phase 2: bgg_id 있는 게임 상세 정보 업데이트 중...');
    const gamesWithBggId = await supabaseSelect(supabaseUrl, supabaseKey, 'games?bgg_id=not.is.null&select=id,name,bgg_id');
    log(`  총 ${gamesWithBggId.length}개 게임 (bgg_id 있음)`);

    let phase2Updates = 0;
    const allGenres = [];

    for (let i = 0; i < gamesWithBggId.length; i++) {
      const game = gamesWithBggId[i];
      process.stdout.write(`\r  [${i + 1}/${gamesWithBggId.length}] ${game.name.substring(0, 40)}`);

      const detail = await fetchBGGGameDirect(game.bgg_id, bggToken);
      if (!detail) {
        if (i < gamesWithBggId.length - 1) await sleep(3000);
        continue;
      }

      const updateData = {
        min_players: detail.minPlayers ? parseInt(detail.minPlayers) : null,
        max_players: detail.maxPlayers ? parseInt(detail.maxPlayers) : null,
        playingtime: formatPlayingTime(detail.minPlaytime, detail.maxPlaytime),
        difficulty: detail.weight ? parseFloat(detail.weight) : null,
        genres: (detail.genres && detail.genres.length > 0) ? detail.genres : null
      };

      if (!dryRun) {
        await supabaseUpdate(supabaseUrl, supabaseKey, 'games', game.id, updateData);
      }
      phase2Updates++;
      if (detail.genres && detail.genres.length > 0) {
        allGenres.push(...detail.genres);
      }

      if (i < gamesWithBggId.length - 1) await sleep(3000);
    }
    console.log('');
    log(`  ✅ Phase 2 완료: ${phase2Updates}개 게임 업데이트됨`);

    // ========================================================================
    // Phase 3: 장르 빈도 분석
    // ========================================================================
    log('\n📍 Phase 3: 장르 빈도 분석');
    const genreFreq = {};
    for (const genre of allGenres) {
      genreFreq[genre] = (genreFreq[genre] || 0) + 1;
    }

    const sortedGenres = Object.entries(genreFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    log('\n=== 장르 빈도 분석 (BGG 카테고리) ===');
    sortedGenres.forEach(([genre, count]) => {
      log(`  ${String(count).padStart(3, ' ')}회  ${genre}`);
    });

    // ========================================================================
    // 최종 요약
    // ========================================================================
    log(`\n${'='.repeat(60)}`);
    log(`${modeLabel} BGG 일괄 업데이트 완료!`);
    log(`  Phase 1 (검색): ${phase1Found}개 게임 bgg_id 찾음`);
    log(`  Phase 2 (상세 정보): ${phase2Updates}개 게임 업데이트`);
    log(`  Phase 3: ${Object.keys(genreFreq).length}개 고유 장르 발견`);
    if (dryRun) {
      log(`\n  💡 이것은 dry-run 결과입니다. DB에 반영되지 않았습니다.`);
      log(`  📝 실제 실행: node scripts/bgg_bulk_update.js`);
    }
    log(`${'='.repeat(60)}\n`);

  } catch (e) {
    log(`\n❌ 오류: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
