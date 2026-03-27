-- Políticas RLS para a tabela usada pelo app: public."Todos os Produtos"
-- Sintoma sem isto: o front mostra "Nenhuma linha foi atualizada (0 linhas)" ao Salvar,
-- porque SELECT funciona mas UPDATE/INSERT/DELETE ficam bloqueados pelo RLS.
--
-- Rode no Supabase: SQL Editor → Run (uma vez).
-- Ajuste depois se quiser restringir a usuários autenticados apenas.

begin;

alter table public."Todos os Produtos" enable row level security;

-- anon (chave pública do front)
drop policy if exists "todos_produtos_anon_select" on public."Todos os Produtos";
drop policy if exists "todos_produtos_anon_insert" on public."Todos os Produtos";
drop policy if exists "todos_produtos_anon_update" on public."Todos os Produtos";
drop policy if exists "todos_produtos_anon_delete" on public."Todos os Produtos";

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

-- authenticated (se usar login)
drop policy if exists "todos_produtos_auth_select" on public."Todos os Produtos";
drop policy if exists "todos_produtos_auth_insert" on public."Todos os Produtos";
drop policy if exists "todos_produtos_auth_update" on public."Todos os Produtos";
drop policy if exists "todos_produtos_auth_delete" on public."Todos os Produtos";

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
