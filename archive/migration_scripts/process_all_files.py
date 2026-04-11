import csv
import os

# Paths
base_dir = r"c:\Users\USER\Desktop\OSS\BoardGameRent\dullgboardgamerent\db_seeds"
games_path = os.path.join(base_dir, "raw_games.csv")
rentals_path = os.path.join(base_dir, "rentals.csv")
reviews_path = os.path.join(base_dir, "reviews.csv")

# 1. Read Games and Build Map
games = []
id_map = {} # old_id_str -> new_id_str

with open(games_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    game_fieldnames = reader.fieldnames
    print(f"Keys found: {game_fieldnames}")
    for row in reader:
        games.append(row)

# Determine Next ID
max_id = 0
for row in games:
    try:
        pid = int(row['id'])
        print(f"Checking ID: {pid}") # Debug
        if pid < 10000: # Standard IDs
            if pid > max_id:
                max_id = pid
    except:
        pass

next_id = max_id + 1
print(f"Starting renumbering from ID: {next_id}")

# Renumber Games
for row in games:
    original_id = row['id']
    try:
        pid = int(original_id)
        if pid >= 10000:
            new_id = str(next_id)
            id_map[original_id] = new_id
            row['id'] = new_id
            next_id += 1
    except:
        # Non-integer IDs
        new_id = str(next_id)
        id_map[original_id] = new_id
        row['id'] = new_id
        next_id += 1

# 2. Process Rentals (Update game_id)
rentals = []
with open(rentals_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rental_fieldnames = reader.fieldnames
    for row in reader:
        gid = row['game_id']
        if gid in id_map:
            row['game_id'] = id_map[gid]
        rentals.append(row)

# 3. Process Reviews (Update game_id)
reviews = []
with open(reviews_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    review_fieldnames = reader.fieldnames
    for row in reader:
        gid = row['game_id']
        if gid in id_map:
            row['game_id'] = id_map[gid]
        reviews.append(row)

# 4. Save All Files
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

print(f"Renumbered {len(id_map)} items.")
print(f"Mapping applied to Rentals and Reviews.")
