#!/usr/bin/env node
/**
 * BGG API 데이터로부터 SQL 마이그레이션 생성
 * Phase 3: 마이그레이션 SQL 자동 생성
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// 최신 데이터 파일 찾기
const files = fs.readdirSync(projectRoot)
  .filter(f => f.startsWith('bgg_pipeline_mock_results') && f.endsWith('.json'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.error('❌ 수집된 데이터 파일을 찾을 수 없습니다.');
  process.exit(1);
}

const dataFile = files[0];
const dataPath = path.join(projectRoot, dataFile);

console.log(`📥 데이터 파일 로드 중: ${dataFile}`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

console.log(`✅ ${data.total_games}개 게임 데이터 로드됨\n`);
console.log('🔨 SQL 마이그레이션 생성 중...\n');

// 유효한 결과만 필터링
const validResults = data.results.filter(r => r.status !== 'failed' && r.bgg_data);

// UPDATE 문 생성
const updates = [];
validResults.forEach(result => {
  const { db_id, bgg_data } = result;
  const minPlayers = bgg_data.min_players !== null ? bgg_data.min_players : 'NULL';
  const maxPlayers = bgg_data.max_players !== null ? bgg_data.max_players : 'NULL';
  const playingtime = bgg_data.playingtime !== null ? bgg_data.playingtime : 'NULL';

  updates.push(
    `UPDATE games SET min_players = ${minPlayers}, max_players = ${maxPlayers}, playingtime = ${playingtime} WHERE id = ${db_id};`
  );
});

// 마이그레이션 SQL 파일 생성
const timestamp = new Date().toISOString().split('T')[0];
const migrationName = `bgg_api_update_${timestamp}`;
const migrationContent = `-- BGG API 데이터 업데이트 (자동 생성)
-- 생성일: ${new Date().toISOString()}
-- 대상: ${validResults.length}개 게임

-- 마이그레이션 실행 전 반드시 백업 생성

BEGIN;

-- 업데이트 대상 게임 확인
SELECT COUNT(*) as 변경_예정 FROM (
  SELECT id FROM games WHERE id IN (${validResults.map(r => r.db_id).join(',')})
) AS target;

-- BGG API 데이터 업데이트 시작
${updates.join('\n')}

-- 마이그레이션 완료 확인
SELECT COUNT(*) as 변경_완료 FROM games WHERE id IN (${validResults.map(r => r.db_id).join(',')});

COMMIT;
`;

const migrationPath = path.join(projectRoot, 'database', `${migrationName}.sql`);
fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
fs.writeFileSync(migrationPath, migrationContent, 'utf-8');

console.log('✅ SQL 마이그레이션 생성 완료\n');
console.log(`📁 파일: ${migrationPath}\n`);

// 마이그레이션 요약
console.log('📋 마이그레이션 요약:');
console.log(`   - 변경 대상: ${validResults.length}개 게임`);
console.log(`   - UPDATE 문: ${updates.length}개`);
console.log(`   - 변경 필드: min_players, max_players, playingtime\n`);

// 변경 미리보기
console.log('📊 변경 미리보기 (최대 10개):');
validResults.slice(0, 10).forEach(result => {
  const { db_name, current, bgg_data } = result;
  const changes = [];
  if (current.min_players !== bgg_data.min_players) {
    changes.push(`min: ${current.min_players} → ${bgg_data.min_players}`);
  }
  if (current.max_players !== bgg_data.max_players) {
    changes.push(`max: ${current.max_players} → ${bgg_data.max_players}`);
  }
  if (current.playingtime !== bgg_data.playingtime) {
    changes.push(`time: ${current.playingtime} → ${bgg_data.playingtime}`);
  }
  if (changes.length > 0) {
    console.log(`   [${db_name}] ${changes.join(', ')}`);
  }
});

if (validResults.length > 10) {
  console.log(`   ... 외 ${validResults.length - 10}개`);
}

console.log('\n✨ SQL 마이그레이션 생성 완료!\n');
