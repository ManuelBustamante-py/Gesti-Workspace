-- Resumen ejecutivo de cada tablero para la lista «Mis tableros».
-- Requiere 20261006120000 (board_columns.status).
--
-- Devuelve, en una sola llamada, cuántas tareas tiene cada tablero accesible
-- por estado y fecha de fin. Los plazos (atrasadas, vencen pronto) se calculan
-- en el navegador con la fecha local del usuario.

create or replace function public.get_board_summaries()
returns table (board_id uuid, status text, end_date date, task_count integer)
language sql stable security definer
set search_path = public
as $$
  select board_column.board_id,
    coalesce(board_column.status, 'todo'),
    task.end_date,
    count(*)::integer
  from public.tasks task
  join public.board_columns board_column on board_column.id = task.column_id
  where public.user_can_access_board(board_column.board_id)
  group by board_column.board_id, coalesce(board_column.status, 'todo'), task.end_date;
$$;

revoke all on function public.get_board_summaries() from public;
grant execute on function public.get_board_summaries() to authenticated;
