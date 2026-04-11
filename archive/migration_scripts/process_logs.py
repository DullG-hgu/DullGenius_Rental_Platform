
import csv
from datetime import datetime
import re

input_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\archive\DullG_BoardGame_Rental - Logs (1).csv"
rentals_output_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\db_seeds\rentals.csv"
stats_output_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\archive\history_stats.csv"

def parse_custom_date(date_str):
    # Format: "2025. 12. 2. 오전 2:07:19" or "2025. 12. 26. PM 1:17:03"
    try:
        parts = date_str.split()
        year = int(parts[0].replace('.', ''))
        month = int(parts[1].replace('.', ''))
        day = int(parts[2].replace('.', ''))
        ampm = parts[3] # '오전', '오후', 'AM', 'PM'
        time_parts = parts[4].split(':')
        hour = int(time_parts[0])
        minute = int(time_parts[1])
        second = int(time_parts[2])
        
        if ampm in ['PM', '오후'] and hour < 12:
            hour += 12
        elif ampm in ['AM', '오전'] and hour == 12:
            hour = 0
            
        return datetime(year, month, day, hour, minute, second).isoformat()
    except Exception as e:
        # Fallback: try standard parsing or return original if just a string check
        return None

def process_logs():
    view_counts = {}
    rentals = []

    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            action = row['action_type']
            game_id = row['game_id']
            user_id = row['value'] # RENT 로그의 경우 value 컬럼에 빌려간 사람 정보(또는 copy info)가 있을 수 있음, 확인 필요
            # 로그 샘플: log_..., 2, RENT, 5ae49... (user_id?), 2025..., 22222222 (학번?)
            # user_id 컬럼: 22학번 김범근, Admin, Anonymous 등
            # value 컬럼: DIBS일때 '4'(인원?), RENT일때 '대여중' 또는 UUID 등 다양함
            
            # 1. VIEW 집계
            if action == 'VIEW':
                if game_id not in view_counts:
                    view_counts[game_id] = 0
                view_counts[game_id] += 1
            
            # 2. RENT 이력 추출
            elif action == 'RENT':
                # 과거 데이터 복원용이라 완벽하진 않지만 최대한 정보 수집
                # user_id 컬럼에 있는게 실제 빌려간 사람일 확률 높음 (Admin이 처리했으면 Admin일수도 있지만)
                # 로그 샘플 503: user_id='Admin', value='admin' (빌린사람?), timestamp=...
                
                borrower = row['user_id']
                # 만약 user_id가 Admin이면 value나 다른 곳에서 정보 찾아야 함.
                # 일단은 단순하게 row 그대로 저장해서 나중에 수동 매핑하거나, 
                # user_id 컬럼을 borrower로 가정.
                
                if user_id in ['Admin', 'admin'] or not user_id:
                     user_id = 'UNKNOWN_ADMIN' # Fallback

                iso_date = parse_custom_date(row['timestamp'])
                if iso_date:
                    rentals.append({
                        'game_id': game_id,
                        'user_id': borrower, 
                        'borrowed_at': iso_date,
                        'status': 'RETURNED'
                    })

    # 1. Stats CSV 저장
    with open(stats_output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['game_id', 'view_count'])
        for gid, count in view_counts.items():
            writer.writerow([gid, count])

    # 2. Rentals CSV 저장
    with open(rentals_output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['game_id', 'user_id', 'borrowed_at', 'status'])
        writer.writeheader()
        writer.writerows(rentals)

    print(f"Stats saved to: {stats_output_path}")
    print(f"Rentals saved to: {rentals_output_path}")

if __name__ == "__main__":
    process_logs()
