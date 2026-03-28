-- Insere um item em public."Todos os Produtos" (se o código ainda não existir).
-- Rode no Supabase: SQL Editor → Run.
--
-- Produto: 01.04.0028 — massa congelada pão de queijo recheado requeijão ST MARCHE 65G · unidade CX
-- (Se a sua tabela não tiver a coluna `unidade`, apague `, unidade` e o terceiro valor `'CX'`.)

begin;

insert into public."Todos os Produtos" (codigo_interno, descricao, unidade)
select
  '01.04.0028',
  'M. CONG. DE PAO DE QUEIJO RECHEADO DE REQUEIJAO ST MARCHE 65G - 20 PCTS DE 400G',
  'CX'
where not exists (
  select 1
  from public."Todos os Produtos" t
  where trim(both from t.codigo_interno) = '01.04.0028'
);

commit;
