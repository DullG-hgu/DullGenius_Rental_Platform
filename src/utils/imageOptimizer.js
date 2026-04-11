/**
 * 이미지 최적화 유틸리티
 * 
 * 외부 이미지(네이버 등)를 무료 이미지 프록시(weserv.nl)를 통해 실시간으로 리사이징하고 압축하여 반환합니다.
 * 로컬 이미지나 Data URI는 그대로 반환합니다.
 * 
 * @param {string} url - 원본 이미지 URL
 * @param {number} width - 변환할 너비 (기본값: 300)
 * @param {number} quality - 이미지 품질 (1~100, 기본값: 80)
 * @returns {string} 최적화된 이미지 URL
 */
export const getOptimizedImageUrl = (url, width = 300, quality = 80) => {
    if (!url) return '';

    // 1. 이미 최적화된 URL이면 그대로 반환 (중복 방지)
    if (url.includes('images.weserv.nl')) return url;

    // [NEW] Supabase Storage URL은 이미 최적화(WebP, 600px)되어 있으므로 그대로 반환
    if (url.includes('supabase.co')) return url;

    // 2. 로컬 이미지('/assets/...')나 Data URI('data:image/...')는 최적화 건너뜀
    if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) {
        return url;
    }

    // 3. 외부 URL인 경우 weserv.nl 프록시 적용
    // output=webp: 최신 포맷 사용
    // w={width}: 너비 조정
    // q={quality}: 품질 조정
    // url={url}: 원본 URL (인코딩 필요 없음, weserv가 알아서 처리하지만 안전하게 처리)
    // we need to remove 'https://' protocol from url for weserv (optional but recommended)
    const cleanUrl = url.replace(/^https?:\/\//, '');

    return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=${width}&q=${quality}&output=webp&il`;
};
