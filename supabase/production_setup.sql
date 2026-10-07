-- Kanban Workspace production setup
-- Run this script once in Supabase SQL Editor.
-- It assumes the existing public.boards and public.profiles tables are present.

begin;

-- 0. Configuración de jornada por tablero
alter table public.boards
  add column if not exists working_days integer[] not null default '{1,2,3,4,5,6,7}',
  add column if not exists work_start_time time not null default '08:00',
  add column if not exists work_end_time time not null default '17:00';

alter table public.boards
  drop constraint if exists boards_working_days_check;

alter table public.boards
  add constraint boards_working_days_check
  check (
    cardinality(working_days) > 0
    and working_days <@ array[1, 2, 3, 4, 5, 6, 7]
    and work_start_time < work_end_time
  );

-- 1. Board columns and tasks
create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  position integer not null default 0 check (position >= 0),
  predecessor_ids uuid[] not null default '{}',
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

alter table public.tasks
  add column if not exists predecessor_ids uuid[] not null default '{}';

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
  add column if not exists due_date date,
  add column if not exists start_date date,
  add column if not exists end_date date;

update public.tasks
set end_date = due_date
where end_date is null and due_date is not null;

alter table public.tasks
  drop constraint if exists tasks_schedule_dates_check;

alter table public.tasks
  add constraint tasks_schedule_dates_check
  check (start_date is null or end_date is null or start_date <= end_date);

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
  recipient_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (board_id, email)
);

alter table public.board_invitations
  add column if not exists recipient_id uuid references auth.users(id) on delete cascade;

alter table public.board_invitations enable row level security;

drop policy if exists "Board owners can manage invitations" on public.board_invitations;
create policy "Board owners can manage invitations"
  on public.board_invitations for all to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

create index if not exists board_invitations_email_idx
  on public.board_invitations (email, status);

create index if not exists board_invitations_recipient_status_idx
  on public.board_invitations (recipient_id, status);

create or replace function public.get_received_board_invitations()
returns table (
  id uuid, board_id uuid, recipient_id uuid, email text, role text,
  status text, token uuid, created_at timestamptz,
  board_name text, board_color text
)
language sql security definer set search_path = public
as $$
  select invitation.id, invitation.board_id, invitation.recipient_id,
    invitation.email, invitation.role, invitation.status, invitation.token,
    invitation.created_at, board.name, board.color
  from public.board_invitations invitation
  join public.boards board on board.id = invitation.board_id
  where invitation.recipient_id = auth.uid()
    and invitation.status = 'pending'
  order by invitation.created_at desc;
$$;

drop policy if exists "Board recipients can view their invitations" on public.board_invitations;
create policy "Board recipients can view their invitations"
  on public.board_invitations for select to authenticated
  using (recipient_id = auth.uid());

create or replace function public.invite_board_member(
  target_board_id uuid,
  target_email text,
  target_role text
)
returns public.board_invitations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invitation public.board_invitations;
  recipient uuid;
  normalized_email text := lower(trim(target_email));
begin
  if not exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  ) then
    raise exception 'No tienes permiso para invitar colaboradores a este tablero.';
  end if;
  if normalized_email = '' or position('@' in normalized_email) = 0 then
    raise exception 'Indica un correo electrónico válido.';
  end if;
  if target_role not in ('viewer', 'editor') then
    raise exception 'El rol indicado no es válido.';
  end if;
  select id into recipient from auth.users
  where lower(email) = normalized_email limit 1;
  if recipient is null then
    raise exception 'No existe una cuenta registrada con ese correo.';
  end if;
  if recipient = auth.uid() then
    raise exception 'No puedes invitarte a ti mismo.';
  end if;
  insert into public.board_invitations (board_id, recipient_id, email, role, status)
  values (target_board_id, recipient, normalized_email, target_role, 'pending')
  on conflict (board_id, email) do update set
    recipient_id = excluded.recipient_id,
    role = excluded.role,
    status = 'pending',
    created_at = now()
  returning * into invitation;
  return invitation;
end;
$$;

