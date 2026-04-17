-- Ao apagar uma linha em public.usuarios (Table Editor, SQL, etc.), remove também
-- o usuário em auth.users para o mesmo id. Assim o login some junto com a linha do perfil.
--
-- Observação: a FK original é usuarios.id -> auth.users(id) ON DELETE CASCADE (se apagar
-- no Auth, a linha em usuarios some). Este trigger cobre o caminho inverso.
--
-- Rode no SQL Editor do Supabase (projeto com public.usuarios já criada).
-- Se der erro de permissão em auth.users, execute como role com acesso ao schema auth.

begin;

create or replace function public.delete_auth_user_when_usuario_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = old.id;
  return old;
end;
$$;

comment on function public.delete_auth_user_when_usuario_deleted() is
  'Após DELETE em public.usuarios, remove o registro correspondente em auth.users.';

drop trigger if exists trg_usuarios_delete_cascade_auth on public.usuarios;

create trigger trg_usuarios_delete_cascade_auth
after delete on public.usuarios
for each row
execute function public.delete_auth_user_when_usuario_deleted();

commit;
