-- Configuración de la evaluación de coherencia arquitectónica por tablero.
-- Requiere 20261003133000 (user_can_access_board, user_can_edit_board).
--
-- settings guarda el estilo declarado (p. ej. MVC y sus dependencias
-- prohibidas), los diagramas con contrato completo, los componentes lógicos,
-- las equivalencias validadas y las excepciones justificadas. El análisis se
-- calcula en el navegador a partir de board_diagrams: aquí no se guardan
-- resultados.
-- Permisos como los diagramas: quien ve el tablero la lee; quien puede
-- editarlo (propietario o editor) la crea y la modifica.

create table if not exists public.board_architecture_settings (
  board_id uuid primary key references public.boards(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 200000),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.board_architecture_settings enable row level security;

drop policy if exists "Board participants can view architecture settings" on public.board_architecture_settings;
create policy "Board participants can view architecture settings"
  on public.board_architecture_settings for select to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Editors can create architecture settings" on public.board_architecture_settings;
create policy "Editors can create architecture settings"
  on public.board_architecture_settings for insert to authenticated
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Editors can update architecture settings" on public.board_architecture_settings;
create policy "Editors can update architecture settings"
  on public.board_architecture_settings for update to authenticated
  using (public.user_can_edit_board(board_id))
  with check (public.user_can_edit_board(board_id));

-- Quién y cuándo modificó lo fija el servidor; el tablero no cambia.
create or replace function public.touch_board_architecture_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.board_id := old.board_id;
  end if;
  return new;
end;
$$;

drop trigger if exists board_architecture_settings_touch on public.board_architecture_settings;
create trigger board_architecture_settings_touch
  before insert or update on public.board_architecture_settings
  for each row execute function public.touch_board_architecture_settings();
