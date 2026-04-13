-- Migração: remove `email` e adiciona `senha` em public.usuarios.
-- Rode no SQL Editor do Supabase se a tabela já existia com a coluna email.
--
-- A autenticação do app continua no Supabase Auth; `senha` aqui é opcional.
-- Não armazene senha em texto puro (use hash com pgcrypto se precisar preencher).

begin;

drop index if exists public.idx_usuarios_email;

alter table public.usuarios drop column if exists email;

alter table public.usuarios add column if not exists senha text;

comment on table public.usuarios is
  'Perfil do usuário (1:1 com auth.users). Login/senha oficiais no Auth; coluna senha é opcional.';

comment on column public.usuarios.senha is
  'Opcional. Não duplicar a senha do Auth em texto puro; preferir hash (crypt) ou deixar null.';

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

  insert into public.usuarios (id, nome)
  values (new.id, coalesce(meta_nome, ''))
  on conflict (id) do update
    set nome = coalesce(nullif(excluded.nome, ''), public.usuarios.nome),
        updated_at = now();

  return new;
end;
$$;

commit;
