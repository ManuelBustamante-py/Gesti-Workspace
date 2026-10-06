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
