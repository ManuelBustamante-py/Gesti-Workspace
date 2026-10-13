-- Esfuerzo (puntos de historia) de cada tarea.
--
-- El diagrama de flujo acumulado y el burndown pueden medir el trabajo en
-- puntos en vez de contar tareas: así una tarea de 13 puntos pesa más que una
-- de 1 al calcular la velocidad, lo restante y la proyección de entrega.
-- Es opcional: una tarea sin estimar (null) se pondera con el promedio de las
-- estimadas del tablero.

alter table public.tasks
  add column if not exists effort numeric(4, 1);

alter table public.tasks
  drop constraint if exists tasks_effort_range;

alter table public.tasks
  add constraint tasks_effort_range check (effort is null or (effort > 0 and effort <= 100));
