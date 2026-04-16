
import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from './ToastContext';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);



export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    // useRef를 사용하여 마운트 상태 추적 (비동기 콜백에서의 상태 업데이트 방지)
    const isMounted = useRef(true);
    const lastUserId = useRef(null);
    const fetchGenRef = useRef(0); // 로그아웃 시 in-flight fetch 무효화용

    const fetchProfileAndRoles = async (userId, retryCount = 0) => {
        const gen = ++fetchGenRef.current;
        console.debug(`[Auth] fetchProfileAndRoles 시작 (gen=${gen}, userId=${userId}, retry=${retryCount})`);
        try {
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*, is_semester_fixed')
                .eq('id', userId)
                .single();

            // 이 await 이후 로그아웃이 됐으면 중단
            if (gen !== fetchGenRef.current || !isMounted.current) {
                console.debug(`[Auth] fetchProfileAndRoles 중단 - 로그아웃됨 (gen=${gen}, current=${fetchGenRef.current})`);
                return;
            }

            if (profileError) {
                if (profileError.code === 'PGRST116') {
                    // kiosk 계정처럼 profiles가 없는 경우: 역할만 조회해서 kiosk role이면 허용
                    const { data: roleData } = await supabase
                        .from('user_roles')
                        .select('role_key')
                        .eq('user_id', userId);
                    const roleKeys = (roleData ?? []).map(r => r.role_key);
                    if (roleKeys.includes('kiosk')) {
                        setProfile(null);
                        setRoles(roleKeys);
                        return;
                    }
                    console.warn('탈퇴했거나 정보가 없는 회원입니다. 자동 로그아웃 처리합니다.');
                    await supabase.auth.signOut();
                    setUser(null);
                    setProfile(null);
                    setRoles([]);
                    return;
                }
                throw profileError;
            }
            setProfile(profileData);
            console.debug(`[Auth] 프로필 로드 완료 (gen=${gen}, name=${profileData?.name})`);

            const { data: roleData, error: roleError } = await supabase
                .from('user_roles')
                .select(`
                    role_key,
                    roles (display_name, permissions)
                `)
                .eq('user_id', userId);

            if (gen !== fetchGenRef.current || !isMounted.current) {
                console.debug(`[Auth] 역할 조회 후 중단 - 로그아웃됨 (gen=${gen})`);
                return;
            }

            if (roleError) throw roleError;
            setRoles(roleData.map(r => r.role_key));
            console.debug(`[Auth] 역할 로드 완료 (gen=${gen}, roles=${roleData.map(r => r.role_key).join(',')})`);

        } catch (error) {
            // 로그아웃 이후 발생한 에러는 무시
            if (gen !== fetchGenRef.current) {
                console.debug(`[Auth] 에러 무시 - 로그아웃 후 발생 (gen=${gen})`);
                return;
            }
            // 네트워크 변경(ERR_NETWORK_CHANGED) 등 일시적 오류는 최대 2회 재시도
            const isNetworkError = error instanceof TypeError && error.message === 'Failed to fetch';
            if (isNetworkError && retryCount < 2) {
                console.warn(`[Auth] 네트워크 오류, ${1500 * (retryCount + 1)}ms 후 재시도 (${retryCount + 1}/2)`);
                setTimeout(() => {
                    if (isMounted.current && gen === fetchGenRef.current) {
                        fetchProfileAndRoles(userId, retryCount + 1);
                    }
                }, 1500 * (retryCount + 1));
                return;
            }
            console.error('Error fetching user data:', error.message);
            showToast("사용자 정보를 불러오는데 실패했습니다. 페이지를 새로고침 해주세요.", { type: "error" });
        } finally {
            if (isMounted.current && gen === fetchGenRef.current) {
                console.debug(`[Auth] setLoading(false) (gen=${gen})`);
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        isMounted.current = true;

        // Supabase v2는 onAuthStateChange 등록 시 즉시 INITIAL_SESSION 이벤트를 발생시킴.
        // initSession()과 동시에 실행되면 fetchProfileAndRoles가 2번 호출되는 race condition이 생기므로
        // initSession()을 제거하고 onAuthStateChange 단일 진입점으로 통합함.
        // onAuthStateChange 콜백 내부에서 await + supabase 쿼리를 사용하면
        // Supabase 내부 세션 락과 데드락이 발생해 무한 로딩이 생긴다.
        // fetchProfileAndRoles는 fire-and-forget으로 호출하고,
        // 내부의 finally { setLoading(false) }가 완료를 처리한다.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!isMounted.current) return;
            console.debug(`[Auth] onAuthStateChange event=${_event}, userId=${session?.user?.id ?? 'none'}`);

            const currentId = session?.user?.id;
            const prevId = lastUserId.current;

            setUser(session?.user ?? null);
            lastUserId.current = currentId;

            if (session?.user) {
                if (currentId !== prevId) {
                    console.debug(`[Auth] 새 유저 감지 (prev=${prevId} → curr=${currentId}), setLoading(true)`);
                    setLoading(true);
                }
                fetchProfileAndRoles(session.user.id);
            } else {
                fetchGenRef.current++; // in-flight fetch 무효화 (낙관적 로그아웃 미경유 시 대비)
                console.debug(`[Auth] SIGNED_OUT, fetchGen 무효화 → ${fetchGenRef.current}`);
                setProfile(null);
                setRoles([]);
                setLoading(false);
            }
        });

        return () => {
            isMounted.current = false;
            subscription.unsubscribe();
        };
    }, []);

    const login = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;

        /* 
           [NOTE] Rename & Archive 전략:
           탈퇴 시 이메일이 변경되므로, 위 signInWithPassword 단계에서 이미 걸러짐.
           따라서 data.user가 존재한다면 active 유저임이 보장됨.
           별도의 status 체크 로직 불필요.
        */

        return data;
    };

    const signup = async (email, password, additionalData) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    student_id: additionalData.student_id,
                    name: additionalData.name,
                    phone: additionalData.phone
                }
            }
        });

        // 1. 이미 가입된 유저인 경우 -> 에러 처리 (클라이언트에서 로그인 유도)
        if (error && error.message.includes("already registered")) {
            throw new Error("이미 가입된 학번입니다. 로그인해주세요.");
        }

        if (error) throw error;
        return data;
    };

    const logout = async () => {
        // 낙관적 로그아웃: 네트워크 응답 전에 즉시 상태 초기화 → UI 즉시 반응
        console.debug(`[Auth] logout() 호출 - 낙관적 상태 초기화`);
        fetchGenRef.current++; // in-flight fetchProfileAndRoles 무효화
        setUser(null);
        setProfile(null);
        setRoles([]);
        setLoading(false);
        // scope: 'local' → 로컬 스토리지 세션만 삭제, 서버 API 호출 없음
        // scope: 'global'은 JWT가 만료됐을 때 서버가 403을 반환하고 로컬 세션도 삭제하지 않음
        // 이 앱 수준에서는 local로 충분: JWT는 1시간 후 자연 만료, RLS가 DB 접근을 보호함
        await supabase.auth.signOut({ scope: 'local' });
        console.debug(`[Auth] signOut() 완료`);
    };
    const hasRole = (roleKey) => roles.includes(roleKey);

    // 비밀번호 변경 (사용자 본인)
    const changePassword = async (newPassword) => {
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });
        if (error) throw error;
    };

    // [NEW] 프로필 수동 갱신 (마이페이지 등에서 사용)
    const refreshProfile = async () => {
        if (user) await fetchProfileAndRoles(user.id);
    };

    const value = {
        user,
        profile,
        roles,
        login,
        signup,
        logout,
        hasRole,
        changePassword,
        loading,
        refreshProfile // [NEW]
    };

    return (
        <AuthContext.Provider value={value}>
            {loading ? (
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    flexDirection: 'column',
                    gap: '20px'
                }}>
                    <div className="spinner"></div>
                    <p>로그인 정보를 확인하고 있어요...</p>
                </div>
            ) : children}
        </AuthContext.Provider>
    );
};
