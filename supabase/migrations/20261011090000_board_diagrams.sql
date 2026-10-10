-- Diagramas UML (y otros) asociados a cada tablero.
-- Requiere 20261003133000 (user_can_access_board, user_can_edit_board).
--
-- mode = 'code': el diagrama es texto PlantUML (source), dibujado en el
--   navegador con @plantuml/core.
-- mode = 'visual': editor de arrastrar y soltar (fase 2); el modelo va en
--   model y source guarda el PlantUML generado a partir de él.
-- Permisos como las tareas: quien ve el tablero ve sus diagramas; quien puede
-- editarlo (propietario o editor) los crea, modifica y elimina.

create table if not exists public.board_diagrams (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  kind text not null check (kind ~ '^[a-z0-9-]{1,40}$'),
  mode text not null default 'code' check (mode in ('code', 'visual')),
  source text not null default '' check (char_length(source) <= 200000),
  model jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_diagrams_board_updated_idx
  on public.board_diagrams (board_id, updated_at desc);

alter table public.board_diagrams enable row level security;

drop policy if exists "Board participants can view diagrams" on public.board_diagrams;
create policy "Board participants can view diagrams"
  on public.board_diagrams for select to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Editors can create diagrams" on public.board_diagrams;
create policy "Editors can create diagrams"
  on public.board_diagrams for insert to authenticated
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Editors can update diagrams" on public.board_diagrams;
create policy "Editors can update diagrams"
  on public.board_diagrams for update to authenticated
  using (public.user_can_edit_board(board_id))
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Editors can delete diagrams" on public.board_diagrams;
create policy "Editors can delete diagrams"
  on public.board_diagrams for delete to authenticated
  using (public.user_can_edit_board(board_id));

-- Quién y cuándo modificó por última vez lo fija el servidor, no el cliente;
-- el tablero de un diagrama no cambia.
create or replace function public.touch_board_diagram()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.board_id := old.board_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists board_diagrams_touch on public.board_diagrams;
create trigger board_diagrams_touch
  before insert or update on public.board_diagrams
  for each row execute function public.touch_board_diagram();
