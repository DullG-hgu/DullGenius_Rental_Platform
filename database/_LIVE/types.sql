-- ================================================================
-- CUSTOM TYPES & ENUMS — public schema
-- 프로젝트: hptvqangstiaatdtusrg
-- 생성 시각: 2026. 4. 16. PM 6:30:24
-- 생성 스크립트: scripts/pull_schema.js
-- (자동 생성 파일 — 직접 수정하지 마세요)
-- ================================================================

-- 총 1개 Enum 타입

CREATE TYPE public.game_status AS ENUM (
  'AVAILABLE',
  'RENTED',
  'RESERVED',
  'MAINTENANCE'
);
