-- Imagen de fondo opcional por tablero (URL externa).
--
-- Solo se guarda la dirección: la imagen no se sube a Storage. Se exige https
-- para evitar contenido mixto y direcciones como javascript: o data:.

alter table public.boards
  add column if not exists cover_url text;

alter table public.boards
  drop constraint if exists boards_cover_url_check;

alter table public.boards
  add constraint boards_cover_url_check
  check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 2048));
