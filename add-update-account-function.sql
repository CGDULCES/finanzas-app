-- Agrega la función que faltaba para poder editar cuentas desde la app.
-- Ejecutar una sola vez en el SQL Editor de Supabase.

create or replace function update_account(p_token uuid, p_section text, p_account_id uuid, p_name text, p_type text, p_initial numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v_row accounts;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  update accounts set name = p_name, type = p_type, initial_balance = p_initial
    where id = p_account_id and section_key = p_section
    returning * into v_row;
  return row_to_json(v_row);
end;
$$;
