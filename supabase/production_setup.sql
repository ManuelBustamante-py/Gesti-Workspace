-- Kanban Workspace production setup
-- Run this script once in Supabase SQL Editor.
-- It assumes the existing public.boards and public.profiles tables are present.

begin;

-- 1. Board columns and tasks
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
  on public.board_columns for select to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can create board columns" on public.board_columns;
create policy "Owners can create board columns"
  on public.board_columns for insert to authenticated
  with check (public.user_can_access_board(board_id));

drop policy if exists "Owners can update board columns" on public.board_columns;
create policy "Owners can update board columns"
  on public.board_columns for update to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

drop policy if exists "Owners can delete board columns" on public.board_columns;
create policy "Owners can delete board columns"
  on public.board_columns for delete to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can view tasks" on public.tasks;
create policy "Owners can view tasks"
  on public.tasks for select to authenticated
  using (public.user_can_access_column(column_id));

drop policy if exists "Owners can create tasks" on public.tasks;
create policy "Owners can create tasks"
  on public.tasks for insert to authenticated
  with check (public.user_can_access_column(column_id));

drop policy if exists "Owners can update tasks" on public.tasks;
create policy "Owners can update tasks"
  on public.tasks for update to authenticated
  using (public.user_can_access_column(column_id))
  with check (public.user_can_access_column(column_id));

drop policy if exists "Owners can delete tasks" on public.tasks;
create policy "Owners can delete tasks"
  on public.tasks for delete to authenticated
  using (public.user_can_access_column(column_id));

-- 2. Task priority and due date
alter table public.tasks
  add column if not exists priority text not null default 'medium',
  add column if not exists due_date date;

alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority in ('low', 'medium', 'high'));

-- 3. Board members
create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  unique (board_id, user_id)
);

create index if not exists board_members_board_id_idx
  on public.board_members (board_id);

alter table public.board_members enable row level security;

drop policy if exists "Board owners and members can view members" on public.board_members;
create policy "Board owners and members can view members"
  on public.board_members for select to authenticated
  using (
    public.user_can_access_board(board_id)
    or user_id = auth.uid()
  );

drop policy if exists "Board owners can invite members" on public.board_members;
create policy "Board owners can invite members"
  on public.board_members for insert to authenticated
  with check (public.user_can_access_board(board_id));

drop policy if exists "Board owners can update member roles" on public.board_members;
create policy "Board owners can update member roles"
  on public.board_members for update to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

drop policy if exists "Board owners can remove members" on public.board_members;
create policy "Board owners can remove members"
  on public.board_members for delete to authenticated
  using (public.user_can_access_board(board_id));

-- 4. Board invitations
create table if not exists public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (board_id, email)
);

alter table public.board_invitations enable row level security;

drop policy if exists "Board owners can manage invitations" on public.board_invitations;
create policy "Board owners can manage invitations"
  on public.board_invitations for all to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

create index if not exists board_invitations_email_idx
  on public.board_invitations (email, status);

-- 5. Profile first and last names
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

update public.profiles
set
  first_name = coalesce(first_name, split_part(display_name, ' ', 1)),
  last_name = coalesce(
    last_name,
    nullif(trim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), '')
  )
where first_name is null or last_name is null;

commit;
