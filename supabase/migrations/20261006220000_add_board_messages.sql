-- Mensajes y notificaciones por tablero.
-- Requiere 20261006200000 (task_comments).
--
-- No se crea una fila por destinatario y comentario (con equipos grandes eso
-- multiplica los datos). Cada persona guarda, por tablero, hasta cuándo leyó y
-- si silenció el tablero; los no leídos se calculan a partir de task_comments.

create table if not exists public.board_notification_settings (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  muted boolean not null default false,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

alter table public.board_notification_settings enable row level security;

-- Cada persona solo ve y modifica su propia configuración.
drop policy if exists "Users manage their own board notification settings" on public.board_notification_settings;
create policy "Users manage their own board notification settings"
  on public.board_notification_settings for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.user_can_access_board(board_id));

create index if not exists task_comments_created_at_idx
  on public.task_comments (created_at desc);

-- Desde cuándo cuentan los mensajes como no leídos: última lectura o, si nunca
-- leyó, desde que entró al tablero (para no marcar todo el historial como nuevo).
create or replace function public.board_read_baseline(target_board_id uuid, target_user_id uuid)
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select last_read_at from public.board_notification_settings
      where board_id = target_board_id and user_id = target_user_id),
    (select created_at from public.board_members
      where board_id = target_board_id and user_id = target_user_id),
    (select created_at from public.boards where id = target_board_id)
  );
$$;

-- No leídos y silenciado de cada tablero accesible.
create or replace function public.get_unread_message_counts()
returns table (board_id uuid, unread integer, muted boolean)
language sql stable security definer
set search_path = public
as $
  -- La fecha de referencia se calcula una vez por tablero, no por comentario.
  with my_boards as (
    select board.id,
      coalesce(settings.muted, false) as muted,
      coalesce(settings.last_read_at, member.created_at, board.created_at) as baseline
    from public.boards board
    left join public.board_members member
      on member.board_id = board.id and member.user_id = auth.uid()
    left join public.board_notification_settings settings
      on settings.board_id = board.id and settings.user_id = auth.uid()
    where board.owner_id = auth.uid() or member.user_id is not null
  )
  select my_boards.id,
    (
      select count(*)
      from public.task_comments comment
      join public.tasks task on task.id = comment.task_id
      join public.board_columns board_column on board_column.id = task.column_id
      where board_column.board_id = my_boards.id
        and comment.author_id <> auth.uid()
        and comment.created_at > my_boards.baseline
    )::integer,
    my_boards.muted
  from my_boards;
$;

-- Bandeja de mensajes de un tablero, del más reciente al más antiguo, paginada.
create or replace function public.get_board_messages(
  target_board_id uuid,
  before_created_at timestamptz default null,
  max_rows integer default 30
)
returns table (
  id uuid,
  task_id uuid,
  task_title text,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  kind text,
  body text,
  attachment_count integer,
  created_at timestamptz,
  is_unread boolean
)
language sql stable security definer
set search_path = public
as $$
  select comment.id, comment.task_id, task.title, comment.author_id,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    profile.avatar_url, comment.kind, comment.body,
    jsonb_array_length(comment.attachments), comment.created_at,
    comment.author_id <> auth.uid() and comment.created_at > reference.baseline
  from public.task_comments comment
  cross join (select public.board_read_baseline(target_board_id, auth.uid()) as baseline) reference
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  left join public.profiles profile on profile.id = comment.author_id
  where board_column.board_id = target_board_id
    and public.user_can_access_board(target_board_id)
    and (before_created_at is null or comment.created_at < before_created_at)
  order by comment.created_at desc
  limit least(greatest(coalesce(max_rows, 30), 1), 100);
$$;

-- Datos para el aviso de un comentario recién publicado (Realtime solo envía la fila).
create or replace function public.get_message_preview(target_comment_id uuid)
returns table (
  board_id uuid,
  board_name text,
  task_id uuid,
  task_title text,
  author_id uuid,
  author_name text,
  kind text,
  body text,
  muted boolean
)
language sql stable security definer
set search_path = public
as $$
  select board.id, board.name, task.id, task.title, comment.author_id,
    coalesce(nullif(trim(profile.display_name), ''), profile.username, 'Usuario'),
    comment.kind, comment.body,
    coalesce((select settings.muted from public.board_notification_settings settings
      where settings.board_id = board.id and settings.user_id = auth.uid()), false)
  from public.task_comments comment
  join public.tasks task on task.id = comment.task_id
  join public.board_columns board_column on board_column.id = task.column_id
  join public.boards board on board.id = board_column.board_id
  left join public.profiles profile on profile.id = comment.author_id
  where comment.id = target_comment_id
    and public.user_can_access_board(board.id);
$$;

create or replace function public.mark_board_messages_read(target_board_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_can_access_board(target_board_id) then
    raise exception 'No tienes acceso a este tablero.';
  end if;
  insert into public.board_notification_settings (board_id, user_id, last_read_at)
  values (target_board_id, auth.uid(), now())
  on conflict (board_id, user_id)
  do update set last_read_at = now(), updated_at = now();
end;
$$;

create or replace function public.set_board_notifications_muted(target_board_id uuid, is_muted boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.user_can_access_board(target_board_id) then
    raise exception 'No tienes acceso a este tablero.';
  end if;
  insert into public.board_notification_settings (board_id, user_id, muted)
  values (target_board_id, auth.uid(), is_muted)
  on conflict (board_id, user_id)
  do update set muted = excluded.muted, updated_at = now();
end;
$$;

revoke all on function public.board_read_baseline(uuid, uuid) from public;
revoke all on function public.get_unread_message_counts() from public;
grant execute on function public.get_unread_message_counts() to authenticated;
revoke all on function public.get_board_messages(uuid, timestamptz, integer) from public;
grant execute on function public.get_board_messages(uuid, timestamptz, integer) to authenticated;
revoke all on function public.get_message_preview(uuid) from public;
grant execute on function public.get_message_preview(uuid) to authenticated;
revoke all on function public.mark_board_messages_read(uuid) from public;
grant execute on function public.mark_board_messages_read(uuid) to authenticated;
revoke all on function public.set_board_notifications_muted(uuid, boolean) from public;
grant execute on function public.set_board_notifications_muted(uuid, boolean) to authenticated;
