
import os
import requests
import mimetypes
from urllib.parse import urlparse
from supabase import create_client, Client

# [설정] .env 파일 로드 (dotenv가 없으면 수동 설정 필요)
# 이 스크립트는 로컬에서 실행하므로 직접 키를 입력받거나 .env에서 읽습니다.
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
# 주의: 스토리지 업로드 및 DB 수정을 위해 'Service Role Key'가 권장됩니다.
# Anon Key로는 RLS 정책에 따라 막힐 수 있습니다.
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")

BUCKET_NAME = "game-images"

def migrate_images():
    print("--- 보드게임 이미지 서버 이관 스크립트 ---")
    
    # [입력] 환경 변수에 없으면 직접 입력 받기
    global SUPABASE_URL, SUPABASE_KEY

    while not SUPABASE_URL:
        SUPABASE_URL = input("Supabase URL을 입력하세요 (예: https://xxx.supabase.co): ").strip()
        
    while not SUPABASE_KEY:
        print("\n[중요] 이미지 업로드 및 DB 수정을 위해 'service_role' 키가 권장됩니다.")
        print("Anon Key를 사용하면 RLS 정책에 의해 막힐 수 있습니다.")
        SUPABASE_KEY = input("Supabase Service Role Key (또는 Anon Key)를 입력하세요: ").strip()

    print(f"URL: {SUPABASE_URL}")
    print(f"Key: {SUPABASE_KEY[:10]}...") # 일부만 표시

    # Supabase 클라이언트 생성
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"클라이언트 생성 실패: {e}")
        return

    # 1. 버킷 생성 시도 (없으면 생성)
    print(f"Checking bucket: {BUCKET_NAME}...")
    try:
        # get_bucket은 v2에서 안될 수도 있음 -> list_buckets로 확인하거나 create_bucket 시도
        # create_bucket은 이미 있으면 에러날 수 있음
        supabase.storage.create_bucket(BUCKET_NAME, options={"public": True})
        print(f"Bucket '{BUCKET_NAME}' created.")
    except Exception as e:
        # 이미 존재하거나 권한 부족
        print(f"Bucket creation info: {e}")

    # 2. 게임 목록 가져오기
    print("게임 목록을 불러옵니다...")
    try:
        response = supabase.table("games").select("id, name, image").execute()
        games = response.data
    except Exception as e:
        print(f"게임 목록 로드 실패: {e}")
        return

    print(f"총 {len(games)}개의 게임을 확인합니다.")

    success_count = 0
    skip_count = 0
    fail_count = 0

    for game in games:
        game_id = game['id']
        name = game['name']
        original_url = game['image']

        # 이미지가 없거나 이미 Supabase Storage URL인 경우 스킵
        if not original_url:
            skip_count += 1
            continue
            
        if "supabase.co/storage/v1/object/public" in original_url:
            print(f"[Skip] 이미 서버에 저장됨: {name}")
            skip_count += 1
            continue

        print(f"\n[Processing] {name} (ID: {game_id})")
        print(f"  - Download: {original_url}")

        try:
            # 2. 이미지 다운로드
            img_response = requests.get(original_url, timeout=10)
            if img_response.status_code != 200:
                print(f"  - [Fail] 이미지 다운로드 실패 (Status: {img_response.status_code})")
                fail_count += 1
                continue
            
            # Content-Type 확인 및 확장자 결정
            content_type = img_response.headers.get('content-type')
            extension = mimetypes.guess_extension(content_type)
            if not extension:
                extension = ".jpg" # 기본값
            
            # Supabase Storage에 저장할 파일명 (game_id 사용)
            file_name = f"{game_id}{extension}"
            file_path = file_name # 루트에 저장 or 'covers/{file_name}'

            # 3. Supabase Storage 업로드
            print(f"  - Uploading to {BUCKET_NAME}/{file_path}...")
            
            # upload 메소드는 file headers를 설정할 수 있음
            # upsert=True: 덮어쓰기 허용
            try:
                # 바이너리 데이터 업로드
                res = supabase.storage.from_(BUCKET_NAME).upload(
                    file_path,
                    img_response.content,
                    {"content-type": content_type, "upsert": "true"} 
                )
            except Exception as up_err:
                # 업로드 실패 시 (주로 버킷이 없거나 권한 부족)
                print(f"  - [Fail] 업로드 실패: {up_err}")
                print("    (팁: Supabase Dashboard에서 'game-images' 버킷을 'Public'으로 생성했는지 확인하세요.)")
                fail_count += 1
                continue

            # 4. Public URL 가져오기
            public_url_resp = supabase.storage.from_(BUCKET_NAME).get_public_url(file_path)
            # v2 클라이언트에서는 get_public_url이 string을 반환할 수 있음
            new_url = public_url_resp if isinstance(public_url_resp, str) else public_url_resp

            print(f"  - New URL: {new_url}")

            # 5. DB 업데이트
            update_resp = supabase.table("games").update({"image": new_url}).eq("id", game_id).execute()
            
            if len(update_resp.data) > 0:
                print(f"  - [Success] DB 업데이트 완료")
                success_count += 1
            else:
                print(f"  - [Fail] DB 업데이트 실패 (권한 문제 가능성)")
                fail_count += 1
                
        except Exception as e:
            print(f"  - [Error] 처리 중 예외 발생: {e}")
            fail_count += 1

    print("\n--- 완료 ---")
    print(f"성공: {success_count}, 스킵: {skip_count}, 실패: {fail_count}")

if __name__ == "__main__":
    # 라이브러리 설치 안내
    try:
        import supabase
    except ImportError:
        print("필요한 라이브러리가 없습니다. 아래 명령어로 설치해주세요:")
        print("pip install supabase requests")
        exit(1)
        
    migrate_images()
