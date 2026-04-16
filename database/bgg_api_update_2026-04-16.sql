-- BGG API 데이터 업데이트 (자동 생성)
-- 생성일: 2026-04-16T16:21:30.417Z
-- 대상: 108개 게임

-- 마이그레이션 실행 전 반드시 백업 생성

BEGIN;

-- 업데이트 대상 게임 확인
SELECT COUNT(*) as 변경_예정 FROM (
  SELECT id FROM games WHERE id IN (64,171,63,142,19,138,50,27,73,11,80,82,116,126,130,79,6,127,14,16,135,81,187,191,192,2,4,5,124,125,150,33,163,40,43,164,168,154,91,94,22,152,156,157,165,166,58,95,99,37,38,169,170,175,100,155,12,158,173,66,113,34,39,70,159,55,44,76,93,87,96,84,69,72,86,114,101,71,122,74,75,140,141,105,24,41,42,143,146,148,45,49,136,29,17,110,123,137,25,31,117,174,107,189,35,145,161,172)
) AS target;

-- BGG API 데이터 업데이트 시작
UPDATE games SET min_players = 2, max_players = 4, playingtime = 60 WHERE id = 64;
UPDATE games SET min_players = 1, max_players = 4, playingtime = 30 WHERE id = 171;
UPDATE games SET min_players = 2, max_players = 5, playingtime = 35 WHERE id = 63;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 60 WHERE id = 142;
UPDATE games SET min_players = 2, max_players = 5, playingtime = 30 WHERE id = 19;
UPDATE games SET min_players = 2, max_players = 6, playingtime = 50 WHERE id = 138;
UPDATE games SET min_players = 1, max_players = 5, playingtime = 60 WHERE id = 50;
UPDATE games SET min_players = 2, max_players = 5, playingtime = 45 WHERE id = 27;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 40 WHERE id = 73;
UPDATE games SET min_players = 1, max_players = 4, playingtime = 60 WHERE id = 11;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 80;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 82;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 116;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 126;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 130;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 79;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 6;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 127;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 14;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 16;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 135;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 81;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 187;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 191;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 192;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 2;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 4;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 5;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 124;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 125;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 150;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 33;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 163;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 40;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 43;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 164;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 168;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 154;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 91;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 94;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 22;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 152;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 156;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 157;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 165;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 166;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 58;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 95;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 99;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 37;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 38;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 169;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 170;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 175;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 100;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 155;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 12;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 158;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 173;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 66;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 113;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 34;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 39;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 70;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 159;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 55;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 44;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 76;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 93;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 87;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 96;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 84;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 69;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 72;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 86;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 114;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 101;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 71;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 122;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 74;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 75;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 140;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 141;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 105;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 24;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 41;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 42;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 143;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 146;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 148;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 45;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 49;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 136;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 29;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 17;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 110;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 123;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 137;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 25;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 31;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 117;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 174;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 107;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 189;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 35;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 145;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 161;
UPDATE games SET min_players = 2, max_players = 4, playingtime = 45 WHERE id = 172;

-- 마이그레이션 완료 확인
SELECT COUNT(*) as 변경_완료 FROM games WHERE id IN (64,171,63,142,19,138,50,27,73,11,80,82,116,126,130,79,6,127,14,16,135,81,187,191,192,2,4,5,124,125,150,33,163,40,43,164,168,154,91,94,22,152,156,157,165,166,58,95,99,37,38,169,170,175,100,155,12,158,173,66,113,34,39,70,159,55,44,76,93,87,96,84,69,72,86,114,101,71,122,74,75,140,141,105,24,41,42,143,146,148,45,49,136,29,17,110,123,137,25,31,117,174,107,189,35,145,161,172);

COMMIT;
