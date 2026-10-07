-- Fecha de finalización confirmada de las tareas.
-- Requiere 20261007120000 (column_status_of).
--
-- Una tarea en una columna «Completado» puede marcarse como completada con la
-- fecha real en que se terminó. El diagrama de flujo acumulado usa esa fecha
-- (en vez del momento en que se movió la tarjeta) para medir la velocidad.

alter table public.tasks
  add column if not exists completed_at date;

-- Solo las tareas en una columna de estado «Completado» pueden tener fecha de
-- finalización: al moverlas fuera (reabrirlas) se borra.
create or replace function public.clear_completion_when_reopened()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.completed_at is not null and public.column_status_of(new.column_id) <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_clear_completion on public.tasks;
create trigger tasks_clear_completion
  before insert or update of column_id, completed_at on public.tasks
  for each row execute function public.clear_completion_when_reopened();

-- Cambiar una columna a un estado distinto de «Completado» reabre sus tareas.
create or replace function public.clear_completion_on_column_status()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and coalesce(new.status, 'todo') <> 'done' then
    update public.tasks set completed_at = null
    where column_id = new.id and completed_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists board_columns_clear_completion on public.board_columns;
create trigger board_columns_clear_completion
  after update of status on public.board_columns
  for each row execute function public.clear_completion_on_column_status();

-- «Haciendo» y similares no se reconocían como «En progreso» al crear la columna
-- de estado: se corrigen las columnas que quedaron como pendientes.
update public.board_columns
set status = 'in_progress'
where status = 'todo'
  and lower(name) ~ '(haciendo|en curso|wip|desarrollo|trabajando)';
