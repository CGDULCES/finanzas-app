-- =====================================================================
-- FIX: categorías duplicadas (el script de datos iniciales se corrió
-- más de una vez porque no había restricción única en `categories`).
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =====================================================================

-- 1) Si algún movimiento ya quedó apuntando a una categoría duplicada,
--    reasignarlo a la que se va a conservar.
with ranked as (
  select id, section_key, name, type,
         row_number() over (partition by section_key, name, type order by id) as rn,
         first_value(id) over (partition by section_key, name, type order by id) as keep_id
  from categories
),
dups as (
  select id, keep_id from ranked where rn > 1
)
update transactions t
set category_id = d.keep_id
from dups d
where t.category_id = d.id;

-- 2) Borrar las filas duplicadas, dejando una por sección+nombre+tipo.
with ranked as (
  select id, section_key, name, type,
         row_number() over (partition by section_key, name, type order by id) as rn
  from categories
)
delete from categories c
using ranked r
where c.id = r.id and r.rn > 1;

-- 3) Restricción única para que esto no vuelva a pasar.
alter table categories
  add constraint categories_section_name_type_uniq unique (section_key, name, type);
