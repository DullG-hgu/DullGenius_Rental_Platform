
import csv
import os

# 파일 경로 설정 (사용자 환경 기준 절대 경로)
CSV_FILE_PATH = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\archive\DullG_BoardGame_Rental - Games (2).csv"
OUTPUT_SQL_PATH = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\database\update_thumbnails.sql"

def generate_sql():
    # SQL 파일 시작
    sql_statements = ["-- 보드게임 썸네일 일괄 업데이트 SQL", "BEGIN;"]
    
    try:
        with open(CSV_FILE_PATH, mode='r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            
            count = 0
            for row in reader:
                game_id = row.get('id')
                image_url = row.get('image')
                
                # ID와 이미지 URL이 모두 존재할 때만 업데이트 구문 생성
                if game_id and image_url and image_url.strip():
                    # SQL Injection 방지를 위해 간단히 이스케이프 (싱글 따옴표 처리)
                    safe_url = image_url.replace("'", "''")
                    
                    sql = f"UPDATE public.games SET image = '{safe_url}' WHERE id = {game_id};"
                    sql_statements.append(sql)
                    count += 1
                    
            print(f"총 {count}개의 업데이트 구문을 생성했습니다.")
            
    except FileNotFoundError:
        print(f"오류: CSV 파일을 찾을 수 없습니다: {CSV_FILE_PATH}")
        return
    except Exception as e:
        print(f"오류 발생: {e}")
        return

    # 트랜잭션 커밋
    sql_statements.append("COMMIT;")

    # SQL 파일 저장
    with open(OUTPUT_SQL_PATH, mode='w', encoding='utf-8') as sqlfile:
        sqlfile.write('\n'.join(sql_statements))
    
    print(f"SQL 파일이 생성되었습니다: {OUTPUT_SQL_PATH}")

if __name__ == "__main__":
    generate_sql()
