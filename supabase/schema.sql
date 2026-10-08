-- DFS LEAGUE S2 · esquema de base de datos
-- Ejecutar completo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin perder datos.

-- ============ Usuarios (perfiles + roles) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'pendiente' check (role in ('pendiente', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

-- Cada cuenta nueva entra como "pendiente" hasta que un admin la apruebe.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any (roles));
$$;

-- ============ Contenido ============
create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  tournament jsonb not null default '{}',
  links jsonb not null default '{}',
  prizes jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  date date,
  time text,
  title text not null default '',
  detail text not null default '',
  status text not null default 'proximo' check (status in ('proximo', 'envivo', 'finalizado')),
  updated_at timestamptz not null default now()
);

create table if not exists public.result_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  phase text not null default '',
  position int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.result_rows (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.result_groups (id) on delete cascade,
  team text not null default '',
  booyah int not null default 0,
  kills int not null default 0,
  placement int not null default 0,
  position int not null default 0
);
create index if not exists result_rows_group_idx on public.result_rows (group_id);

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  name text not null default '',
  logo_url text not null default '',
  url text not null default ''
);

-- ============ Seguridad (RLS) ============
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.schedule enable row level security;
alter table public.result_groups enable row level security;
alter table public.result_rows enable row level security;
alter table public.sponsors enable row level security;

drop policy if exists "perfil propio o admin" on public.profiles;
create policy "perfil propio o admin" on public.profiles for select
  using (id = auth.uid() or public.has_role(array['admin']));
drop policy if exists "admin gestiona usuarios" on public.profiles;
create policy "admin gestiona usuarios" on public.profiles for update
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

do $$
declare t text;
begin
  foreach t in array array['settings', 'schedule', 'result_groups', 'result_rows', 'sponsors'] loop
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('create policy "lectura publica" on public.%I for select using (true)', t);
    execute format('drop policy if exists "staff escribe" on public.%I', t);
    execute format('create policy "staff escribe" on public.%I for all using (public.has_role(array[''admin'',''editor''])) with check (public.has_role(array[''admin'',''editor'']))', t);
  end loop;
end $$;

-- ============ Imágenes (Storage) ============
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "staff sube media" on storage.objects;
create policy "staff sube media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.has_role(array['admin', 'editor']));
drop policy if exists "staff edita media" on storage.objects;
create policy "staff edita media" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.has_role(array['admin', 'editor']));
drop policy if exists "staff borra media" on storage.objects;
create policy "staff borra media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.has_role(array['admin', 'editor']));

-- ============ Datos iniciales ============
insert into public.settings (id, tournament, links, prizes) values (1,
  '{"name":"DFS LEAGUE S2","tagline":"MORE THAN A GAME","game":"FREE FIRE","year":"2026","server":"LATAM","platform":"Solo móvil","teams":180,"groups":15,"prizePool":"400 USD","status":"Inscripciones abiertas","intro":"Ha llegado el momento. DFS League Season 2 da inicio a una nueva batalla donde solo los equipos más disciplinados, estratégicos y agresivos lograrán marcar la diferencia. Cada partida cuenta. Cada decisión importa. Y solo los mejores llegarán hasta el final.","heroImage":"assets/poster.webp"}',
  '{"instagram":"https://www.instagram.com/dfs.league/","instagramHandle":"@dfs.league","infoGroup":"","infoGroupLabel":"Grupo de información (WhatsApp)","discord":"","registration":""}',
  '[{"place":"1° Lugar","amount":"200 USD"},{"place":"2° Lugar","amount":"120 USD"},{"place":"3° Lugar","amount":"80 USD"}]'
) on conflict (id) do nothing;

insert into public.sponsors (position, name)
select n, 'Sponsor ' || n from generate_series(1, 18) n
where not exists (select 1 from public.sponsors);

-- ============ Primer administrador ============
-- 1) Crea tu cuenta desde /admin.html → "Crear cuenta" (y confirma el correo).
-- 2) Luego ejecuta esta línea con tu correo:
-- update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';
