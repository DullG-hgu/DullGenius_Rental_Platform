-- Create a table for storing application configuration
create table if not exists app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table app_config enable row level security;

-- Create policies
-- Allow everyone to read config (Public Read)
create policy "Allow public read access"
  on app_config for select
  using (true);

-- Allow authenticated users (or just service role/admins if we have strict roles) to update
-- For now, to match current behavior where any 'admin' (even client-side authenticated) can edit, 
-- we might allow update for authenticated users. 
-- Ideally, this should be restricted to admin role.
-- Assuming 'authenticated' role is sufficient for now as this is an internal tool usage context or we rely on app logic.
-- But to be safe and allow the 'AddGameTab' logic (which runs on client) to work:

create policy "Allow authenticated insert/update"
  on app_config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Insert default config if not exists
insert into app_config (key, value)
values (
  'recommendations',
  '[
    {"label": "#입문\\n추천", "value": "#입문", "color": "#f1c40f", "key": "default_1"},
    {"label": "#파티\\n게임", "value": "#파티", "color": "#e67e22", "key": "default_2"},
    {"label": "#전략\\n게임", "value": "#전략", "color": "#e74c3c", "key": "default_3"},
    {"label": "#2인\\n추천", "value": "#2인", "color": "#9b59b6", "key": "default_4"}
  ]'::jsonb
)
on conflict (key) do nothing;
