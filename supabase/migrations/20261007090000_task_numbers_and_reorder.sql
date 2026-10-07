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
