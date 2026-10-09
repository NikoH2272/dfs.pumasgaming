-- DFS LEAGUE S2 · esquema de base de datos
-- Ejecutar completo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin perder datos (también actualiza versiones anteriores).
--
-- Seguridad: la web solo LEE con la clave pública (anon). Todo lo que escribe el admin pasa por
-- funciones staff_* que validan usuario/sesión dentro de la base de datos.

create extension if not exists pgcrypto with schema extensions;

-- ============ Limpieza de la versión con Supabase Auth (correo) ============
do $$
declare t text;
begin
  foreach t in array array['settings', 'schedule', 'result_groups', 'result_rows', 'sponsors'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "staff escribe" on public.%I', t);
    end if;
  end loop;
end $$;
drop policy if exists "staff sube media" on storage.objects;
drop policy if exists "staff edita media" on storage.objects;
drop policy if exists "staff borra media" on storage.objects;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles cascade;
drop function if exists public.has_role(text[]) cascade;

-- ============ Usuarios del staff (usuario + clave, sin correo) ============
create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,30}$'),
  display_name text not null default '',
  password_hash text not null,
  role text not null default 'editor' check (role in ('editor', 'admin')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);

-- Sin políticas: nadie las lee directamente, solo las funciones staff_*.
alter table public.staff_users enable row level security;
alter table public.staff_sessions enable row level security;

-- ============ Contenido ============
create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  tournament jsonb not null default '{}',
  links jsonb not null default '{}',
  prizes jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Cronograma: una fila por grupo. "time" es la hora de México (24 h); la web calcula CO, RD y AR.
create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  date date,
  time text,
  status text not null default 'proximo' check (status in ('proximo', 'envivo', 'finalizado')),
  updated_at timestamptz not null default now()
);
alter table public.schedule add column if not exists phase text not null default '';
alter table public.schedule add column if not exists group_name text not null default '';
alter table public.schedule add column if not exists rooms int not null default 1;
alter table public.schedule add column if not exists visible boolean not null default false;
alter table public.schedule add column if not exists note text not null default '';
alter table public.schedule add column if not exists position int not null default 0;
alter table public.schedule drop column if exists title;
alter table public.schedule drop column if exists detail;

-- Tablas de resultados: kind = 'grupo' (se cargan equipos) o 'general' (suma automática de la fase).
create table if not exists public.result_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  phase text not null default '',
  position int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.result_groups add column if not exists kind text not null default 'grupo';
alter table public.result_groups add column if not exists qualify int not null default 0;

create table if not exists public.result_rows (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.result_groups (id) on delete cascade,
  team text not null default '',
  kills int not null default 0,
  placement int not null default 0,
  position int not null default 0
);
alter table public.result_rows add column if not exists penalty int not null default 0;
alter table public.result_rows drop column if exists booyah;
create index if not exists result_rows_group_idx on public.result_rows (group_id);

-- logo_url guarda una URL o la imagen comprimida (data:image/webp) subida desde el admin.
create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  name text not null default '',
  logo_url text not null default '',
  url text not null default ''
);

-- ============ Lectura pública (RLS) ============
do $$
declare t text;
begin
  foreach t in array array['settings', 'schedule', 'result_groups', 'result_rows', 'sponsors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('create policy "lectura publica" on public.%I for select using (true)', t);
  end loop;
end $$;

-- El público solo ve las fechas activadas desde el admin.
drop policy if exists "lectura publica" on public.schedule;
create policy "lectura publica" on public.schedule for select using (visible);

-- ============ Funciones del staff ============
-- Valida la sesión y el rol. Uso interno (no se expone a la web).
create or replace function public.staff_auth(p_token uuid, p_admin_only boolean default false)
returns public.staff_users language plpgsql security definer set search_path = public as $$
declare u public.staff_users;
begin
  select su.* into u from public.staff_sessions s join public.staff_users su on su.id = s.user_id
  where s.token = p_token and s.expires_at > now();
  if not found then raise exception 'Sesión vencida, vuelve a entrar' using errcode = 'P0001'; end if;
  if p_admin_only and u.role <> 'admin' then raise exception 'Solo un admin puede hacer esto' using errcode = 'P0001'; end if;
  return u;
end $$;

create or replace function public.staff_public(u public.staff_users)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'role', u.role, 'created_at', u.created_at);
$$;

