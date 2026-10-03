create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_columns_board_id_position_idx
  on public.board_columns (board_id, position, created_at);

alter table public.board_columns enable row level security;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references public.board_columns(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_column_id_position_idx
  on public.tasks (column_id, position, created_at);

alter table public.tasks enable row level security;

create or replace function public.user_can_access_board(target_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards
    where id = target_board_id
      and owner_id = auth.uid()
  );
$$;

create or replace function public.user_can_access_column(target_column_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_columns
    where id = target_column_id
      and public.user_can_access_board(board_id)
  );
$$;

drop policy if exists "Owners can view board columns" on public.board_columns;
create policy "Owners can view board columns"
  on public.board_columns
  for select
  to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can create board columns" on public.board_columns;
create policy "Owners can create board columns"
  on public.board_columns
  for insert
  to authenticated
  with check (public.user_can_access_board(board_id));

drop policy if exists "Owners can update board columns" on public.board_columns;
create policy "Owners can update board columns"
  on public.board_columns
  for update
  to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

drop policy if exists "Owners can delete board columns" on public.board_columns;
create policy "Owners can delete board columns"
  on public.board_columns
  for delete
  to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can view tasks" on public.tasks;
create policy "Owners can view tasks"
  on public.tasks
  for select
  to authenticated
  using (public.user_can_access_column(column_id));

drop policy if exists "Owners can create tasks" on public.tasks;
create policy "Owners can create tasks"
  on public.tasks
  for insert
  to authenticated
  with check (public.user_can_access_column(column_id));

drop policy if exists "Owners can update tasks" on public.tasks;
create policy "Owners can update tasks"
  on public.tasks
  for update
  to authenticated
  using (public.user_can_access_column(column_id))
  with check (public.user_can_access_column(column_id));

drop policy if exists "Owners can delete tasks" on public.tasks;
create policy "Owners can delete tasks"
  on public.tasks
  for delete
  to authenticated
  using (public.user_can_access_column(column_id));
