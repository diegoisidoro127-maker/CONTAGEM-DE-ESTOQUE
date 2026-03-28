-- Remove espaços no início/fim de codigo_interno para igualdades (= / .eq) baterem com o esperado.
-- Sintoma: DELETE ou UPDATE com codigo_interno = 'XX' afeta 0 linhas, mas a grade mostra o código "igual".
--
-- Rode no Supabase: SQL Editor → Run (uma vez, ou quando importar dados com espaços).

begin;

update public."Todos os Produtos"
set codigo_interno = trim(both from codigo_interno)
where codigo_interno is not null
  and codigo_interno <> trim(both from codigo_interno);

commit;