create or replace function public.accept_board_invitation(invitation_id uuid)
returns public.board_invitations
language plpgsql security definer set search_path = public
as $$
declare invitation public.board_invitations;
begin
  select * into invitation from public.board_invitations
  where id = invitation_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if invitation.id is null then
    raise exception 'La solicitud no existe o ya fue respondida.';
  end if;
  insert into public.board_members (board_id, user_id, role)
  values (invitation.board_id, auth.uid(), invitation.role)
  on conflict (board_id, user_id) do update set role = excluded.role;
  update public.board_invitations set status = 'accepted'
  where id = invitation.id returning * into invitation;
  return invitation;
end;
$$;

create or replace function public.decline_board_invitation(invitation_id uuid)
returns public.board_invitations
language plpgsql security definer set search_path = public
as $$
declare invitation public.board_invitations;
begin
  update public.board_invitations set status = 'declined'
  where id = invitation_id and recipient_id = auth.uid() and status = 'pending'
  returning * into invitation;
  if invitation.id is null then
    raise exception 'La solicitud no existe o ya fue respondida.';
  end if;
  return invitation;
end;
$$;

revoke all on function public.invite_board_member(uuid, text, text) from public;
grant execute on function public.invite_board_member(uuid, text, text) to authenticated;
revoke all on function public.get_received_board_invitations() from public;
grant execute on function public.get_received_board_invitations() to authenticated;
revoke all on function public.accept_board_invitation(uuid) from public;
grant execute on function public.accept_board_invitation(uuid) to authenticated;
revoke all on function public.decline_board_invitation(uuid) from public;
grant execute on function public.decline_board_invitation(uuid) to authenticated;

create or replace function public.get_board_collaborators(target_board_id uuid)
returns table (
  id uuid, board_id uuid, user_id uuid, role text, created_at timestamptz,
  username text, display_name text, avatar_url text
)
language sql security definer set search_path = public
as $$
  select member.id, member.board_id, member.user_id, member.role,
    member.created_at, profile.username, profile.display_name, profile.avatar_url
  from public.board_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.board_id = target_board_id
    and public.user_can_access_board(target_board_id);
$$;

revoke all on function public.get_board_collaborators(uuid) from public;
grant execute on function public.get_board_collaborators(uuid) to authenticated;

create or replace function public.user_can_access_board(target_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.board_members
    where board_id = target_board_id and user_id = auth.uid()
  );
$$;

create or replace function public.user_can_edit_board(target_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.board_members
    where board_id = target_board_id
      and user_id = auth.uid()
      and role = 'editor'
  );
$$;

drop policy if exists "Board owners and members can view boards" on public.boards;
create policy "Board owners and members can view boards"
  on public.boards for select to authenticated
  using (public.user_can_access_board(id));

drop policy if exists "Owners can view board columns" on public.board_columns;
drop policy if exists "Owners and members can view board columns" on public.board_columns;
create policy "Owners and members can view board columns"
  on public.board_columns for select to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can create board columns" on public.board_columns;
drop policy if exists "Owners and editors can create board columns" on public.board_columns;
create policy "Owners and editors can create board columns"
  on public.board_columns for insert to authenticated
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Owners can update board columns" on public.board_columns;
drop policy if exists "Owners and editors can update board columns" on public.board_columns;
create policy "Owners and editors can update board columns"
  on public.board_columns for update to authenticated
  using (public.user_can_edit_board(board_id))
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Owners can delete board columns" on public.board_columns;
drop policy if exists "Owners and editors can delete board columns" on public.board_columns;
create policy "Owners and editors can delete board columns"
  on public.board_columns for delete to authenticated
  using (public.user_can_edit_board(board_id));

drop policy if exists "Owners can view tasks" on public.tasks;
drop policy if exists "Owners and members can view tasks" on public.tasks;
create policy "Owners and members can view tasks"
  on public.tasks for select to authenticated
  using (public.user_can_access_column(column_id));

drop policy if exists "Owners can create tasks" on public.tasks;
drop policy if exists "Owners and editors can create tasks" on public.tasks;
create policy "Owners and editors can create tasks"
  on public.tasks for insert to authenticated
  with check (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));

drop policy if exists "Owners can update tasks" on public.tasks;
drop policy if exists "Owners and editors can update tasks" on public.tasks;
create policy "Owners and editors can update tasks"
  on public.tasks for update to authenticated
  using (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)))
  with check (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));

