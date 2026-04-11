// src/hooks/useKioskData.js
import { useState, useEffect } from 'react';
import { fetchGames, fetchUsers } from '../api';

const useKioskData = () => {
    const [games, setGames] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. LocalStorage (Instant Load with error handling)
                const localGames = localStorage.getItem('kiosk_games');
                const localUsers = localStorage.getItem('kiosk_users');

                if (localGames && localUsers) {
                    try {
                        const parsedGames = JSON.parse(localGames);
                        const parsedUsers = JSON.parse(localUsers);

                        // 데이터 유효성 검증
                        if (Array.isArray(parsedGames) && Array.isArray(parsedUsers)) {
                            setGames(parsedGames);
                            setUsers(parsedUsers);
                            setLoading(false);
                        } else {
                            console.warn("캐시된 데이터가 배열이 아닙니다. 캐시를 삭제합니다.");
                            localStorage.removeItem('kiosk_games');
                            localStorage.removeItem('kiosk_users');
                        }
                    } catch (parseError) {
                        console.warn("캐시 파싱 실패, 재동기화 진행:", parseError);
                        localStorage.removeItem('kiosk_games');
                        localStorage.removeItem('kiosk_users');
                    }
                }

                // 2. Background Sync (Fetch Latest)
                const [gamesData, usersData] = await Promise.all([fetchGames(), fetchUsers()]);
                const validGames = gamesData.filter(g => !g.error);
                const validUsers = usersData || [];

                // [SORT] 티츄 우선 정렬
                const sortedGames = [...validGames].sort((a, b) => {
                    if (a.name === '티츄') return -1;
                    if (b.name === '티츄') return 1;
                    return 0; // 기존 순서(이름순) 유지
                });

                setGames(sortedGames);
                setUsers(validUsers);

                // 3. 안전하게 캐시 저장
                try {
                    localStorage.setItem('kiosk_games', JSON.stringify(sortedGames));
                    localStorage.setItem('kiosk_users', JSON.stringify(validUsers));
                } catch (storageError) {
                    console.error("LocalStorage 저장 실패 (용량 부족 가능):", storageError);
                }
            } catch (e) {
                console.error("Kiosk Data Sync Failed:", e);
                setError(e);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, []);

    return { games, users, loading, error };
};

export default useKioskData;
