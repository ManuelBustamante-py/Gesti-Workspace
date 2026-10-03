alter table public.tasks
  add column if not exists priority text not null default 'medium',
  add column if not exists due_date date;

alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority in ('low', 'medium', 'high'));
