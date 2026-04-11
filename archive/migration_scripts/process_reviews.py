from datetime import datetime
import csv

input_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\archive\DullG_BoardGame_Rental - Reviews.csv"
output_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\db_seeds\reviews.csv"

target_author = "오세인"

def parse_custom_date(date_str):
    # Format: "2025. 12. 26. PM 1:17:03"
    try:
        # PM/AM 제거 및 시간 추출을 위한 전처리
        parts = date_str.split()
        # parts 예시: ['2025.', '12.', '26.', 'PM', '1:17:03']
        
        year = int(parts[0].replace('.', ''))
        month = int(parts[1].replace('.', ''))
        day = int(parts[2].replace('.', ''))
        ampm = parts[3]
        time_parts = parts[4].split(':')
        hour = int(time_parts[0])
        minute = int(time_parts[1])
        second = int(time_parts[2])
        
        if ampm == 'PM' and hour < 12:
            hour += 12
        elif ampm == 'AM' and hour == 12:
            hour = 0
            
        return datetime(year, month, day, hour, minute, second).isoformat()
    except Exception as e:
        print(f"Date parsing failed for {date_str}: {e}")
        return None

def process_reviews():
    filtered_reviews = []
    
    # 헤더에 마지막 컬럼(timestamp) 이름이 었어서 명시적으로 지정
    headers = ['review_id','game_id','user_name','password','rating','comment','timestamp']
    
    with open(input_path, 'r', encoding='utf-8') as f:
        # 첫 줄(헤더) 건너뛰기
        next(f)
        reader = csv.DictReader(f, fieldnames=headers)
        
        for row in reader:
            if row['user_name'] == target_author:
                iso_date = parse_custom_date(row['timestamp'])
                if iso_date:
                    filtered_reviews.append({
                        'game_id': row['game_id'],
                        'author_name': row['user_name'],
                        'rating': row['rating'],
                        'content': row['comment'],
                        'created_at': iso_date
                    })

    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        fieldnames = ['game_id', 'author_name', 'rating', 'content', 'created_at']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(filtered_reviews)

    print(f"Filtered reviews for '{target_author}' saved to: {output_path}")

if __name__ == "__main__":
    process_reviews()
