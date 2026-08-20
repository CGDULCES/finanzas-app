-- =====================================================================
-- FINANZAS: esquema para Supabase
-- Ejecutar completo en el SQL Editor de tu proyecto Supabase.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABLAS
-- ---------------------------------------------------------------------

create table if not exists sections (
  key text primary key,              -- 'daniel', 'pareja', 'compartido'
  name text not null,
  password_hash text not null
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  name text not null,
  type text not null check (type in ('efectivo','banco','ahorro')),
  initial_balance numeric not null default 0,
  currency text not null default 'PYG',
  archived boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  name text not null,
  type text not null check (type in ('ingreso','gasto')),
  color text not null default '#2F5D50',
  unique (section_key, name, type)
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  type text not null check (type in ('ingreso','gasto')),
  amount numeric not null check (amount > 0),
  description text,
  txn_date date not null default current_date,
  created_at timestamptz default now()
);

create table if not exists savings_goals (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  deadline date,
  created_at timestamptz default now()
);

create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  section_key text not null references sections(key) on delete cascade,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------
-- SEGURIDAD: se bloquea el acceso directo a las tablas.
-- Nadie puede leer/escribir con la anon key salvo a traves de las
-- funciones de abajo, que exigen contrasena (login) o un token de
-- sesion valido. Esto evita que alguien con la URL y la anon key del
-- proyecto (visibles en el codigo del sitio) lea los datos sin pasar
-- por la pantalla de contrasena.
-- ---------------------------------------------------------------------

alter table sections enable row level security;
alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table savings_goals enable row level security;
alter table sessions enable row level security;
-- No se crean policies: sin ellas, RLS deniega todo acceso directo.
-- Las funciones "security definer" de abajo son las unicas que pueden
-- leer o escribir, porque corren con los permisos del dueno (no del
-- rol anon que usa el navegador).

-- ---------------------------------------------------------------------
-- FUNCIONES
-- ---------------------------------------------------------------------

-- Valida que un token de sesion sea real y no haya expirado
create or replace function _valid_session(p_token uuid, p_section text)
returns boolean
language sql security definer set search_path = public as $$
  select exists(
    select 1 from sessions
    where token = p_token and section_key = p_section and expires_at > now()
  );
$$;

