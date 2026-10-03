-- This migration is intentionally defensive so it can be applied after a
-- partial setup without depending on migration execution order.
create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  unique (board_id, user_id)
);

create index if not exists board_members_board_id_idx
  on public.board_members (board_id);

alter table public.board_members enable row level security;

create table if not exists public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (board_id, email)
);

alter table public.board_invitations
  add column if not exists recipient_id uuid references auth.users(id) on delete cascade;

create index if not exists board_invitations_recipient_status_idx
  on public.board_invitations (recipient_id, status);

create or replace function public.get_received_board_invitations()
returns table (
  id uuid,
  board_id uuid,
  recipient_id uuid,
  email text,
  role text,
  status text,
  token uuid,
  created_at timestamptz,
  board_name text,
  board_color text
)
language sql
security definer
set search_path = public
as $$
  select invitation.id, invitation.board_id, invitation.recipient_id,
    invitation.email, invitation.role, invitation.status, invitation.token,
    invitation.created_at, board.name, board.color
  from public.board_invitations invitation
  join public.boards board on board.id = invitation.board_id
  where invitation.recipient_id = auth.uid()
    and invitation.status = 'pending'
  order by invitation.created_at desc;
$$;

drop policy if exists "Board recipients can view their invitations" on public.board_invitations;
create policy "Board recipients can view their invitations"
  on public.board_invitations for select to authenticated
  using (recipient_id = auth.uid());

create or replace function public.invite_board_member(
  target_board_id uuid,
  target_email text,
  target_role text
)
returns public.board_invitations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invitation public.board_invitations;
  recipient uuid;
  normalized_email text := lower(trim(target_email));
begin
  if not exists (
    select 1
    from public.boards
    where id = target_board_id
      and owner_id = auth.uid()
  ) then
    raise exception 'No tienes permiso para invitar colaboradores a este tablero.';
  end if;

  if normalized_email = '' or position('@' in normalized_email) = 0 then
    raise exception 'Indica un correo electrónico válido.';
  end if;

  if target_role not in ('viewer', 'editor') then
    raise exception 'El rol indicado no es válido.';
  end if;

  select id
    into recipient
    from auth.users
   where lower(email) = normalized_email
   limit 1;

  if recipient is null then
    raise exception 'No existe una cuenta registrada con ese correo.';
  end if;

  if recipient = auth.uid() then
    raise exception 'No puedes invitarte a ti mismo.';
  end if;

  insert into public.board_invitations (board_id, recipient_id, email, role, status)
  values (target_board_id, recipient, normalized_email, target_role, 'pending')
  on conflict (board_id, email)
  do update set
    recipient_id = excluded.recipient_id,
    role = excluded.role,
    status = 'pending',
    created_at = now()
  returning * into invitation;

  return invitation;
end;
$$;

create or replace function public.accept_board_invitation(invitation_id uuid)
returns public.board_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.board_invitations;
begin
  select *
    into invitation
    from public.board_invitations
   where id = invitation_id
     and recipient_id = auth.uid()
     and status = 'pending'
   for update;

  if invitation.id is null then
    raise exception 'La solicitud no existe o ya fue respondida.';
  end if;

  insert into public.board_members (board_id, user_id, role)
  values (invitation.board_id, auth.uid(), invitation.role)
  on conflict (board_id, user_id)
  do update set role = excluded.role;

  update public.board_invitations
     set status = 'accepted'
   where id = invitation.id
  returning * into invitation;

  return invitation;
end;
$$;

create or replace function public.decline_board_invitation(invitation_id uuid)
returns public.board_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.board_invitations;
begin
  update public.board_invitations
     set status = 'declined'
   where id = invitation_id
     and recipient_id = auth.uid()
     and status = 'pending'
  returning * into invitation;

  if invitation.id is null then
    raise exception 'La solicitud no existe o ya fue respondida.';
  end if;

  return invitation;
end;
$$;

revoke all on function public.invite_board_member(uuid, text, text) from public;
grant execute on function public.invite_board_member(uuid, text, text) to authenticated;
revoke all on function public.get_received_board_invitations() from public;
grant execute on function public.get_received_board_invitations() to authenticated;
revoke all on function public.accept_board_invitation(uuid) from public;
grant execute on function public.accept_board_invitation(uuid) to authenticated;
revoke all on function public.decline_board_invitation(uuid) from public;
grant execute on function public.decline_board_invitation(uuid) to authenticated;

create or replace function public.user_can_access_board(target_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.board_members
    where board_id = target_board_id and user_id = auth.uid()
  );
$$;

create or replace function public.user_can_edit_board(target_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boards
    where id = target_board_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.board_members
    where board_id = target_board_id
      and user_id = auth.uid()
      and role = 'editor'
  );
$$;

drop policy if exists "Board owners and members can view boards" on public.boards;
create policy "Board owners and members can view boards"
  on public.boards for select to authenticated
  using (public.user_can_access_board(id));

drop policy if exists "Owners can view board columns" on public.board_columns;
create policy "Owners and members can view board columns"
  on public.board_columns for select to authenticated
  using (public.user_can_access_board(board_id));

drop policy if exists "Owners can create board columns" on public.board_columns;
create policy "Owners and editors can create board columns"
  on public.board_columns for insert to authenticated
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Owners can update board columns" on public.board_columns;
create policy "Owners and editors can update board columns"
  on public.board_columns for update to authenticated
  using (public.user_can_edit_board(board_id))
  with check (public.user_can_edit_board(board_id));

drop policy if exists "Owners can delete board columns" on public.board_columns;
create policy "Owners and editors can delete board columns"
  on public.board_columns for delete to authenticated
  using (public.user_can_edit_board(board_id));

drop policy if exists "Owners can view tasks" on public.tasks;
create policy "Owners and members can view tasks"
  on public.tasks for select to authenticated
  using (public.user_can_access_column(column_id));

drop policy if exists "Owners can create tasks" on public.tasks;
create policy "Owners and editors can create tasks"
  on public.tasks for insert to authenticated
  with check (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));

drop policy if exists "Owners can update tasks" on public.tasks;
create policy "Owners and editors can update tasks"
  on public.tasks for update to authenticated
  using (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)))
  with check (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));

drop policy if exists "Owners can delete tasks" on public.tasks;
create policy "Owners and editors can delete tasks"
  on public.tasks for delete to authenticated
  using (public.user_can_edit_board((select board_id from public.board_columns where id = column_id)));