create or replace function public.staff_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.staff_users; t uuid;
begin
  select * into u from public.staff_users where username = lower(trim(p_username));
  if not found then
    perform pg_sleep(0.5);
    raise exception 'Usuario o clave incorrectos' using errcode = 'P0001';
  end if;
  if u.locked_until > now() then
    raise exception 'Demasiados intentos. Espera unos minutos.' using errcode = 'P0001';
  end if;
  if u.password_hash <> crypt(p_password, u.password_hash) then
    update public.staff_users
      set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end
      where id = u.id;
    raise exception 'Usuario o clave incorrectos' using errcode = 'P0001';
  end if;
  update public.staff_users set failed_attempts = 0, locked_until = null where id = u.id;
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions (user_id) values (u.id) returning token into t;
  return jsonb_build_object('token', t, 'user', public.staff_public(u));
end $$;

create or replace function public.staff_me(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.staff_public(public.staff_auth(p_token));
end $$;

create or replace function public.staff_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.staff_sessions where token = p_token;
$$;

create or replace function public.staff_change_password(p_token uuid, p_old text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u public.staff_users := public.staff_auth(p_token);
begin
  if u.password_hash <> crypt(p_old, u.password_hash) then raise exception 'La clave actual no es correcta' using errcode = 'P0001'; end if;
  if length(p_new) < 6 then raise exception 'La clave debe tener al menos 6 caracteres' using errcode = 'P0001'; end if;
  update public.staff_users set password_hash = crypt(p_new, gen_salt('bf')) where id = u.id;
  delete from public.staff_sessions where user_id = u.id and token <> p_token;
end $$;

-- Cronograma completo (incluye fechas ocultas) para el admin.
create or replace function public.staff_schedule(p_token uuid)
returns setof public.schedule language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_auth(p_token);
  return query select * from public.schedule order by position;
end $$;

-- Guarda todo el contenido del admin en una sola transacción.
create or replace function public.staff_save(p_token uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_auth(p_token);

  update public.settings set tournament = coalesce(p_data -> 'tournament', '{}'), links = coalesce(p_data -> 'links', '{}'),
    prizes = coalesce(p_data -> 'prizes', '[]'), updated_at = now() where id = 1;

  insert into public.schedule (id, phase, group_name, date, time, rooms, status, visible, note, position)
  select (x ->> 'id')::uuid, coalesce(x ->> 'phase', ''), coalesce(x ->> 'group', ''), nullif(x ->> 'date', '')::date,
    coalesce(x ->> 'time', ''), coalesce((x ->> 'rooms')::int, 1), coalesce(x ->> 'status', 'proximo'),
    coalesce((x ->> 'visible')::boolean, false), coalesce(x ->> 'note', ''), (i - 1)::int
  from jsonb_array_elements(coalesce(p_data -> 'schedule', '[]')) with ordinality t(x, i)
  on conflict (id) do update set phase = excluded.phase, group_name = excluded.group_name, date = excluded.date,
    time = excluded.time, rooms = excluded.rooms, status = excluded.status, visible = excluded.visible,
    note = excluded.note, position = excluded.position, updated_at = now();
  delete from public.schedule where id not in
    (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_data -> 'schedule', '[]')) x);

  insert into public.result_groups (id, title, phase, kind, qualify, position)
  select (g ->> 'id')::uuid, coalesce(g ->> 'title', ''), coalesce(g ->> 'phase', ''), coalesce(g ->> 'kind', 'grupo'),
    coalesce((g ->> 'qualify')::int, 0), (i - 1)::int
  from jsonb_array_elements(coalesce(p_data -> 'results', '[]')) with ordinality t(g, i)
  on conflict (id) do update set title = excluded.title, phase = excluded.phase, kind = excluded.kind,
    qualify = excluded.qualify, position = excluded.position;
  update public.result_groups set updated_at = now()
  where id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_data -> 'touched', '[]')) x);
  delete from public.result_groups where id not in
    (select (g ->> 'id')::uuid from jsonb_array_elements(coalesce(p_data -> 'results', '[]')) g);

  insert into public.result_rows (id, group_id, team, kills, placement, penalty, position)
  select (r ->> 'id')::uuid, (g ->> 'id')::uuid, trim(coalesce(r ->> 'team', '')), coalesce((r ->> 'kills')::int, 0),
    coalesce((r ->> 'placement')::int, 0), coalesce((r ->> 'penalty')::int, 0), (k - 1)::int
  from jsonb_array_elements(coalesce(p_data -> 'results', '[]')) g,
    jsonb_array_elements(coalesce(g -> 'rows', '[]')) with ordinality t(r, k)
  on conflict (id) do update set group_id = excluded.group_id, team = excluded.team, kills = excluded.kills,
    placement = excluded.placement, penalty = excluded.penalty, position = excluded.position;
  delete from public.result_rows where id not in
    (select (r ->> 'id')::uuid from jsonb_array_elements(coalesce(p_data -> 'results', '[]')) g,
      jsonb_array_elements(coalesce(g -> 'rows', '[]')) r);

  insert into public.sponsors (id, position, name, logo_url, url)
  select (s ->> 'id')::uuid, (i - 1)::int, coalesce(s ->> 'name', ''), coalesce(s ->> 'logo', ''), coalesce(s ->> 'url', '')
  from jsonb_array_elements(coalesce(p_data -> 'sponsors', '[]')) with ordinality t(s, i)
  on conflict (id) do update set position = excluded.position, name = excluded.name,
    logo_url = excluded.logo_url, url = excluded.url;
  delete from public.sponsors where id not in
    (select (s ->> 'id')::uuid from jsonb_array_elements(coalesce(p_data -> 'sponsors', '[]')) s);