drop policy if exists "Owners can delete tasks" on public.tasks;
drop policy if exists "Owners and editors can delete tasks" on public.tasks;
create policy "Owners and editors can delete tasks"
  on public.tasks for delete to authenticated
  using (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));

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

do $$
begin
  alter publication supabase_realtime add table public.board_members;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.board_invitations;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.board_columns;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end;
$$;

-- 6. Permisos de colaboración, estado de columnas e integridad de predecesoras
-- (idéntico a migrations/20261006120000_harden_collaboration_and_task_integrity.sql)

-- 1. Permisos de colaboración
-- user_can_access_board() incluye a los miembros desde la migración
-- 20261003133000, por lo que las políticas de board_members y
-- board_invitations que lo usaban permitían a cualquier miembro (incluso un
-- lector) cambiar su propio rol, añadir o quitar miembros y crear
-- invitaciones a su nombre. La gestión pasa a ser exclusiva del propietario.

create or replace function public.user_is_board_owner(target_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  );
$$;

drop policy if exists "Board owners and members can view members" on public.board_members;
create policy "Board owners and members can view members"
  on public.board_members for select to authenticated
  using (public.user_can_access_board(board_id) or user_id = auth.uid());

drop policy if exists "Board owners can invite members" on public.board_members;
create policy "Board owners can invite members"
  on public.board_members for insert to authenticated
  with check (public.user_is_board_owner(board_id));

drop policy if exists "Board owners can update member roles" on public.board_members;
create policy "Board owners can update member roles"
  on public.board_members for update to authenticated
  using (public.user_is_board_owner(board_id))
  with check (public.user_is_board_owner(board_id));

drop policy if exists "Board owners can remove members" on public.board_members;
create policy "Board owners can remove members"
  on public.board_members for delete to authenticated
  using (public.user_is_board_owner(board_id) or user_id = auth.uid());

drop policy if exists "Board owners can manage invitations" on public.board_invitations;
create policy "Board owners can manage invitations"
  on public.board_invitations for all to authenticated
  using (public.user_is_board_owner(board_id))
  with check (public.user_is_board_owner(board_id));

-- 2. Estado explícito por columna
-- Sustituye la inferencia por nombre ("Completado", "En progreso"...) que
-- cada pantalla resolvía con palabras clave distintas.

alter table public.board_columns
  add column if not exists status text;

update public.board_columns
set status = case
  when lower(name) ~ '(complet|termin|hech|final|done|cerrad)' then 'done'
  when lower(name) ~ '(progreso|proceso|curso|doing|revisi|review)' then 'in_progress'
  else 'todo'
end
where status is null;

alter table public.board_columns
  alter column status set default 'todo',
  alter column status set not null;

alter table public.board_columns
  drop constraint if exists board_columns_status_check;

alter table public.board_columns
  add constraint board_columns_status_check
  check (status in ('todo', 'in_progress', 'done'));

-- 3. Integridad de predecesoras
-- predecessor_ids no tiene claves foráneas: se limpian huérfanas, se validan
-- tablero y ciclos al escribir y se retiran referencias al borrar una tarea.

update public.tasks task
set predecessor_ids = coalesce(
  (
    select array_agg(distinct predecessor_id)
    from unnest(task.predecessor_ids) as predecessor_id
    where predecessor_id <> task.id
      and exists (select 1 from public.tasks other where other.id = predecessor_id)
  ),
  '{}'
)
where cardinality(task.predecessor_ids) > 0;

create or replace function public.validate_task_predecessors()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  task_board uuid;
  foreign_count integer;
  has_cycle boolean;
begin
  new.predecessor_ids := coalesce(
    (
      select array_agg(distinct predecessor_id)
      from unnest(new.predecessor_ids) as predecessor_id
      where predecessor_id <> new.id
    ),
    '{}'
  );

  if cardinality(new.predecessor_ids) = 0 then
    return new;
  end if;

  select board_id into task_board
  from public.board_columns
  where id = new.column_id;

  select count(*) into foreign_count
  from unnest(new.predecessor_ids) as predecessor_id
  left join public.tasks predecessor on predecessor.id = predecessor_id
  left join public.board_columns predecessor_column on predecessor_column.id = predecessor.column_id
  where predecessor_column.board_id is distinct from task_board;

  if foreign_count > 0 then
    raise exception 'Las predecesoras deben ser tareas del mismo tablero.';
  end if;

  with recursive chain(id) as (
    select unnest(new.predecessor_ids)
    union
    select predecessor_id
    from public.tasks ancestor
    join chain on ancestor.id = chain.id
    cross join lateral unnest(ancestor.predecessor_ids) as predecessor_id
    where ancestor.id <> new.id
  )
  select exists (select 1 from chain where id = new.id) into has_cycle;

  if has_cycle then
    raise exception 'Las dependencias formarían un ciclo.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_validate_predecessors on public.tasks;
