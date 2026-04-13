-- Perfil de usuário vinculado ao Supabase Auth (`auth.users`).
-- Execute no SQL Editor do Supabase (projeto com Authentication habilitado).
--
-- Após rodar: cada novo cadastro em Auth recebe linha em `public.usuarios` via trigger.
-- O app pode ler/atualizar só o próprio registro (RLS com `auth.uid()`).

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nome text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.usuarios is
  'Perfil do usuário logado (1:1 com auth.users). Dados extras além do e-mail do Auth.';

comment on column public.usuarios.id is 'Mesmo UUID de auth.users.';
comment on column public.usuarios.email is 'Cópia do e-mail do Auth para consultas sem join em auth.users.';
comment on column public.usuarios.nome is 'Nome de exibição (pode vir de raw_user_meta_data no cadastro).';

create index if not exists idx_usuarios_email on public.usuarios (email);

-- Mantém updated_at ao atualizar
create or replace function public.touch_usuarios_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_usuarios_updated_at on public.usuarios;
create trigger trg_usuarios_updated_at
before update on public.usuarios
for each row
execute function public.touch_usuarios_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: criar linha em `usuarios` quando um usuário é criado no Auth
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_nome text;
begin
  meta_nome := coalesce(
    nullif(trim(new.raw_user_meta_data->>'nome'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into public.usuarios (id, email, nome)
  values (new.id, new.email, coalesce(meta_nome, ''))
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_usuarios on auth.users;
create trigger on_auth_user_created_usuarios
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- RLS: cada usuário autenticado vê e edita apenas o próprio registro
-- ---------------------------------------------------------------------------
alter table public.usuarios enable row level security;

drop policy if exists "usuarios_select_own" on public.usuarios;
drop policy if exists "usuarios_insert_own" on public.usuarios;
drop policy if exists "usuarios_update_own" on public.usuarios;
drop policy if exists "usuarios_delete_own" on public.usuarios;
drop policy if exists "usuarios_service_role_all" on public.usuarios;

create policy "usuarios_select_own"
on public.usuarios
for select
to authenticated
using (auth.uid() = id);

create policy "usuarios_insert_own"
on public.usuarios
for insert
to authenticated
with check (auth.uid() = id);

create policy "usuarios_update_own"
on public.usuarios
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Opcional: permitir que o próprio usuário apague o perfil (cascade já remove se auth user for apagado)
create policy "usuarios_delete_own"
on public.usuarios
for delete
to authenticated
using (auth.uid() = id);

create policy "usuarios_service_role_all"
on public.usuarios
for all
to service_role
using (true)
with check (true);

-- Sem políticas para `anon` — dados de usuário só com sessão.

grant select, insert, update, delete on table public.usuarios to authenticated;
grant all on table public.usuarios to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Backfill (opcional): usuários criados antes deste script
-- ---------------------------------------------------------------------------
-- insert into public.usuarios (id, email, nome)
-- select
--   u.id,
--   u.email,
--   coalesce(
--     nullif(trim(u.raw_user_meta_data->>'nome'), ''),
--     nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
--     split_part(coalesce(u.email, ''), '@', 1),
--     ''
--   )
-- from auth.users u
-- where not exists (select 1 from public.usuarios p where p.id = u.id);
