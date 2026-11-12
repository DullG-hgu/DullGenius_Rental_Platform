// 서버 오류 원문(영문·SQL·네트워크 메시지)을 화면에 그대로 내보내지 않는다.
// 한글이 들어 있으면 우리 RPC가 사용자에게 보여 주려고 만든 문구로 보고 그대로 쓰고,
// 아니면 fallback 을 보여 주고 원문은 콘솔에만 남긴다.
export const userMessage = (error, fallback) => {
  const msg = typeof error === 'string' ? error : error?.message;
  if (msg && /[가-힣]/.test(msg)) return msg;
  if (error) console.error(error);
  return fallback;
};
