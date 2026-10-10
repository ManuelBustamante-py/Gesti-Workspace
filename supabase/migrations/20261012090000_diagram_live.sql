-- Colaboración en vivo de diagramas (Supabase Realtime, canales privados).
-- Requiere 20261011090000 (board_diagrams).
--
-- Cada diagrama usa el canal privado «diagram:<id>». Solo pueden escucharlo
-- quienes ven el tablero; solo quienes lo editan pueden enviar cambios
-- (broadcast). La presencia (quién está conectado) la publica cualquier
-- participante, también los lectores.

create or replace function public.diagram_channel_board(topic text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select diagram.board_id
  from public.board_diagrams diagram
  where topic like 'diagram:%'
    and diagram.id::text = substring(topic from 9);
$$;

revoke all on function public.diagram_channel_board(text) from public;
grant execute on function public.diagram_channel_board(text) to authenticated;

drop policy if exists "Board participants can listen to diagram channels" on realtime.messages;
create policy "Board participants can listen to diagram channels"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'diagram:%'
    and public.user_can_access_board(public.diagram_channel_board(realtime.topic()))
  );

drop policy if exists "Board participants can publish diagram presence and edits" on realtime.messages;
create policy "Board participants can publish diagram presence and edits"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'diagram:%'
    and (
      (realtime.messages.extension = 'presence' and public.user_can_access_board(public.diagram_channel_board(realtime.topic())))
      or (realtime.messages.extension = 'broadcast' and public.user_can_edit_board(public.diagram_channel_board(realtime.topic())))
    )
  );
