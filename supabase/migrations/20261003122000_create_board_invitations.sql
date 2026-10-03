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

alter table public.board_invitations enable row level security;

drop policy if exists "Board owners can manage invitations" on public.board_invitations;
create policy "Board owners can manage invitations"
  on public.board_invitations for all to authenticated
  using (public.user_can_access_board(board_id))
  with check (public.user_can_access_board(board_id));

create index if not exists board_invitations_email_idx
  on public.board_invitations (email, status);
