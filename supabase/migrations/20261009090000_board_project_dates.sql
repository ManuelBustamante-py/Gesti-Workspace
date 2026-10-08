-- Fechas del proyecto por tablero: inicio y fin comprometido.
-- Requiere 20261008090000 (tasks.board_id), 20261006120000 (user_is_board_owner)
-- y 20261007120000 (column_status_of).
--
-- El fin comprometido es la meta contra la que se miden el flujo acumulado, el
-- Gantt y el resumen del tablero. Si está vacío se usa, como antes, la fecha de
-- fin más tardía de las tareas.

alter table public.boards
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.boards
  drop constraint if exists boards_project_dates_check;

alter table public.boards
  add constraint boards_project_dates_check
  check (start_date is null or end_date is null or start_date <= end_date);

-- Guarda las fechas del proyecto y, en la misma transacción, las nuevas fechas
-- de las tareas reprogramadas. El desplazamiento por días hábiles se calcula en
-- el cliente con la jornada del tablero; aquí se valida y se aplica todo o nada.
-- Solo el propietario. Las tareas de columnas Completado no se tocan: sus
-- fechas son historial real.
create or replace function public.reschedule_board(
  target_board_id uuid,
  new_start date,
  new_end date,
  task_dates jsonb default '[]'::jsonb
)
returns setof public.boards
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_is_board_owner(target_board_id) then
    raise exception 'Solo el propietario puede cambiar las fechas del proyecto.';
  end if;
  if new_start is not null and new_end is not null and new_start > new_end then
    raise exception 'El inicio del proyecto no puede ser posterior al fin.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(task_dates) as item
    where (item ->> 'start_date')::date > (item ->> 'end_date')::date
  ) then
    raise exception 'Una tarea quedaría con inicio posterior a su fin.';
  end if;

  update public.tasks task
  set start_date = (item ->> 'start_date')::date,
      end_date = (item ->> 'end_date')::date,
      updated_at = now()
  from jsonb_array_elements(task_dates) as item
  where task.id = (item ->> 'id')::uuid
    and task.board_id = target_board_id
    and public.column_status_of(task.column_id) <> 'done';

  return query
  update public.boards
  set start_date = new_start,
      end_date = new_end,
      updated_at = now()
  where id = target_board_id
  returning *;
end;
$$;

revoke all on function public.reschedule_board(uuid, date, date, jsonb) from public;
grant execute on function public.reschedule_board(uuid, date, date, jsonb) to authenticated;
