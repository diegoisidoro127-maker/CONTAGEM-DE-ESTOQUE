-- Exclui por código ignorando espaços no início/fim (use no SQL Editor quando
-- `where codigo_interno = '...'` remove 0 linhas).
--
-- Ajuste o literal abaixo e rode.

begin;

delete from public."Todos os Produtos"
where trim(both from codigo_interno) = '02.02.0044';

commit;