end $$;

-- Gestión de usuarios (solo admin).
create or replace function public.staff_list_users(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_auth(p_token, true);
  return coalesce((select jsonb_agg(public.staff_public(u) order by u.created_at) from public.staff_users u), '[]');
end $$;

create or replace function public.staff_create_user(p_token uuid, p_username text, p_password text, p_display_name text, p_role text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.staff_users;
begin
  perform public.staff_auth(p_token, true);
  if length(coalesce(p_password, '')) < 6 then raise exception 'La clave debe tener al menos 6 caracteres' using errcode = 'P0001'; end if;
  if exists (select 1 from public.staff_users where username = lower(trim(p_username))) then
    raise exception 'Ese usuario ya existe' using errcode = 'P0001';
  end if;
  insert into public.staff_users (username, display_name, password_hash, role)
  values (lower(trim(p_username)), coalesce(p_display_name, ''), crypt(p_password, gen_salt('bf')), p_role)
  returning * into u;
  return public.staff_public(u);
exception when check_violation then
  raise exception 'Usuario inválido: 3 a 30 caracteres, solo letras, números, punto, guion o guion bajo' using errcode = 'P0001';
end $$;

create or replace function public.staff_update_user(p_token uuid, p_id uuid, p_role text, p_password text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me public.staff_users := public.staff_auth(p_token, true);
begin
  if p_id = me.id and p_role <> 'admin' then raise exception 'No puedes quitarte el rol de admin' using errcode = 'P0001'; end if;
  if p_password is not null and length(p_password) < 6 then raise exception 'La clave debe tener al menos 6 caracteres' using errcode = 'P0001'; end if;
  update public.staff_users set role = p_role,
    password_hash = case when p_password is null then password_hash else crypt(p_password, gen_salt('bf')) end,
    failed_attempts = 0, locked_until = null
  where id = p_id;
  if p_password is not null then delete from public.staff_sessions where user_id = p_id; end if;
end $$;

create or replace function public.staff_delete_user(p_token uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff_users := public.staff_auth(p_token, true);
begin
  if p_id = me.id then raise exception 'No puedes eliminar tu propio usuario' using errcode = 'P0001'; end if;
  delete from public.staff_users where id = p_id;
end $$;

-- Crear/restablecer un admin desde el SQL Editor (no se expone a la web).
create or replace function public.staff_set_admin(p_username text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.staff_users (username, display_name, password_hash, role)
  values (lower(trim(p_username)), p_username, crypt(p_password, gen_salt('bf')), 'admin')
  on conflict (username) do update set password_hash = excluded.password_hash, role = 'admin', failed_attempts = 0, locked_until = null;
  return 'Admin listo: ' || lower(trim(p_username));
end $$;

-- Permisos: la web (anon) solo puede llamar a las funciones públicas del staff.
revoke all on function public.staff_auth(uuid, boolean) from public, anon, authenticated;
revoke all on function public.staff_set_admin(text, text) from public, anon, authenticated;
revoke all on function public.staff_public(public.staff_users) from public, anon, authenticated;
grant execute on function public.staff_login(text, text) to anon, authenticated;
grant execute on function public.staff_me(uuid) to anon, authenticated;
grant execute on function public.staff_logout(uuid) to anon, authenticated;
grant execute on function public.staff_change_password(uuid, text, text) to anon, authenticated;
grant execute on function public.staff_schedule(uuid) to anon, authenticated;
grant execute on function public.staff_save(uuid, jsonb) to anon, authenticated;
grant execute on function public.staff_list_users(uuid) to anon, authenticated;
grant execute on function public.staff_create_user(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.staff_update_user(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.staff_delete_user(uuid, uuid) to anon, authenticated;

-- ============ Datos iniciales ============
insert into public.settings (id, tournament, links, prizes) values (1,
  '{"name":"DFS LEAGUE S2","tagline":"MORE THAN A GAME","game":"FREE FIRE","year":"2026","server":"LATAM","platform":"Solo móvil","teams":180,"groups":15,"prizePool":"400 USD","intro":"Ha llegado el momento. DFS League Season 2 da inicio a una nueva batalla donde solo los equipos más disciplinados, estratégicos y agresivos lograrán marcar la diferencia. Cada partida cuenta. Cada decisión importa. Y solo los mejores llegarán hasta el final.","heroImage":"assets/hero.webp"}',
  '{"instagram":"https://www.instagram.com/dfs.league/","instagramHandle":"@dfs.league","infoGroup":"","infoGroupLabel":"Grupo de información (WhatsApp)","discord":"","registration":""}',
  '[{"place":"1° Lugar","amount":"200 USD"},{"place":"2° Lugar","amount":"120 USD"},{"place":"3° Lugar","amount":"80 USD"}]'
) on conflict (id) do nothing;

-- Completa los ajustes nuevos sin pisar lo que ya editaste.
update public.settings set tournament =
  '{"state":"abierto","teamsPerGroup":12,"notice":"Jugador FFWS no registrado desde octavos de final no tendrá derecho a jugar en demás fases. Debe ser jugador registrado en sala y con cuenta propia."}'::jsonb
  || (tournament - 'status')
  || case when tournament ->> 'heroImage' = 'assets/poster.webp' then '{"heroImage":"assets/hero.webp"}'::jsonb else '{}'::jsonb end
where id = 1;

insert into public.sponsors (position, name)
select n, 'Sponsor ' || n from generate_series(1, 18) n
where not exists (select 1 from public.sponsors);

-- Cronograma oficial (todas las fechas empiezan ocultas; se activan desde el admin).
insert into public.schedule (phase, group_name, date, time, rooms, status, visible, position)
select * from (values
  ('Octavos de final', 'Grupo A', date '2026-10-12', '18:00', 2, 'proximo', false, 0),
  ('Octavos de final', 'Grupo B', date '2026-10-12', '19:00', 2, 'proximo', false, 1),
  ('Octavos de final', 'Grupo C', date '2026-10-12', '20:00', 2, 'proximo', false, 2),
  ('Octavos de final', 'Grupo D', date '2026-10-13', '18:00', 2, 'proximo', false, 3),
  ('Octavos de final', 'Grupo E', date '2026-10-13', '19:00', 2, 'proximo', false, 4),
  ('Octavos de final', 'Grupo F', date '2026-10-13', '20:00', 2, 'proximo', false, 5),
  ('Octavos de final', 'Grupo G', date '2026-10-14', '18:00', 2, 'proximo', false, 6),
  ('Octavos de final', 'Grupo H', date '2026-10-14', '19:00', 2, 'proximo', false, 7),
  ('Octavos de final', 'Grupo I', date '2026-10-14', '20:00', 2, 'proximo', false, 8),
  ('Octavos de final', 'Grupo J', date '2026-10-15', '18:00', 2, 'proximo', false, 9),
  ('Octavos de final', 'Grupo K', date '2026-10-15', '19:00', 2, 'proximo', false, 10),
  ('Octavos de final', 'Grupo L', date '2026-10-15', '20:00', 2, 'proximo', false, 11),
  ('Octavos de final', 'Grupo M', date '2026-10-16', '18:00', 2, 'proximo', false, 12),
  ('Octavos de final', 'Grupo N', date '2026-10-16', '19:00', 2, 'proximo', false, 13),
  ('Octavos de final', 'Grupo O', date '2026-10-16', '20:00', 2, 'proximo', false, 14),
  ('Cuartos de final', 'Grupo A', date '2026-10-19', '20:00', 3, 'proximo', false, 15),
  ('Cuartos de final', 'Grupo B', date '2026-10-20', '18:00', 3, 'proximo', false, 16),
  ('Cuartos de final', 'Grupo C', date '2026-10-20', '20:00', 3, 'proximo', false, 17),
  ('Cuartos de final', 'Grupo D', date '2026-10-21', '18:00', 3, 'proximo', false, 18),
  ('Cuartos de final', 'Grupo E', date '2026-10-21', '20:00', 3, 'proximo', false, 19),
  ('Cuartos de final', 'Grupo F', date '2026-10-22', '18:00', 3, 'proximo', false, 20),
  ('Cuartos de final', 'Grupo G', date '2026-10-22', '20:00', 3, 'proximo', false, 21),
  ('Cuartos de final', 'Grupo H', date '2026-10-23', '20:00', 3, 'proximo', false, 22),
  ('Semifinal', 'Grupo A', date '2026-10-26', '20:00', 4, 'proximo', false, 23),
  ('Semifinal', 'Grupo B', date '2026-10-27', '20:00', 4, 'proximo', false, 24),
  ('Semifinal', 'Grupo C', date '2026-10-28', '20:00', 4, 'proximo', false, 25),
  ('Final', 'Final', date '2026-10-30', '20:00', 6, 'proximo', false, 26)
) v where not exists (select 1 from public.schedule);

insert into public.result_groups (phase, title, kind, qualify, position)
select * from (values
  ('Octavos de final', 'Grupo A', 'grupo', 0, 0),
  ('Octavos de final', 'Grupo B', 'grupo', 0, 1),
  ('Octavos de final', 'Grupo C', 'grupo', 0, 2),
  ('Octavos de final', 'Grupo D', 'grupo', 0, 3),
  ('Octavos de final', 'Grupo E', 'grupo', 0, 4),
  ('Octavos de final', 'Grupo F', 'grupo', 0, 5),
  ('Octavos de final', 'Grupo G', 'grupo', 0, 6),
  ('Octavos de final', 'Grupo H', 'grupo', 0, 7),
  ('Octavos de final', 'Grupo I', 'grupo', 0, 8),
  ('Octavos de final', 'Grupo J', 'grupo', 0, 9),
  ('Octavos de final', 'Grupo K', 'grupo', 0, 10),
  ('Octavos de final', 'Grupo L', 'grupo', 0, 11),
  ('Octavos de final', 'Grupo M', 'grupo', 0, 12),
  ('Octavos de final', 'Grupo N', 'grupo', 0, 13),
  ('Octavos de final', 'Grupo O', 'grupo', 0, 14),
  ('Cuartos de final', 'Grupo A', 'grupo', 0, 15),
  ('Cuartos de final', 'Grupo B', 'grupo', 0, 16),
  ('Cuartos de final', 'Grupo C', 'grupo', 0, 17),
  ('Cuartos de final', 'Grupo D', 'grupo', 0, 18),
  ('Cuartos de final', 'Grupo E', 'grupo', 0, 19),
  ('Cuartos de final', 'Grupo F', 'grupo', 0, 20),
  ('Cuartos de final', 'Grupo G', 'grupo', 0, 21),
  ('Cuartos de final', 'Grupo H', 'grupo', 0, 22),
  ('Semifinal', 'Grupo A', 'grupo', 0, 23),
  ('Semifinal', 'Grupo B', 'grupo', 0, 24),
  ('Semifinal', 'Grupo C', 'grupo', 0, 25),
  ('Final', 'Final', 'grupo', 0, 26)
) v where not exists (select 1 from public.result_groups);

-- 12 cupos vacíos por grupo para cargar los equipos.
insert into public.result_rows (group_id, position)
select g.id, n from public.result_groups g, generate_series(0, 11) n
where g.kind = 'grupo' and not exists (select 1 from public.result_rows);

-- ============ Primer administrador ============
-- Cambia "tu_usuario" y "tu_clave" y ejecuta SOLO esta línea (también sirve para recuperar la clave):
-- select public.staff_set_admin('tu_usuario', 'tu_clave');
