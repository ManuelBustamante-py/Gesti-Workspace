-- Historial de estados de las tareas para el Diagrama de Flujo Acumulado (CFD).
-- Requiere 20261006120000 (board_columns.status).
--
-- Cada vez que una tarea se crea, cambia de estado (al moverla de columna o al
-- cambiar el estado de su columna) o se elimina, se registra un evento. El CFD
-- reconstruye con ellos cuántas tareas había en cada estado cada día.
--
-- board_id no tiene clave foránea a propósito: al borrar un tablero en cascada,
-- los triggers de las tareas aún deben poder registrar su baja. Los eventos de un
-- tablero eliminado se borran con el trigger de boards.

create table if not exists public.task_status_events (
  id bigint generated always as identity primary key,
  board_id uuid not null,
  task_id uuid not null,
  status text not null check (status in ('todo', 'in_progress', 'done', 'removed')),
  occurred_at timestamptz not null default now()
);

create index if not exists task_status_events_board_time_idx
  on public.task_status_events (board_id, occurred_at);
create index if not exists task_status_events_task_idx
  on public.task_status_events (task_id, id desc);

alter table public.task_status_events enable row level security;

-- Solo lectura para participantes; los eventos los escriben los triggers.
drop policy if exists "Board participants can read status history" on public.task_status_events;
create policy "Board participants can read status history"
  on public.task_status_events for select to authenticated
  using (public.user_can_access_board(board_id));

create or replace function public.column_status_of(target_column_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(status, 'todo') from public.board_columns where id = target_column_id;
$$;

create or replace function public.record_task_status_event()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target_board uuid;
  previous_status text;
  next_status text;
begin
  if tg_op = 'INSERT' then
    select board_id into target_board from public.board_columns where id = new.column_id;
    insert into public.task_status_events (board_id, task_id, status)
    values (target_board, new.id, public.column_status_of(new.column_id));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    previous_status := public.column_status_of(old.column_id);
    next_status := public.column_status_of(new.column_id);
    if next_status is distinct from previous_status then
      select board_id into target_board from public.board_columns where id = new.column_id;
      insert into public.task_status_events (board_id, task_id, status)
      values (target_board, new.id, next_status);
    end if;
    return new;
  end if;

  -- DELETE: la columna puede haberse borrado ya (borrado en cascada); el tablero
  -- se toma del último evento de la tarea.
  select board_id into target_board
  from public.task_status_events
  where task_id = old.id
  order by id desc
  limit 1;
  if target_board is not null then
    insert into public.task_status_events (board_id, task_id, status)
    values (target_board, old.id, 'removed');
  end if;
  return old;
end;
$$;

drop trigger if exists tasks_record_status_insert on public.tasks;
create trigger tasks_record_status_insert
  after insert on public.tasks
  for each row execute function public.record_task_status_event();

drop trigger if exists tasks_record_status_update on public.tasks;
create trigger tasks_record_status_update
  after update of column_id on public.tasks
  for each row execute function public.record_task_status_event();

drop trigger if exists tasks_record_status_delete on public.tasks;
create trigger tasks_record_status_delete
  after delete on public.tasks
  for each row execute function public.record_task_status_event();

-- Cambiar el estado de una columna cambia el estado de todas sus tareas.
create or replace function public.record_column_status_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.task_status_events (board_id, task_id, status)
    select new.board_id, task.id, coalesce(new.status, 'todo')
    from public.tasks task
    where task.column_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists board_columns_record_status_change on public.board_columns;
create trigger board_columns_record_status_change
  after update of status on public.board_columns
  for each row execute function public.record_column_status_change();

create or replace function public.remove_board_status_history()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.task_status_events where board_id = old.id;
  return old;
end;
$$;

drop trigger if exists boards_remove_status_history on public.boards;
create trigger boards_remove_status_history
  after delete on public.boards
  for each row execute function public.remove_board_status_history();

-- Historial inicial APROXIMADO para las tareas que ya existían: se asume que
-- entraron como pendientes al crearse y que llegaron a su estado actual en su
-- última actualización. Desde ahora el historial es exacto.
insert into public.task_status_events (board_id, task_id, status, occurred_at)
select board_column.board_id, task.id, 'todo', task.created_at
from public.tasks task
join public.board_columns board_column on board_column.id = task.column_id
where not exists (select 1 from public.task_status_events event where event.task_id = task.id);

insert into public.task_status_events (board_id, task_id, status, occurred_at)
select board_column.board_id, task.id, coalesce(board_column.status, 'todo'), greatest(task.updated_at, task.created_at)
from public.tasks task
join public.board_columns board_column on board_column.id = task.column_id
where coalesce(board_column.status, 'todo') <> 'todo'
  and (select count(*) from public.task_status_events event where event.task_id = task.id) = 1;

do $$
begin
  alter publication supabase_realtime add table public.task_status_events;
exception when duplicate_object then null;
end;
$$;