-- Login: compara la contrasena contra el hash guardado y devuelve un
-- token de sesion valido por 24 horas si coincide.
create or replace function login(p_section text, p_password text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_token uuid;
begin
  select password_hash into v_hash from sections where key = p_section;
  if v_hash is null then
    return null;
  end if;
  if crypt(p_password, v_hash) = v_hash then
    delete from sessions where section_key = p_section and expires_at < now();
    insert into sessions(section_key, expires_at)
      values (p_section, now() + interval '24 hours')
      returning token into v_token;
    return v_token;
  else
    return null;
  end if;
end;
$$;

-- Cierra sesion (borra el token)
create or replace function logout(p_token uuid)
returns void
language sql security definer set search_path = public as $$
  delete from sessions where token = p_token;
$$;

-- Cambia la contrasena de una seccion (exige la sesion ya iniciada)
create or replace function change_password(p_token uuid, p_section text, p_new_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _valid_session(p_token, p_section) then
    raise exception 'unauthorized';
  end if;
  update sections set password_hash = crypt(p_new_password, gen_salt('bf'))
    where key = p_section;
  return true;
end;
$$;

-- Devuelve todo lo necesario para pintar el dashboard de una seccion:
-- cuentas, categorias, ultimos movimientos y metas de ahorro.
create or replace function get_state(p_token uuid, p_section text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  result json;
begin
  if not _valid_session(p_token, p_section) then
    raise exception 'unauthorized';
  end if;

  select json_build_object(
    'accounts', (
      select coalesce(json_agg(row_to_json(a) order by a.created_at), '[]'::json)
      from accounts a where a.section_key = p_section and a.archived = false
    ),
    'categories', (
      select coalesce(json_agg(row_to_json(c) order by c.name), '[]'::json)
      from categories c where c.section_key = p_section
    ),
    'transactions', (
      select coalesce(json_agg(row_to_json(t) order by t.txn_date desc, t.created_at desc), '[]'::json)
      from transactions t where t.section_key = p_section
    ),
    'goals', (
      select coalesce(json_agg(row_to_json(g) order by g.created_at), '[]'::json)
      from savings_goals g where g.section_key = p_section
    )
  ) into result;

  return result;
end;
$$;

-- Cuentas
create or replace function add_account(p_token uuid, p_section text, p_name text, p_type text, p_initial numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v_row accounts;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  insert into accounts(section_key, name, type, initial_balance)
    values (p_section, p_name, p_type, p_initial) returning * into v_row;
  return row_to_json(v_row);
end;
$$;

create or replace function delete_account(p_token uuid, p_section text, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  update accounts set archived = true where id = p_account_id and section_key = p_section;
end;
$$;

-- Categorias
create or replace function add_category(p_token uuid, p_section text, p_name text, p_type text, p_color text)
returns json language plpgsql security definer set search_path = public as $$
declare v_row categories;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  insert into categories(section_key, name, type, color)
    values (p_section, p_name, p_type, coalesce(p_color, '#2F5D50')) returning * into v_row;
  return row_to_json(v_row);
end;
$$;

-- Movimientos
create or replace function add_transaction(
  p_token uuid, p_section text, p_account_id uuid, p_category_id uuid,
  p_type text, p_amount numeric, p_description text, p_date date
)
returns json language plpgsql security definer set search_path = public as $$
declare v_row transactions;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  insert into transactions(section_key, account_id, category_id, type, amount, description, txn_date)
    values (p_section, p_account_id, p_category_id, p_type, p_amount, p_description, coalesce(p_date, current_date))
    returning * into v_row;
  return row_to_json(v_row);
end;
$$;

create or replace function delete_transaction(p_token uuid, p_section text, p_transaction_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  delete from transactions where id = p_transaction_id and section_key = p_section;
end;
$$;

-- Metas de ahorro
create or replace function add_goal(p_token uuid, p_section text, p_name text, p_target numeric, p_deadline date)
returns json language plpgsql security definer set search_path = public as $$
declare v_row savings_goals;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  insert into savings_goals(section_key, name, target_amount, deadline)
    values (p_section, p_name, p_target, p_deadline) returning * into v_row;
  return row_to_json(v_row);
end;
$$;

create or replace function update_goal_amount(p_token uuid, p_section text, p_goal_id uuid, p_new_amount numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v_row savings_goals;
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  update savings_goals set current_amount = p_new_amount
    where id = p_goal_id and section_key = p_section returning * into v_row;
  return row_to_json(v_row);
end;
$$;

create or replace function delete_goal(p_token uuid, p_section text, p_goal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _valid_session(p_token, p_section) then raise exception 'unauthorized'; end if;
  delete from savings_goals where id = p_goal_id and section_key = p_section;
end;
$$;

-- ---------------------------------------------------------------------
-- DATOS INICIALES
-- Contrasena temporal para las 3 secciones: "cambiar123"
-- CAMBIALA apenas entres (desde la app, o volviendo a correr el update
-- de abajo con tu propia contrasena).
-- ---------------------------------------------------------------------

insert into sections (key, name, password_hash) values
  ('daniel',      'Mis finanzas',        crypt('cambiar123', gen_salt('bf'))),
  ('pareja',      'Finanzas de mi pareja', crypt('cambiar123', gen_salt('bf'))),
  ('compartido',  'Ahorro en pareja',     crypt('cambiar123', gen_salt('bf')))
on conflict (key) do nothing;

-- Categorias por defecto para daniel y pareja (compartido usa las suyas propias)
insert into categories (section_key, name, type, color)
select s.key, c.name, c.type, c.color
from (values ('daniel'), ('pareja')) as s(key)
cross join (values
  ('Salario',        'ingreso', '#2F5D50'),
  ('Ventas / freelance', 'ingreso', '#3E7C6B'),
  ('Otros ingresos',  'ingreso', '#6B9080'),
  ('Comida',          'gasto',   '#9C3D3D'),
  ('Transporte',      'gasto',   '#B0793C'),
  ('Servicios',       'gasto',   '#8B5E3C'),
  ('Salud',           'gasto',   '#7A4B4B'),
  ('Entretenimiento', 'gasto',   '#A45D5D'),
  ('Otros gastos',    'gasto',   '#6E6E6E')
) as c(name, type, color)
on conflict do nothing;

insert into categories (section_key, name, type, color) values
  ('compartido', 'Aporte mensual', 'ingreso', '#B0793C'),
  ('compartido', 'Gasto del fondo', 'gasto', '#9C3D3D');
