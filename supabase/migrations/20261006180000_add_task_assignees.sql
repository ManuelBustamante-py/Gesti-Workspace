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
