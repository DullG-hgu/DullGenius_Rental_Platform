-- 1. Damage Reports Table
create table if not exists public.damage_reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null, -- [CHANGED] Reference profiles for easier joins
  game_id bigint references public.games(id),
  game_name text not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  status text default 'pending' check (status in ('pending', 'resolved', 'ignored'))
);

-- 2. Game Requests Table
create table if not exists public.game_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null, -- [CHANGED] Reference profiles
  game_title text not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'purchased'))
);

-- 3. Enable RLS
alter table public.damage_reports enable row level security;
alter table public.game_requests enable row level security;

-- 4. Policies
-- Damage Reports
create policy "Authenticated users can insert damage reports"
  on public.damage_reports for insert
  with check (auth.role() = 'authenticated');

create policy "Users can see their own reports"
  on public.damage_reports for select
  using (auth.uid() = user_id);

create policy "Admins can do everything on damage_reports"
  on public.damage_reports for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role_key in ('admin', 'executive', 'staff')
    )
  );

-- Game Requests
create policy "Authenticated users can insert game requests"
  on public.game_requests for insert
  with check (auth.role() = 'authenticated');

create policy "Users can see their own requests"
  on public.game_requests for select
  using (auth.uid() = user_id);

create policy "Admins can do everything on game_requests"
  on public.game_requests for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role_key in ('admin', 'executive', 'staff')
    )
  );