create trigger tasks_validate_predecessors
  before insert or update of predecessor_ids, column_id on public.tasks
  for each row execute function public.validate_task_predecessors();

create or replace function public.remove_deleted_task_from_predecessors()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.tasks
  set predecessor_ids = array_remove(predecessor_ids, old.id)
  where old.id = any(predecessor_ids);
  return old;
end;
$$;

drop trigger if exists tasks_remove_deleted_predecessor on public.tasks;
create trigger tasks_remove_deleted_predecessor
  after delete on public.tasks
  for each row execute function public.remove_deleted_task_from_predecessors();

-- 4. Realtime de tableros (renombrado, jornada y borrado llegan a los colaboradores)
do $$
begin
  alter publication supabase_realtime add table public.boards;
exception when duplicate_object then null;
end;
$$;

-- Verificación manual recomendada: las políticas de public.boards no están
-- versionadas en este repositorio. Revísalas con
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'boards';
-- UPDATE y DELETE deberían limitarse a owner_id = auth.uid().

-- 7. Responsables de tareas
-- (idéntico a migrations/20261006180000_add_task_assignees.sql)

-- Responsables de tareas.
-- Solo el propietario del tablero asigna; los responsables deben ser el propio
-- propietario o colaboradores del tablero. Requiere 20261006120000
-- (user_is_board_owner).

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_id_idx
  on public.task_assignees (user_id);

alter table public.task_assignees enable row level security;

