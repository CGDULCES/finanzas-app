-- Agrega la función que faltaba para poder borrar categorías desde la app.
-- Ejecutar una sola vez en el SQL Editor de Supabase.

create or replace function delete_category(p_token uuid, p_section text, p_category_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  delete from categories where id = p_category_id and section_key = p_section;
end;
$$;
