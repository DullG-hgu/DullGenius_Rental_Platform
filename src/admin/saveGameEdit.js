// 게임 수정 저장 (대여 현황 ✏️ 수정 · 정보 오류 신고 ✏️ 바로 수정 공용)
// 외부 이미지 URL이면 webp로 줄여 game-images 버킷에 올린 뒤 그 주소로 저장한다.
import { editGame } from '../api';
import { supabase } from '../lib/supabaseClient.jsx';

async function optimizeExternalImage(url, showToast) {
  if (!url || !url.startsWith('http') || url.includes('supabase.co')) return url;
  try {
    showToast("이미지를 최적화하고 있습니다...", { type: "info" });

    const cleanUrl = url.replace(/^https?:\/\//, '');
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=600&output=webp&il`;

    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`이미지 최적화 서버 응답 에러: ${response.status}`);
    }
    const blob = await response.blob();

    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webp`;
    const { error: uploadError } = await supabase.storage
      .from('game-images')
      .upload(fileName, blob, { contentType: 'image/webp' });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('game-images')
      .getPublicUrl(fileName);
    return publicUrl;
  } catch (imgError) {
    console.error("Image optimization failed (edit):", imgError);
    showToast("이미지 최적화 실패 (원본 사용)", { type: "warning" });
    // 실패해도 원본 URL로 계속 진행
    return url;
  }
}

export async function saveGameEdit(gameId, formData, showToast) {
  const image = await optimizeExternalImage(formData.image, showToast);
  await editGame({ game_id: gameId, ...formData, image });
}
