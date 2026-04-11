
import os
import time
import random
from supabase import create_client, Client
from playwright.sync_api import sync_playwright, Page, BrowserContext

# [설정]
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")

PRIORITY_KEYWORD = "코리아보드게임즈"

def fetch_youtube_urls():
    print("--- 유튜브 링크 자동 수집기 (Piority: 코리아보드게임즈) ---")
    
    # [입력] 환경 변수에 없으면 직접 입력 받기
    global SUPABASE_URL, SUPABASE_KEY
    while not SUPABASE_URL:
        SUPABASE_URL = input("Supabase URL: ").strip()
    while not SUPABASE_KEY:
        print("[주의] DB 업데이트를 위해 가급적 Service Role Key를 사용하세요.")
        SUPABASE_KEY = input("Supabase Key: ").strip()

    # Supabase 접속
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. 게임 목록 가져오기 (video_url이 없는 것만)
    print("게임 목록 로딩 중...")
    try:
        # video_url이 null이거나 빈 문자열인 것만 조회
        # [변경] 카테고리 필터링을 위해 category 컬럼 추가
        res = supabase.table("games").select("id, name, category").is_("video_url", "null").execute()
        games = res.data
        
        # 빈 문자열 처리 (Supabase filter로 어려울 수 있어서 Python에서 필터링)
        # res2 = supabase.table("games").select("id, name").eq("video_url", "").execute()
        # games.extend(res2.data) 
        # (중복 제거 필요하므로 일단 null인 것만 우선 처리)
        
    except Exception as e:
        print(f"게임 목록 로드 실패: {e}")
        return

    print(f"총 {len(games)}개의 대상 게임이 있습니다.")

    # 2. Playwright 브라우저 실행
    with sync_playwright() as p:
        # 헤드리스 모드 (화면 안 띄움), 필요하면 headless=False로 변경 가능
        # [변경] 유튜브 탐지 회피를 위해 헤드리스 끔
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        success_count = 0
        fail_count = 0

        for idx, game in enumerate(games):
            game_id = game['id']
            name = game['name']
            category = game.get('category', '')

            # [필터] 머더미스터리, 플레잉카드는 설명 영상 제외
            if category in ["머더미스터리", "플레잉카드"]:
                print(f"[{idx+1}/{len(games)}] Skip (카테고리: {category}): {name}")
                continue
            
            print(f"[{idx+1}/{len(games)}] 검색: {name}...")
            
            # [전략] '게임명 + 코리아보드게임즈 + 설명' 으로 검색
            # 이렇게 하면 코리아보드게임즈 채널 영상이 최상단에 뜰 확률이 높음
            search_query = f"{name} 보드게임 설명 {PRIORITY_KEYWORD}"
            
            # URL 인코딩은 Playwright가 알아서 처리함
            youtube_search_url = f"https://www.youtube.com/results?search_query={search_query}"

            try:
                page.goto(youtube_search_url)
                # 검색 결과 로딩 대기
                page.wait_for_selector("ytd-video-renderer", timeout=5000)
                
                # 첫 번째 영상 링크 가져오기
                # ytd-video-renderer -> #video-title -> href
                video_element = page.query_selector("ytd-video-renderer #video-title")
                
                if video_element:
                    video_url_suffix = video_element.get_attribute("href")
                    if video_url_suffix and "/watch?v=" in video_url_suffix:
                        full_url = f"https://www.youtube.com{video_url_suffix}"
                        title = video_element.get_attribute("title")
                        
                        print(f"  -> 발견: {title}")
                        print(f"  -> 링크: {full_url}")

                        # DB 업데이트
                        supabase.table("games").update({"video_url": full_url}).eq("id", game_id).execute()
                        success_count += 1
                    else:
                        print("  -> 링크 형식이 올바르지 않음")
                        fail_count += 1
                else:
                    print("  -> 검색 결과 없음")
                    fail_count += 1

            except Exception as e:
                print(f"  -> 에러 발생: {e}")
                fail_count += 1

            # 너무 빠른 요청 방지 (랜덤 딜레이)
            time.sleep(random.uniform(1, 3))

        browser.close()

    print("\n--- 작업 완료 ---")
    print(f"성공: {success_count}, 실패: {fail_count}")

if __name__ == "__main__":
    fetch_youtube_urls()
