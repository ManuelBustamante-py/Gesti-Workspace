alter table public.boards
  add column if not exists working_days integer[] not null default '{1,2,3,4,5,6,7}',
  add column if not exists work_start_time time not null default '08:00',
  add column if not exists work_end_time time not null default '17:00';

alter table public.boards
  drop constraint if exists boards_working_days_check;

alter table public.boards
  add constraint boards_working_days_check
  check (
    cardinality(working_days) > 0
    and working_days <@ array[1, 2, 3, 4, 5, 6, 7]
    and work_start_time < work_end_time
  );