create or replace function public.task_board_id(target_task_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select board_column.board_id
  from public.tasks task
  join public.board_columns board_column on board_column.id = task.column_id
  where task.id = target_task_id;
$$;

create or replace function public.user_is_board_participant(target_board_id uuid, target_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = target_user_id
  ) or exists (
    select 1 from public.board_members
    where board_id = target_board_id and user_id = target_user_id
  );
$$;

drop policy if exists "Board participants can view task assignees" on public.task_assignees;
create policy "Board participants can view task assignees"
  on public.task_assignees for select to authenticated
  using (public.user_can_access_board(public.task_board_id(task_id)));

drop policy if exists "Board owners can assign tasks" on public.task_assignees;
create policy "Board owners can assign tasks"
  on public.task_assignees for insert to authenticated
  with check (
    public.user_is_board_owner(public.task_board_id(task_id))
    and public.user_is_board_participant(public.task_board_id(task_id), user_id)
  );

drop policy if exists "Board owners can unassign tasks" on public.task_assignees;
create policy "Board owners can unassign tasks"
  on public.task_assignees for delete to authenticated
  using (public.user_is_board_owner(public.task_board_id(task_id)));

-- Reemplaza los responsables de una tarea en una sola transacción.
create or replace function public.set_task_assignees(target_task_id uuid, assignee_ids uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  target_board uuid := public.task_board_id(target_task_id);
  requested uuid[] := coalesce(assignee_ids, '{}');
begin
  if target_board is null then
    raise exception 'La tarea no existe.';
  end if;

  if not public.user_is_board_owner(target_board) then
    raise exception 'Solo el propietario del tablero puede asignar responsables.';
  end if;

  if exists (
    select 1 from unnest(requested) as assignee_id
    where not public.user_is_board_participant(target_board, assignee_id)
  ) then
    raise exception 'Solo puedes asignar al propietario o a colaboradores del tablero.';
  end if;

  delete from public.task_assignees
  where task_id = target_task_id
    and not (user_id = any(requested));

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select distinct target_task_id, assignee_id, auth.uid()
  from unnest(requested) as assignee_id
  on conflict (task_id, user_id) do nothing;
end;
$$;

create or replace function public.get_board_task_assignees(target_board_id uuid)
returns table (task_id uuid, user_id uuid)
language sql stable security definer
set search_path = public
as $$
  select assignee.task_id, assignee.user_id
  from public.task_assignees assignee
  join public.tasks task on task.id = assignee.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  where board_column.board_id = target_board_id
    and public.user_can_access_board(target_board_id)
  order by assignee.created_at;
$$;

revoke all on function public.set_task_assignees(uuid, uuid[]) from public;
grant execute on function public.set_task_assignees(uuid, uuid[]) to authenticated;
revoke all on function public.get_board_task_assignees(uuid) from public;
grant execute on function public.get_board_task_assignees(uuid) to authenticated;

-- Al perder el acceso a un tablero, la persona deja de ser responsable de sus tareas.
create or replace function public.remove_assignments_of_removed_member()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.task_assignees assignee
  using public.tasks task, public.board_columns board_column
  where assignee.task_id = task.id
    and task.column_id = board_column.id
    and board_column.board_id = old.board_id
    and assignee.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists board_members_remove_assignments on public.board_members;
create trigger board_members_remove_assignments
  after delete on public.board_members
  for each row execute function public.remove_assignments_of_removed_member();

do $$
begin
  alter publication supabase_realtime add table public.task_assignees;
exception when duplicate_object then null;
end;
$$;

-- 8. Comentarios de tareas e imágenes adjuntas
-- (idéntico a migrations/20261006200000_add_task_comments.sql)

-- Comentarios de tareas con imágenes adjuntas.
-- Requiere 20261006120000 (user_is_board_owner) y 20261006180000 (task_board_id).
--
-- Las imágenes no se guardan en la base de datos: van al bucket privado
-- «task-attachments» de Supabase Storage, ya comprimidas a WebP (o JPEG si el
-- navegador no puede generar WebP) en el cliente. Aquí solo se guarda la ruta.
-- Ruta de cada archivo: {board_id}/{task_id}/{author_id}/{uuid}.webp

-- 1. Comentarios ----------------------------------------------------------

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null default 'comment' check (kind in ('comment', 'issue', 'workaround')),
  body text not null default '' check (char_length(body) <= 4000),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_attachments_check check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4
  ),
  constraint task_comments_not_empty_check check (
    char_length(trim(body)) > 0 or jsonb_array_length(attachments) > 0
  )
);

create index if not exists task_comments_task_id_created_idx
  on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;

drop policy if exists "Board participants can read comments" on public.task_comments;
create policy "Board participants can read comments"
  on public.task_comments for select to authenticated
  using (public.user_can_access_board(public.task_board_id(task_id)));

-- Propietario y editores comentan; los lectores no.
drop policy if exists "Editors can comment" on public.task_comments;
create policy "Editors can comment"
  on public.task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_edit_board(public.task_board_id(task_id))
  );

drop policy if exists "Authors can edit their comments" on public.task_comments;
create policy "Authors can edit their comments"
  on public.task_comments for update to authenticated
  using (author_id = auth.uid() and public.user_can_edit_board(public.task_board_id(task_id)))
  with check (author_id = auth.uid() and public.user_can_edit_board(public.task_board_id(task_id)));

-- El autor borra lo suyo; el propietario puede moderar cualquier comentario.
drop policy if exists "Authors and owners can delete comments" on public.task_comments;
create policy "Authors and owners can delete comments"
  on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or public.user_is_board_owner(public.task_board_id(task_id)));

create or replace function public.validate_task_comment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  expected_prefix text;
  invalid_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.task_id <> old.task_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
      raise exception 'Solo se puede modificar el texto y el tipo del comentario.';
    end if;
    -- Los adjuntos no se editan: para cambiarlos se publica otro comentario.
    new.attachments := old.attachments;
    new.updated_at := now();
    return new;
  end if;

  -- Cada adjunto debe estar en la carpeta del autor dentro de esa tarea.
  expected_prefix := public.task_board_id(new.task_id)::text || '/' || new.task_id::text || '/' || new.author_id::text || '/';
  select count(*) into invalid_count
  from jsonb_array_elements(new.attachments) as attachment
  where jsonb_typeof(attachment -> 'path') is distinct from 'string'
     or left(attachment ->> 'path', length(expected_prefix)) <> expected_prefix;

  if invalid_count > 0 then
    raise exception 'Los adjuntos deben pertenecer a la tarea comentada.';
  end if;

  return new;
