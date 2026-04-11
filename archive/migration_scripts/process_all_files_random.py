import csv
import os
import random

# Paths
base_dir = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\db_seeds"
games_path = os.path.join(base_dir, "raw_games.csv")
rentals_path = os.path.join(base_dir, "rentals.csv")
reviews_path = os.path.join(base_dir, "reviews.csv")

# 1. Read Games
games = []
id_map = {} # old_id_str -> new_id_str (int8 random)

# Use utf-8-sig to handle BOM if present
with open(games_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    game_fieldnames = reader.fieldnames
    print(f"Game Keys: {game_fieldnames}")
    for row in reader:
        games.append(row)

print(f"Total Games found: {len(games)}")

# 2. Generate New Random IDs (Int8)
# Range: 100000000000 (100B) to 900000000000 (900B) -> Fits comfortably in BigInt (max 9e18)
# Also using a set to ensure uniqueness (though extremely unlikely to collide)
used_ids = set()

for row in games:
    original_id = row['id']
    
    # Generate unique random ID
    while True:
        new_id_int = random.randint(100000, 999999999999) # up to 12 digits
        if new_id_int not in used_ids:
            used_ids.add(new_id_int)
            break
            
    new_id_str = str(new_id_int)
    id_map[original_id] = new_id_str
    row['id'] = new_id_str
    
# 3. Process Rentals (Update game_id)
rentals = []
rentals_updated = 0
with open(rentals_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rental_fieldnames = reader.fieldnames
    for row in reader:
        gid = row['game_id']
        if gid in id_map:
            row['game_id'] = id_map[gid]
            rentals_updated += 1
        rentals.append(row)

# 4. Process Reviews (Update game_id)
reviews = []
reviews_updated = 0
with open(reviews_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    review_fieldnames = reader.fieldnames
    for row in reader:
        gid = row['game_id']
        if gid in id_map:
            row['game_id'] = id_map[gid]
            reviews_updated += 1
        reviews.append(row)

# 5. Save All Files
with open(games_path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=game_fieldnames)
    writer.writeheader()
    writer.writerows(games)

with open(rentals_path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=rental_fieldnames)
    writer.writeheader()
    writer.writerows(rentals)

with open(reviews_path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=review_fieldnames)
    writer.writeheader()
    writer.writerows(reviews)

print(f"Successfully processed {len(games)} games.")
print(f"Updated {rentals_updated} rentals and {reviews_updated} reviews references.")
