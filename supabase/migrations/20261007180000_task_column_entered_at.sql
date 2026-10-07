-- «En esta columna desde»: fecha real en que una tarea entró a su columna actual.
-- Requiere 20261007150000 (completed_at y column_status_of).
--
-- Al mover tarjetas, el historial registra el momento del movimiento. Si se
-- mueven varias el mismo día (por ejemplo al poner al día el tablero), el
-- diagrama de flujo acumulado cree que todo ocurrió ese día. Con esta fecha se
-- indica cuándo empezó de verdad. En las columnas «Completado» se usa
-- completed_at («Completada el»).

alter table public.tasks
  add column if not exists column_entered_at date;

create or replace function public.reset_column_entered_at()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Al cambiar de columna la fecha deja de ser cierta (salvo que se envíe una nueva).
  if tg_op = 'UPDATE'
     and new.column_id is distinct from old.column_id
     and new.column_entered_at is not distinct from old.column_entered_at then
    new.column_entered_at := null;
  end if;
  -- En columnas «Completado» la fecha relevante es completed_at.
  if new.column_entered_at is not null and public.column_status_of(new.column_id) = 'done' then
    new.column_entered_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_column_entered_at on public.tasks;
create trigger tasks_reset_column_entered_at
  before insert or update of column_id, column_entered_at on public.tasks
  for each row execute function public.reset_column_entered_at();