end;
$$;

drop trigger if exists task_comments_validate on public.task_comments;
create trigger task_comments_validate
  before insert or update on public.task_comments
  for each row execute function public.validate_task_comment();

-- Comentarios con el nombre del autor, aunque ya no pertenezca al tablero.
create or replace function public.get_task_comments(target_task_id uuid)
returns table (
  id uuid,
  task_id uuid,
  author_id uuid,
  kind text,
  body text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  author_name text,
  author_username text,
  author_avatar_url text
)
language sql stable security definer
set search_path = public
as $$
  select comment.id, comment.task_id, comment.author_id, comment.kind, comment.body,
    comment.attachments, comment.created_at, comment.updated_at,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    profile.username, profile.avatar_url
  from public.task_comments comment
  left join public.profiles profile on profile.id = comment.author_id
  where comment.task_id = target_task_id
    and public.user_can_access_board(public.task_board_id(target_task_id))
  order by comment.created_at;
$$;

-- Totales por tarea para las tarjetas: comentarios y avisos (problemas o parches).
create or replace function public.get_board_comment_stats(target_board_id uuid)
returns table (task_id uuid, total integer, alerts integer)
language sql stable security definer
set search_path = public
as $$
  select comment.task_id,
    count(*)::integer,
    count(*) filter (where comment.kind in ('issue', 'workaround'))::integer
  from public.task_comments comment
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  where board_column.board_id = target_board_id
    and public.user_can_access_board(target_board_id)
  group by comment.task_id;
$$;

revoke all on function public.get_task_comments(uuid) from public;
grant execute on function public.get_task_comments(uuid) to authenticated;
revoke all on function public.get_board_comment_stats(uuid) from public;
grant execute on function public.get_board_comment_stats(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null;
end;
$$;

-- 2. Almacenamiento de imágenes ---------------------------------------------

-- Bucket privado: máximo 1 MB por archivo y solo formatos comprimidos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "Board participants can view task attachments" on storage.objects;
create policy "Board participants can view task attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.user_can_access_board(public.try_uuid((storage.foldername(name))[1]))
  );

-- Solo editores suben, y solo dentro de su propia carpeta de autor.
drop policy if exists "Editors can upload task attachments" on storage.objects;
create policy "Editors can upload task attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.user_can_edit_board(public.try_uuid((storage.foldername(name))[1]))
    and public.task_board_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
    and (storage.foldername(name))[3] = auth.uid()::text
  );

drop policy if exists "Authors and owners can delete task attachments" on storage.objects;
create policy "Authors and owners can delete task attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
      (storage.foldername(name))[3] = auth.uid()::text
      or public.user_is_board_owner(public.try_uuid((storage.foldername(name))[1]))
    )
  );

-- Nota: al borrar una tarea o un tablero en cascada, los comentarios se
-- eliminan, pero los archivos de Storage no (Supabase no permite borrarlos
-- desde SQL). La aplicación borra las imágenes al eliminar un comentario; para
-- tareas y tableros eliminados queda pendiente una limpieza periódica.

-- 9. Mensajes y notificaciones por tablero
-- (idéntico a migrations/20261006220000_add_board_messages.sql)

-- Mensajes y notificaciones por tablero.
-- Requiere 20261006200000 (task_comments).
--
-- No se crea una fila por destinatario y comentario (con equipos grandes eso
-- multiplica los datos). Cada persona guarda, por tablero, hasta cuándo leyó y
-- si silenció el tablero; los no leídos se calculan a partir de task_comments.

create table if not exists public.board_notification_settings (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  muted boolean not null default false,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

alter table public.board_notification_settings enable row level security;

-- Cada persona solo ve y modifica su propia configuración.
drop policy if exists "Users manage their own board notification settings" on public.board_notification_settings;
create policy "Users manage their own board notification settings"
  on public.board_notification_settings for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.user_can_access_board(board_id));

create index if not exists task_comments_created_at_idx
  on public.task_comments (created_at desc);

