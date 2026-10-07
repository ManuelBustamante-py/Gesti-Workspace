-- Menos carga en la base de datos: Realtime filtrado por tablero, resumen de
-- tableros sin funciones por fila e índices para «mis tableros».
-- Requiere 20261006200000 (task_comments) y 20261007200000 (get_board_summaries).
--
-- tasks, task_comments y task_assignees reciben board_id, que mantienen los
-- triggers (lo que envíe el cliente se ignora). Con él, las suscripciones
-- Realtime se filtran en el servidor: por cada cambio, Realtime solo evalúa RLS
-- para quienes miran ese tablero, no para todos los usuarios conectados.

-- 1. tasks.board_id ---------------------------------------------------------

alter table public.tasks
  add column if not exists board_id uuid;

update public.tasks task
set board_id = board_column.board_id
from public.board_columns board_column
where board_column.id = task.column_id
  and task.board_id is distinct from board_column.board_id;

alter table public.tasks
  alter column board_id set not null;

create index if not exists tasks_board_id_idx
  on public.tasks (board_id);

create or replace function public.set_task_board_id()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select board_id into new.board_id from public.board_columns where id = new.column_id;
  -- Los comentarios y responsables copian el tablero de la tarea: si la tarea
  -- cambiara de tablero quedarían desfasados. La aplicación nunca lo hace.
  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id then
    raise exception 'Una tarea no puede moverse a otro tablero.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_board_id on public.tasks;
create trigger tasks_set_board_id
  before insert or update of column_id, board_id on public.tasks
  for each row execute function public.set_task_board_id();

-- 2. board_id de comentarios y responsables ----------------------------------

alter table public.task_comments
  add column if not exists board_id uuid;

update public.task_comments comment
set board_id = task.board_id
from public.tasks task
where task.id = comment.task_id
  and comment.board_id is distinct from task.board_id;

alter table public.task_comments
  alter column board_id set not null;

create index if not exists task_comments_board_id_created_idx
  on public.task_comments (board_id, created_at);

alter table public.task_assignees
  add column if not exists board_id uuid;

update public.task_assignees assignee
set board_id = task.board_id
from public.tasks task
where task.id = assignee.task_id
  and assignee.board_id is distinct from task.board_id;

alter table public.task_assignees
  alter column board_id set not null;

create index if not exists task_assignees_board_id_idx
  on public.task_assignees (board_id);

-- task_id no cambia en comentarios ni responsables: basta con copiarlo al
-- insertar y conservarlo en cada actualización.
create or replace function public.set_board_id_from_task()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.board_id := old.board_id;
  else
    new.board_id := public.task_board_id(new.task_id);
  end if;
  return new;
end;
$$;

drop trigger if exists task_comments_set_board_id on public.task_comments;
create trigger task_comments_set_board_id
  before insert or update of board_id on public.task_comments
  for each row execute function public.set_board_id_from_task();

drop trigger if exists task_assignees_set_board_id on public.task_assignees;
create trigger task_assignees_set_board_id
  before insert or update of board_id on public.task_assignees
  for each row execute function public.set_board_id_from_task();

-- 3. Resumen de tableros ------------------------------------------------------
-- Antes se llamaba a user_can_access_board() una vez por tarea. Ahora se
-- obtienen primero los tableros accesibles y se cuentan solo sus tareas.

create or replace function public.get_board_summaries()
returns table (board_id uuid, status text, end_date date, task_count integer)
language sql stable security definer
set search_path = public
as $$
  with accessible (id) as (
    select board.id from public.boards board where board.owner_id = auth.uid()
    union
    select member.board_id from public.board_members member where member.user_id = auth.uid()
  )
  select task.board_id,
    coalesce(board_column.status, 'todo'),
    task.end_date,
    count(*)::integer
  from accessible
  join public.tasks task on task.board_id = accessible.id
  join public.board_columns board_column on board_column.id = task.column_id
  group by task.board_id, coalesce(board_column.status, 'todo'), task.end_date;
$$;

revoke all on function public.get_board_summaries() from public;
grant execute on function public.get_board_summaries() to authenticated;

-- 4. Índices para «mis tableros» ----------------------------------------------
-- Las políticas de boards y board_members buscan por owner_id y user_id.

-- boards se creó fuera de las migraciones: solo se indexa si aún no hay un
-- índice que empiece por owner_id.
do $$
begin
  if not exists (
    select 1
    from pg_index board_index
    join pg_attribute attribute
      on attribute.attrelid = board_index.indrelid
     and attribute.attnum = board_index.indkey[0]
    where board_index.indrelid = 'public.boards'::regclass
      and attribute.attname = 'owner_id'
  ) then
    create index boards_owner_id_idx on public.boards (owner_id);
  end if;
end;
$$;

create index if not exists board_members_user_id_idx
  on public.board_members (user_id);

-- unique (board_id, user_id) ya cubre las búsquedas por board_id.
drop index if exists public.board_members_board_id_idx;
