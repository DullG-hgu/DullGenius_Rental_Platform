
import csv

input_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\csv 파일들\DullG_BoardGame_Rental - Users.csv"
output_path = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\csv 파일들\allowed_users.csv"

def process_users():
    allowed_users = []
    
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            # CSV 컬럼: name,student_id,password,phone,is_paid,penalty,last_login,role
            allowed_users.append({
                'student_id': row['student_id'],
                'name': row['name'],
                'phone': row['phone'],
                'role': row['role'],
                'joined_semester': '2025-1' # 기본값
            })

    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        fieldnames = ['student_id', 'name', 'phone', 'role', 'joined_semester']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(allowed_users)

    print(f"Allowed users saved to: {output_path}")

if __name__ == "__main__":
    process_users()