-- Desde cuándo cuentan los mensajes como no leídos: última lectura o, si nunca
-- leyó, desde que entró al tablero (para no marcar todo el historial como nuevo).
create or replace function public.board_read_baseline(target_board_id uuid, target_user_id uuid)
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select last_read_at from public.board_notification_settings
      where board_id = target_board_id and user_id = target_user_id),
    (select created_at from public.board_members
      where board_id = target_board_id and user_id = target_user_id),
    (select created_at from public.boards where id = target_board_id)
  );
$$;

-- No leídos y silenciado de cada tablero accesible.
create or replace function public.get_unread_message_counts()
returns table (board_id uuid, unread integer, muted boolean)
language sql stable security definer
set search_path = public
as $
  -- La fecha de referencia se calcula una vez por tablero, no por comentario.
  with my_boards as (
    select board.id,
      coalesce(settings.muted, false) as muted,
      coalesce(settings.last_read_at, member.created_at, board.created_at) as baseline
    from public.boards board
    left join public.board_members member
      on member.board_id = board.id and member.user_id = auth.uid()
    left join public.board_notification_settings settings
      on settings.board_id = board.id and settings.user_id = auth.uid()
    where board.owner_id = auth.uid() or member.user_id is not null
  )
  select my_boards.id,
    (
      select count(*)
      from public.task_comments comment
      join public.tasks task on task.id = comment.task_id
      join public.board_columns board_column on board_column.id = task.column_id
      where board_column.board_id = my_boards.id
        and comment.author_id <> auth.uid()
        and comment.created_at > my_boards.baseline
    )::integer,
    my_boards.muted
  from my_boards;
$;

-- Bandeja de mensajes de un tablero, del más reciente al más antiguo, paginada.
create or replace function public.get_board_messages(
  target_board_id uuid,
  before_created_at timestamptz default null,
  max_rows integer default 30
)
returns table (
  id uuid,
  task_id uuid,
  task_title text,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  kind text,
  body text,
  attachment_count integer,
  created_at timestamptz,
  is_unread boolean
)
language sql stable security definer
set search_path = public
as $$
  select comment.id, comment.task_id, task.title, comment.author_id,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    profile.avatar_url, comment.kind, comment.body,
    jsonb_array_length(comment.attachments), comment.created_at,
    comment.author_id <> auth.uid() and comment.created_at > reference.baseline
  from public.task_comments comment
  cross join (select public.board_read_baseline(target_board_id, auth.uid()) as baseline) reference
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  left join public.profiles profile on profile.id = comment.author_id
  where board_column.board_id = target_board_id
    and public.user_can_access_board(target_board_id)
    and (before_created_at is null or comment.created_at < before_created_at)
  order by comment.created_at desc
  limit least(greatest(coalesce(max_rows, 30), 1), 100);
$$;

-- Datos para el aviso de un comentario recién publicado (Realtime solo envía la fila).
create or replace function public.get_message_preview(target_comment_id uuid)
returns table (
  board_id uuid,
  board_name text,
  task_id uuid,
  task_title text,
  author_id uuid,
  author_name text,
  kind text,
  body text,
  muted boolean
)
language sql stable security definer
set search_path = public
as $$
  select board.id, board.name, task.id, task.title, comment.author_id,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    comment.kind, comment.body,
    coalesce((select settings.muted from public.board_notification_settings settings
      where settings.board_id = board.id and settings.user_id = auth.uid()), false)
  from public.task_comments comment
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  join public.boards board on board.id = board_column.board_id
  left join public.profiles profile on profile.id = comment.author_id
  where comment.id = target_comment_id
    and public.user_can_access_board(board.id);
$$;

