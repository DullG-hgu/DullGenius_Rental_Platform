// 키오스크 대시보드에 박히는 동아리 사이트 QR(SVG)을 생성한다.
// 런타임 라이브러리 없이 고정 파일로 두는 이유: 번들 크기 0, 키오스크 오프라인에서도 표시.
// 주소가 바뀌면 여기와 src/kiosk/KioskPage.jsx 의 SITE_URL 을 같이 고치고 다시 실행한다.
//
//   npm run gen:kiosk-qr
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const SITE_URL = 'https://dullgrental.netlify.app/';
const OUT = 'src/kiosk/assets/site-qr.svg';

const svg = await QRCode.toString(SITE_URL, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
});
writeFileSync(OUT, svg);
console.log(`QR 생성 완료: ${OUT} (${SITE_URL})`);
