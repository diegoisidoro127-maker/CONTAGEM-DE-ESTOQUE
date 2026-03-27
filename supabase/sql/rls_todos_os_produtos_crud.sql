-- Políticas RLS + GRANT para: public."Todos os Produtos"
-- Sintoma: "Nenhuma linha foi atualizada (0 linhas)" ao salvar no app.
-- Causas comuns: (1) RLS sem política de UPDATE; (2) política antiga conflitante; (3) falta de GRANT na tabela.
--
-- Rode no Supabase: SQL Editor → Run (inteiro, uma vez).

begin;

alter table public."Todos os Produtos" enable row level security;

-- Garante que anon/authenticated podem executar operações (o RLS ainda filtra por política).
grant select, insert, update, delete on table public."Todos os Produtos" to anon, authenticated;

-- Remove TODAS as políticas existentes nesta tabela (evita conflito com nomes antigos).
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'Todos os Produtos'
  loop
    execute format('drop policy if exists %I on public."Todos os Produtos"', pol.policyname);
  end loop;
end $$;

-- anon (chave pública do front)
create policy "todos_produtos_anon_select"
on public."Todos os Produtos"
for select
to anon
using (true);

create policy "todos_produtos_anon_insert"
on public."Todos os Produtos"
for insert
to anon
with check (true);

create policy "todos_produtos_anon_update"
on public."Todos os Produtos"
for update
to anon
using (true)
with check (true);

create policy "todos_produtos_anon_delete"
on public."Todos os Produtos"
for delete
to anon
using (true);

-- authenticated
create policy "todos_produtos_auth_select"
on public."Todos os Produtos"
for select
to authenticated
using (true);

create policy "todos_produtos_auth_insert"
on public."Todos os Produtos"
for insert
to authenticated
with check (true);

create policy "todos_produtos_auth_update"
on public."Todos os Produtos"
for update
to authenticated
using (true)
with check (true);

create policy "todos_produtos_auth_delete"
on public."Todos os Produtos"
for delete
to authenticated
using (true);

commit;
