-- VOTA PRO · Esquema inicial para Supabase
-- Ejecutar en Supabase Dashboard > SQL Editor.
-- Este script es idempotente en lo esencial: crea tablas/índices/policies si faltan.
-- La lectura pública de participantes expone nombre y opción asignada, tal como solicita VOTA PRO.

create extension if not exists pgcrypto;

create table if not exists public.options (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  election_id smallint not null default 1 check (election_id in (1,2)),
  created_at timestamptz not null default now()
);

-- Compatibilidad: si la tabla ya existía, agrega la columna sin perder opciones.
alter table public.options add column if not exists election_id smallint not null default 1 check (election_id in (1,2));
drop index if exists public.options_name_unique_lower;
create unique index if not exists options_election_name_unique_lower
  on public.options (election_id, lower(name));

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  option_id uuid not null references public.options(id) on update cascade on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists participants_option_id_idx on public.participants(option_id);
create index if not exists participants_created_at_idx on public.participants(created_at desc);

alter table public.options enable row level security;
alter table public.participants enable row level security;

-- Quitar policies con estos nombres para permitir volver a ejecutar el script.
drop policy if exists "Public can read options" on public.options;
drop policy if exists "Admins can insert options" on public.options;
drop policy if exists "Admins can update options" on public.options;
drop policy if exists "Admins can delete options" on public.options;
drop policy if exists "Public can read participants" on public.participants;
drop policy if exists "Admins can insert participants" on public.participants;
drop policy if exists "Admins can update participants" on public.participants;
drop policy if exists "Admins can delete participants" on public.participants;

-- Público: solo lectura. No se permite insertar, editar ni borrar desde la web pública.
create policy "Public can read options"
on public.options for select
to anon, authenticated
using (true);

create policy "Public can read participants"
on public.participants for select
to anon, authenticated
using (true);

-- Administradores: el rol debe estar en app_metadata, que el usuario no puede editar por sí mismo.
create policy "Admins can insert options"
on public.options for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can update options"
on public.options for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can delete options"
on public.options for delete
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can insert participants"
on public.participants for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can update participants"
on public.participants for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can delete participants"
on public.participants for delete
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Permisos SQL base; RLS determina qué filas puede leer o modificar cada rol.
grant usage on schema public to anon, authenticated;
grant select on public.options, public.participants to anon, authenticated;
grant insert, update, delete on public.options, public.participants to authenticated;

-- Habilitar cambios en tiempo real para ambas tablas.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'options'
  ) then
    alter publication supabase_realtime add table public.options;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants'
  ) then
    alter publication supabase_realtime add table public.participants;
  end if;
end $$;

-- CREAR ADMINISTRADOR (pasos manuales, después de ejecutar el SQL):
-- 1) Supabase Dashboard > Authentication > Users > Add user.
--    Creá el usuario con su correo y contraseña desde el panel de Supabase.
-- 2) Copiá el UUID del usuario y ejecutá esta consulta reemplazando el UUID:
--
-- update auth.users
-- set raw_app_meta_data =
--   coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- where id = 'UUID-DEL-USUARIO';
--
-- 3) Cerrá sesión y volvé a ingresar en admin.html para recibir un JWT actualizado.
-- El rol se guarda en app_metadata (no user_metadata), y las policies verifican
-- ese claim en el servidor. Nunca expongas service_role key en el frontend.

-- NOTAS:
-- * Un participante equivale a un registro/voto. No existe votación anónima desde el público.
-- * Las eliminaciones de opciones con participantes asignados son bloqueadas por FK.
-- * La página pública muestra nombres y opciones asignadas porque así fue solicitado.
-- * Si no querés publicar nombres, modificá la política/consulta y la interfaz antes de publicar.
