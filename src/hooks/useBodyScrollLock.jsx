import { useEffect } from 'react';

// 모달이 여러 개 동시에 떠 있어도 (Confirm + Prompt + 이력 모달 등)
// 마지막 하나가 닫힐 때만 body 스크롤을 풀도록 카운터로 관리한다.
// 예전엔 각 모달이 'unset'을 직접 써서, 하나가 닫히면 다른 모달이 열린 채 배경이 풀렸다.
let lockCount = 0;
let savedOverflow = '';

export function useBodyScrollLock(active) {
    useEffect(() => {
        if (!active) return undefined;
        if (lockCount === 0) {
            savedOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        lockCount += 1;
        return () => {
            lockCount = Math.max(0, lockCount - 1);
            if (lockCount === 0) {
                document.body.style.overflow = savedOverflow;
            }
        };
    }, [active]);
}
