-- Adiciona login por username (Edge Functions resolvem para o e-mail interno do Auth).
-- Rode no SQL Editor do Supabase depois de ja existir public.usuarios.
--
-- 1) Coluna + preenchimento a partir do e-mail em auth.users
-- 2) Trigger alinhado ao fluxo register-username (@internal.local)

begin;

alter table public.usuarios add column if not exists username text;

comment on column public.usuarios.username is
  'Login curto em minusculas; espelha o local-part do e-mail interno no Auth.';

-- Um nome de login por utilizador (ignora NULLs duplicados ate backfill)
create unique index if not exists usuarios_username_lower_unique
  on public.usuarios (lower(username))
  where username is not null and length(trim(username)) > 0;

update public.usuarios u
set username = lower(split_part(coalesce(au.email, ''), '@', 1))
from auth.users au
where au.id = u.id
  and (u.username is null or trim(u.username) = '');

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_nome text;
  uname text;
begin
  meta_nome := coalesce(
    nullif(trim(new.raw_user_meta_data->>'nome'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  uname := lower(nullif(trim(new.raw_user_meta_data->>'username'), ''));
  if uname is null or uname = '' then
    uname := lower(split_part(coalesce(new.email, ''), '@', 1));
  end if;

  insert into public.usuarios (id, nome, username)
  values (new.id, coalesce(meta_nome, ''), nullif(uname, ''))
  on conflict (id) do update
    set nome = coalesce(nullif(excluded.nome, ''), public.usuarios.nome),
        username = coalesce(nullif(excluded.username, ''), public.usuarios.username),
        updated_at = now();

  return new;
end;
$$;

commit;
