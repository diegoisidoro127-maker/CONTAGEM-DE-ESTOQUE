-- Limpeza mensal — apaga TODO o histórico:
--   • temperatura (câm. 11/12/13)
--   • ocupação (câm. 11/12/13, inclui coluna avaria_acrescimo_ocupacao no mesmo registro)
--   • legado: contagem_ocupacao_avaria_camaras (tabela separada antiga, se existir)
--
-- Agendamento: dia 1 de cada mês, 00:05 horário de Brasília → cron UTC '5 3 1 * *'.
--
-- Pré-requisitos:
-- 1) Supabase → Database → Extensions → ative "pg_cron".
-- 2) Tabelas: contagem_temperatura_camaras, contagem_ocupacao_camaras.
--    Opcional: contagem_ocupacao_avaria_camaras (só se ainda existir no projeto).
-- 3) Rode este arquivo inteiro no SQL Editor.
--
-- Atenção: operação destrutiva — temperatura e ocupação são sempre esvaziadas; a tabela legada de avaria só se existir.

create extension if not exists pg_cron with schema extensions;

create or replace function public.purge_contagem_ambiental_temperatura_ocupacao_mensal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_temp bigint := 0;
  n_ocup bigint := 0;
  n_avaria bigint := 0;
begin
  delete from public.contagem_temperatura_camaras;
  get diagnostics n_temp = row_count;

  delete from public.contagem_ocupacao_camaras;
  get diagnostics n_ocup = row_count;

  if to_regclass('public.contagem_ocupacao_avaria_camaras') is not null then
    delete from public.contagem_ocupacao_avaria_camaras;
    get diagnostics n_avaria = row_count;
    analyze public.contagem_ocupacao_avaria_camaras;
  end if;

  analyze public.contagem_temperatura_camaras;
  analyze public.contagem_ocupacao_camaras;

  return jsonb_build_object(
    'ran_at_utc', now(),
    'contagem_temperatura_camaras_deleted', n_temp,
    'contagem_ocupacao_camaras_deleted', n_ocup,
    'contagem_ocupacao_avaria_camaras_legacy_deleted', n_avaria
  );
end;
$$;

comment on function public.purge_contagem_ambiental_temperatura_ocupacao_mensal() is
  'Purge mensal: temperatura + ocupação (inclui coluna avaria no mesmo registro) + tabela legada avaria se existir.';

revoke all on function public.purge_contagem_ambiental_temperatura_ocupacao_mensal() from public;
grant execute on function public.purge_contagem_ambiental_temperatura_ocupacao_mensal() to postgres;
grant execute on function public.purge_contagem_ambiental_temperatura_ocupacao_mensal() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge_contagem_ambiental_temp_ocup_mensal';

select cron.schedule(
  'purge_contagem_ambiental_temp_ocup_mensal',
  '5 3 1 * *',
  $$select public.purge_contagem_ambiental_temperatura_ocupacao_mensal();$$
);
