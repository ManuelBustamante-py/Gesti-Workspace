alter table public.tasks
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.tasks
  add column if not exists predecessor_ids uuid[] not null default '{}';

update public.tasks
set end_date = due_date
where end_date is null and due_date is not null;

alter table public.tasks
  drop constraint if exists tasks_schedule_dates_check;

alter table public.tasks
  add constraint tasks_schedule_dates_check
  check (start_date is null or end_date is null or start_date <= end_date);
