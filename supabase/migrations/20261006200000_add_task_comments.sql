-- Comentarios de tareas con imágenes adjuntas.
-- Requiere 20261006120000 (user_is_board_owner) y 20261006180000 (task_board_id).
--
-- Las imágenes no se guardan en la base de datos: van al bucket privado
-- «task-attachments» de Supabase Storage, ya comprimidas a WebP (o JPEG si el
-- navegador no puede generar WebP) en el cliente. Aquí solo se guarda la ruta.
-- Ruta de cada archivo: {board_id}/{task_id}/{author_id}/{uuid}.webp

-- 1. Comentarios ----------------------------------------------------------

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null default 'comment' check (kind in ('comment', 'issue', 'workaround')),
  body text not null default '' check (char_length(body) <= 4000),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_attachments_check check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4
  ),
  constraint task_comments_not_empty_check check (
    char_length(trim(body)) > 0 or jsonb_array_length(attachments) > 0
  )
);

create index if not exists task_comments_task_id_created_idx
  on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;

drop policy if exists "Board participants can read comments" on public.task_comments;
create policy "Board participants can read comments"
  on public.task_comments for select to authenticated
  using (public.user_can_access_board(public.task_board_id(task_id)));

-- Propietario y editores comentan; los lectores no.
drop policy if exists "Editors can comment" on public.task_comments;
create policy "Editors can comment"
  on public.task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_edit_board(public.task_board_id(task_id))
  );

drop policy if exists "Authors can edit their comments" on public.task_comments;
create policy "Authors can edit their comments"
  on public.task_comments for update to authenticated
  using (author_id = auth.uid() and public.user_can_edit_board(public.task_board_id(task_id)))
  with check (author_id = auth.uid() and public.user_can_edit_board(public.task_board_id(task_id)));

-- El autor borra lo suyo; el propietario puede moderar cualquier comentario.
drop policy if exists "Authors and owners can delete comments" on public.task_comments;
create policy "Authors and owners can delete comments"
  on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or public.user_is_board_owner(public.task_board_id(task_id)));

create or replace function public.validate_task_comment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  expected_prefix text;
  invalid_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.task_id <> old.task_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
      raise exception 'Solo se puede modificar el texto y el tipo del comentario.';
    end if;
    -- Los adjuntos no se editan: para cambiarlos se publica otro comentario.
    new.attachments := old.attachments;
    new.updated_at := now();
    return new;
  end if;

  -- Cada adjunto debe estar en la carpeta del autor dentro de esa tarea.
  expected_prefix := public.task_board_id(new.task_id)::text || '/' || new.task_id::text || '/' || new.author_id::text || '/';
  select count(*) into invalid_count
  from jsonb_array_elements(new.attachments) as attachment
  where jsonb_typeof(attachment -> 'path') is distinct from 'string'
     or left(attachment ->> 'path', length(expected_prefix)) <> expected_prefix;

  if invalid_count > 0 then
    raise exception 'Los adjuntos deben pertenecer a la tarea comentada.';
  end if;

  return new;
end;
$$;

drop trigger if exists task_comments_validate on public.task_comments;
create trigger task_comments_validate
  before insert or update on public.task_comments
  for each row execute function public.validate_task_comment();

-- Comentarios con el nombre del autor, aunque ya no pertenezca al tablero.
create or replace function public.get_task_comments(target_task_id uuid)
returns table (
  id uuid,
  task_id uuid,
  author_id uuid,
  kind text,
  body text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  author_name text,
  author_username text,
  author_avatar_url text
)
language sql stable security definer
set search_path = public
as $$
  select comment.id, comment.task_id, comment.author_id, comment.kind, comment.body,
    comment.attachments, comment.created_at, comment.updated_at,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    profile.username, profile.avatar_url
  from public.task_comments comment
  left join public.profiles profile on profile.id = comment.author_id
  where comment.task_id = target_task_id
    and public.user_can_access_board(public.task_board_id(target_task_id))
  order by comment.created_at;
$$;

-- Totales por tarea para las tarjetas: comentarios y avisos (problemas o parches).
create or replace function public.get_board_comment_stats(target_board_id uuid)
returns table (task_id uuid, total integer, alerts integer)
language sql stable security definer
set search_path = public
as $$
  select comment.task_id,
    count(*)::integer,
    count(*) filter (where comment.kind in ('issue', 'workaround'))::integer
  from public.task_comments comment
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  where board_column.board_id = target_board_id
    and public.user_can_access_board(target_board_id)
  group by comment.task_id;
$$;

revoke all on function public.get_task_comments(uuid) from public;
grant execute on function public.get_task_comments(uuid) to authenticated;
revoke all on function public.get_board_comment_stats(uuid) from public;
grant execute on function public.get_board_comment_stats(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null;
end;
$$;

-- 2. Almacenamiento de imágenes ---------------------------------------------

-- Bucket privado: máximo 1 MB por archivo y solo formatos comprimidos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "Board participants can view task attachments" on storage.objects;
create policy "Board participants can view task attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.user_can_access_board(public.try_uuid((storage.foldername(name))[1]))
  );

-- Solo editores suben, y solo dentro de su propia carpeta de autor.
drop policy if exists "Editors can upload task attachments" on storage.objects;
create policy "Editors can upload task attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.user_can_edit_board(public.try_uuid((storage.foldername(name))[1]))
    and public.task_board_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
    and (storage.foldername(name))[3] = auth.uid()::text
  );

drop policy if exists "Authors and owners can delete task attachments" on storage.objects;
create policy "Authors and owners can delete task attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
      (storage.foldername(name))[3] = auth.uid()::text
      or public.user_is_board_owner(public.try_uuid((storage.foldername(name))[1]))
    )
  );

-- Nota: al borrar una tarea o un tablero en cascada, los comentarios se
-- eliminan, pero los archivos de Storage no (Supabase no permite borrarlos
-- desde SQL). La aplicación borra las imágenes al eliminar un comentario; para
-- tareas y tableros eliminados queda pendiente una limpieza periódica.
