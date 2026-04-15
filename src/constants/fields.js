/**
 * [PERFORMANCE] Surgical Select Field Lists
 *
 * API 호출 시 필요한 최소 필드 목록을 정의합니다.
 * 이 목록은 src/lib/gameStatus.js 및 UI 컴포넌트의 요구사항을 기반으로 합니다.
 *
 * [SECURITY] excludeFields는 민감 정보 자동 제외 규칙입니다.
 * 새로운 필드 추가 시, 민감 정보라면 여기에 명시하세요.
 */

// [API_FIELDS] 통일된 필드 정의 (태그 기반 관리)
export const API_FIELDS = {
  GAMES_FOR_LISTING: {
    description: '게임 목록용 (필수 필드)',
    fields: [
      'id', 'name', 'image', 'category', 'genre', 'players', 'playingtime',
      'difficulty', 'is_rentable', 'quantity', 'available_count', 'video_url',
      'manual_url', 'owner', 'recommendation_text', 'tags', 'total_views'
    ],
    excludeFields: ['bgg_id', 'created_at', 'avg_rating', 'review_count', 'dibs_count']
  },

  RENTALS_ACTIVE: {
    description: '활성 대여 정보 (Profile JOIN 포함)',
    fields: [
      'rental_id', 'game_id', 'user_id', 'renter_name', 'type',
      'due_date', 'returned_at',  // ✅ returned_at 포함 (과거 기록 조회용)
      'profiles(name)'
    ],
    excludeFields: []
  },

  USERS_LIST: {
    description: '관리자 회원 목록 (민감 정보 제외)',
    fields: ['id', 'name', 'student_id', 'is_paid', 'joined_semester', 'status'],
    excludeFields: ['phone', 'email', 'password_hash']  // ✅ phone 명시적 제외
  },

  USER_PROFILE_DETAIL: {
    description: '회원 상세 정보 (phone 포함, 상세 조회용)',
    fields: ['id', 'name', 'student_id', 'phone', 'is_paid', 'joined_semester', 'status'],
    excludeFields: ['password_hash']  // phone은 포함
  },

  REVIEWS: {
    description: '리뷰 조회용 필드',
    fields: [
      'review_id', 'game_id', 'user_id', 'author_name', 'rating',
      'content', 'created_at'
    ],
    excludeFields: []
  }
};

// [DEPRECATED] 레거시 호환용 (기존 코드 호환, 추후 제거)
export const GAME_REQUIRED_FIELDS = API_FIELDS.GAMES_FOR_LISTING.fields.join(', ');
export const RENTAL_REQUIRED_FIELDS = API_FIELDS.RENTALS_ACTIVE.fields.join(', ');
export const REVIEW_REQUIRED_FIELDS = API_FIELDS.REVIEWS.fields.join(', ');
