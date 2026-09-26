const { createClient } = require('@supabase/supabase-js');

// 관리자(admin·executive) 세션만 통과시킨다. 실패하면 { statusCode, error }, 통과하면 null.
// Netlify는 _shared/ 안의 파일을 함수로 배포하지 않고, require한 함수에 번들한다.
const authorizeAdmin = async (event) => {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!accessToken) return { statusCode: 401, error: 'Authentication required' };

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey || '')) {
        return { statusCode: 500, error: 'Supabase server environment is not configured' };
    }

    const supabase = createClient(supabaseUrl, supabasePublishableKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) return { statusCode: 401, error: 'Invalid or expired session' };

    const { data: roles, error: roleError } = await supabase
        .from('user_roles')
        .select('role_key')
        .eq('user_id', user.id)
        .in('role_key', ['admin', 'executive'])
        .limit(1);

    if (roleError) return { statusCode: 500, error: 'Unable to verify administrator role' };
    if (!roles?.length) return { statusCode: 403, error: 'Administrator role required' };
    return null;
};

module.exports = { authorizeAdmin };