create or replace function public.mark_board_messages_read(target_board_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_can_access_board(target_board_id) then
    raise exception 'No tienes acceso a este tablero.';
  end if;
  insert into public.board_notification_settings (board_id, user_id, last_read_at)
  values (target_board_id, auth.uid(), now())
  on conflict (board_id, user_id)
  do update set last_read_at = now(), updated_at = now();
end;
$$;

create or replace function public.set_board_notifications_muted(target_board_id uuid, is_muted boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_can_access_board(target_board_id) then
    raise exception 'No tienes acceso a este tablero.';
  end if;
  insert into public.board_notification_settings (board_id, user_id, muted)
  values (target_board_id, auth.uid(), is_muted)
  on conflict (board_id, user_id)
  do update set muted = excluded.muted, updated_at = now();
end;
$$;

revoke all on function public.board_read_baseline(uuid, uuid) from public;
revoke all on function public.get_unread_message_counts() from public;
grant execute on function public.get_unread_message_counts() to authenticated;
revoke all on function public.get_board_messages(uuid, timestamptz, integer) from public;
grant execute on function public.get_board_messages(uuid, timestamptz, integer) to authenticated;
revoke all on function public.get_message_preview(uuid) from public;
grant execute on function public.get_message_preview(uuid) to authenticated;
revoke all on function public.mark_board_messages_read(uuid) from public;
grant execute on function public.mark_board_messages_read(uuid) to authenticated;
revoke all on function public.set_board_notifications_muted(uuid, boolean) from public;
grant execute on function public.set_board_notifications_muted(uuid, boolean) to authenticated;

-- 10. Número fijo de actividad y reordenamiento por arrastre
-- (idéntico a migrations/20261007090000_task_numbers_and_reorder.sql)

-- Número fijo de actividad y reordenamiento por arrastre.
-- Requiere 20261003133000 (user_can_edit_board).
--
-- Hasta ahora el número (#1, #2...) se calculaba por columna y posición, así que
-- mover una tarjeta renumeraba el tablero. Ahora cada tarea guarda su número:
-- las existentes conservan el que se mostraba, las nuevas reciben el siguiente
-- libre del tablero y la importación puede fijarlo explícitamente.

alter table public.tasks
  add column if not exists number integer check (number is null or number > 0);

-- Mismo orden que la numeración anterior: columna, posición, creación.
update public.tasks task
set number = ordered.number
from (
  select task.id,
    row_number() over (
      partition by board_column.board_id
      order by board_column.position, board_column.created_at, task.position, task.created_at, task.id
    ) as number
  from public.tasks task
  join public.board_columns board_column on board_column.id = task.column_id
) ordered
where ordered.id = task.id
  and task.number is null;

create or replace function public.assign_task_number()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target_board uuid;
begin
  if new.number is not null then
    return new;
  end if;

  select board_id into target_board from public.board_columns where id = new.column_id;
  -- Evita que dos inserciones simultáneas del mismo tablero tomen el mismo número.
  perform pg_advisory_xact_lock(hashtext(target_board::text));

  select coalesce(max(task.number), 0) + 1 into new.number
  from public.tasks task
  join public.board_columns board_column on board_column.id = task.column_id
  where board_column.board_id = target_board;

  return new;
end;
$$;

drop trigger if exists tasks_assign_number on public.tasks;
create trigger tasks_assign_number
  before insert on public.tasks
  for each row execute function public.assign_task_number();

-- Reordena una columna en una sola transacción: las tareas quedan en la columna
-- indicada, en el orden recibido (posición 0, 1, 2...).
create or replace function public.reorder_column_tasks(target_column_id uuid, ordered_task_ids uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  target_board uuid;
  foreign_count integer;
begin
  select board_id into target_board from public.board_columns where id = target_column_id;
  if target_board is null then
    raise exception 'La columna no existe.';
  end if;

  if not public.user_can_edit_board(target_board) then
    raise exception 'No tienes permiso para mover tareas en este tablero.';
  end if;

  select count(*) into foreign_count
  from unnest(ordered_task_ids) as requested(task_id)
  left join public.tasks task on task.id = requested.task_id
  left join public.board_columns board_column on board_column.id = task.column_id
  where board_column.board_id is distinct from target_board;

  if foreign_count > 0 then
    raise exception 'Las tareas deben pertenecer al mismo tablero.';
  end if;

  update public.tasks task
  set column_id = target_column_id,
      position = ordered.ordinal - 1,
      updated_at = now()
  from unnest(ordered_task_ids) with ordinality as ordered(task_id, ordinal)
  where task.id = ordered.task_id
    and (task.column_id is distinct from target_column_id or task.position is distinct from ordered.ordinal - 1);
end;
$$;

revoke all on function public.reorder_column_tasks(uuid, uuid[]) from public;
grant execute on function public.reorder_column_tasks(uuid, uuid[]) to authenticated;

commit;
