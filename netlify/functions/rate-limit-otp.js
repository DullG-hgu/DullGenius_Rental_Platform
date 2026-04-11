// ================================================================
// Netlify Function: rate-limit-otp
// 목적: 비밀번호 재설정 OTP 요청에 속도 제한 적용
// 규칙: 5분당 최대 3회 요청 (IP 또는 학번 기준)
// ================================================================

const crypto = require('crypto');

// 메모리 저장소 (간단한 구현용 - 프로덕션은 Redis 권장)
const rateLimitStore = new Map();

// 만료된 항목 정리 (매 5분마다)
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
        if (value.expiresAt < now) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * 속도 제한 확인
 * @param {string} identifier - IP주소 또는 학번
 * @param {number} maxRequests - 최대 요청 횟수 (기본값: 3)
 * @param {number} windowMs - 시간 윈도우 (기본값: 5분)
 * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
 */
function checkRateLimit(identifier, maxRequests = 3, windowMs = 5 * 60 * 1000) {
    const now = Date.now();
    const key = `otp:${identifier}`;

    // 기존 기록 조회
    let record = rateLimitStore.get(key);

    if (!record || record.expiresAt < now) {
        // 새 레코드 생성
        record = {
            count: 1,
            expiresAt: now + windowMs,
            createdAt: now
        };
        rateLimitStore.set(key, record);
        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetTime: record.expiresAt
        };
    }

    // 기존 레코드 확인
    if (record.count >= maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            resetTime: record.expiresAt,
            retryAfter: Math.ceil((record.expiresAt - now) / 1000) // 초 단위
        };
    }

    // 요청 횟수 증가
    record.count++;
    rateLimitStore.set(key, record);

    return {
        allowed: true,
        remaining: maxRequests - record.count,
        resetTime: record.expiresAt
    };
}

/**
 * IP 주소 추출
 */
function getClientIP(context) {
    return (
        context.clientContext?.sourceIp ||
        context.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
        context.headers?.['client-ip'] ||
        'unknown'
    );
}

/**
 * 로그 기록
 */
async function logRateLimitEvent(identifier, allowed, reason) {
    console.log({
        timestamp: new Date().toISOString(),
        type: 'RATE_LIMIT_OTP',
        identifier,
        allowed,
        reason
    });
}

exports.handler = async (event, context) => {
    // CORS 헤더
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // OPTIONS 요청 처리
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    // POST만 허용
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { studentId } = body;

        if (!studentId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing studentId' })
            };
        }

        // IP 주소 추출 (기본 식별자)
        const clientIP = getClientIP(context);
        // 학번도 함께 확인 (더 정확함)
        const identifier = `${clientIP}:${studentId}`;

        // 속도 제한 확인
        const rateLimit = checkRateLimit(identifier, 3, 5 * 60 * 1000);

        if (!rateLimit.allowed) {
            await logRateLimitEvent(identifier, false, `Rate limit exceeded. Retry after ${rateLimit.retryAfter}s`);

            return {
                statusCode: 429,
                headers: {
                    ...headers,
                    'Retry-After': String(rateLimit.retryAfter)
                },
                body: JSON.stringify({
                    success: false,
                    message: `요청이 너무 많습니다. ${rateLimit.retryAfter}초 후 다시 시도해주세요.`,
                    retryAfter: rateLimit.retryAfter
                })
            };
        }

        await logRateLimitEvent(identifier, true, `Allowed. Remaining: ${rateLimit.remaining}`);

        // 다음 처리로 진행하도록 헤더 추가
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'X-RateLimit-Remaining': String(rateLimit.remaining),
                'X-RateLimit-Reset': String(rateLimit.resetTime)
            },
            body: JSON.stringify({
                success: true,
                message: 'Rate limit check passed',
                remaining: rateLimit.remaining
            })
        };

    } catch (error) {
        console.error('Rate limit error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error'
            })
        };
    }
};
