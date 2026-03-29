-- Insere um item em public."Todos os Produtos" (se o código ainda não existir).
-- Rode no Supabase: SQL Editor → Run.
--
-- Produto: 02.02.0044 — RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G · unidade CX
-- (Se a sua tabela não tiver a coluna `unidade`, apague `, unidade` e o terceiro valor `'CX'`.)

begin;

insert into public."Todos os Produtos" (codigo_interno, descricao, unidade)
select
  '02.02.0044',
  'RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G',
  'CX'
where not exists (
  select 1
  from public."Todos os Produtos" t
  where trim(both from t.codigo_interno) = '02.02.0044'
);

commit;
