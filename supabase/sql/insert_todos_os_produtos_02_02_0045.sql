-- Insere um item em public."Todos os Produtos" (se o código ainda não existir).
-- Rode no Supabase: SQL Editor → Run.
--
-- Produto: 02.02.0045 — RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO · unidade CX
-- (Se a sua tabela não tiver a coluna `unidade`, apague `, unidade` e o terceiro valor `'CX'`.)

begin;

insert into public."Todos os Produtos" (codigo_interno, descricao, unidade)
select
  '02.02.0045',
  'RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO',
  'CX'
where not exists (
  select 1
  from public."Todos os Produtos" t
  where trim(both from t.codigo_interno) = '02.02.0045'
);

commit;
