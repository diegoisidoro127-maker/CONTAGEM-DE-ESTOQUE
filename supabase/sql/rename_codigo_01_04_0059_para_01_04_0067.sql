-- Renomeia apenas o código interno 01.04.0059 → 01.04.0067 (descrição, EAN, DUN e demais colunas permanecem).
-- Rode no Supabase: SQL Editor → Run (uma vez).
--
-- Antes de rodar: confira se já não existe outra linha com codigo_interno = '01.04.0067'
-- (se existir, resolva o conflito manualmente antes do UPDATE em "Todos os Produtos").

begin;

update public."Todos os Produtos"
set codigo_interno = '01.04.0067'
where trim(both from codigo_interno) = '01.04.0059';

update public.contagens_estoque
set codigo_interno = '01.04.0067'
where trim(both from codigo_interno) = '01.04.0059';

update public.inventario_planilha_linhas
set codigo_interno = '01.04.0067'
where trim(both from codigo_interno) = '01.04.0059';

commit;
