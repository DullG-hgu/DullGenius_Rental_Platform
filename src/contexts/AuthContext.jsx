
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
    const lastUserId = useRef(null); // [NEW] 이전 유저 ID 추적 (리프레시 방지)

    // [FIX] fetchProfileAndRoles를 useEffect 밖으로 이동하여 다른 함수에서도 사용 가능하게 함
    const fetchProfileAndRoles = async (userId) => {
        try {
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*, is_semester_fixed')
                .eq('id', userId)
                .single();

            if (profileError) {
                if (profileError.code === 'PGRST116') {
                    console.warn('탈퇴했거나 정보가 없는 회원입니다. 자동 로그아웃 처리합니다.');
                    await supabase.auth.signOut();
                    setUser(null);
                    setProfile(null);
                    setRoles([]);
                    return;
                }
                throw profileError;
            }
            if (isMounted.current) setProfile(profileData);

            const { data: roleData, error: roleError } = await supabase
                .from('user_roles')
                .select(`
                    role_key,
                    roles (display_name, permissions)
                `)
                .eq('user_id', userId);

            if (roleError) throw roleError;

            const roleKeys = roleData.map(r => r.role_key);
            if (isMounted.current) setRoles(roleKeys);

        } catch (error) {
            console.error('Error fetching user data:', error.message);
            showToast("사용자 정보를 불러오는데 실패했습니다.", { type: "error" });
        } finally {
            if (isMounted.current) setLoading(false);
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

            const currentId = session?.user?.id;
            const prevId = lastUserId.current;

            setUser(session?.user ?? null);
            lastUserId.current = currentId;

            if (session?.user) {
                if (currentId !== prevId) {
                    setLoading(true);
                }
                fetchProfileAndRoles(session.user.id);
            } else {
                setProfile(null);
                setRoles([]);
                setLoading(false);
            }
        });

        return () => {
            isMounted.current = false;
            subscription.unsubscribe();
        };
    }, [showToast]);

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

    const logout = () => supabase.auth.signOut();
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
