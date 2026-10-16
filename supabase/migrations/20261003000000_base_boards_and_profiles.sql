-- Esquema base: tableros y perfiles.
--
-- Estas dos tablas se crearon en el panel de Supabase antes de que existieran
-- las migraciones, por lo que el resto del esquema las daba por supuestas y no
-- era posible recrear la base desde cero. Este archivo las define.
--
-- Es seguro en una base ya existente: cada tabla (con su RLS, sus políticas y
-- su trigger) solo se crea si todavía no existe; si ya está, no se toca nada.
-- Las políticas de lectura de tableros compartidos y las columnas posteriores
-- (jornada, fechas, portada…) las añaden las migraciones siguientes.

do $base$
begin
  if to_regclass('public.profiles') is null then
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      username text,
      display_name text,
      first_name text,
      last_name text,
      avatar_url text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table public.profiles enable row level security;

    -- Los nombres de colaboradores se leen mediante funciones security definer:
    -- cada persona solo accede directamente a su propio perfil.
    create policy "Users can view their own profile"
      on public.profiles for select to authenticated
      using (id = auth.uid());

    create policy "Users can update their own profile"
      on public.profiles for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());

    -- Perfil inicial a partir de los datos del registro (correo u OAuth).
    create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    begin
      insert into public.profiles (id, username, display_name, first_name, last_name, avatar_url)
      values (
        new.id,
        coalesce(meta->>'username', split_part(new.email, '@', 1)),
        coalesce(meta->>'display_name', meta->>'full_name', meta->>'name'),
        coalesce(meta->>'first_name', meta->>'given_name'),
        coalesce(meta->>'last_name', meta->>'family_name'),
        meta->>'avatar_url'
      )
      on conflict (id) do nothing;
      return new;
    end;
    $fn$;

    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;

  if to_regclass('public.boards') is null then
    create table public.boards (
      id uuid primary key default gen_random_uuid(),
      name text not null check (char_length(trim(name)) between 1 and 120),
      description text,
      color text not null default '#64748b',
      owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index boards_owner_id_idx on public.boards (owner_id);

    alter table public.boards enable row level security;

    -- Lectura para el propietario; 20261003133000 la amplía a los miembros.
    create policy "Board owners and members can view boards"
      on public.boards for select to authenticated
      using (owner_id = auth.uid());

    create policy "Users can create their own boards"
      on public.boards for insert to authenticated
      with check (owner_id = auth.uid());

    create policy "Owners can update their boards"
      on public.boards for update to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid());

    create policy "Owners can delete their boards"
      on public.boards for delete to authenticated
      using (owner_id = auth.uid());
  end if;
end;
$base$;
