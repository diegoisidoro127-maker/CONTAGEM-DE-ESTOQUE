-- Limpeza mensal: apaga TODO o histórico de temperatura e ocupação (inclui ocupação de avaria).
--
-- Agendamento: dia 1 de cada mês, 00:05 horário de Brasília → cron UTC '5 3 1 * *'.
--
-- Pré-requisitos:
-- 1) Supabase → Database → Extensions → ative "pg_cron".
-- 2) Tabelas existentes: contagem_temperatura_camaras, contagem_ocupacao_camaras,
--    contagem_ocupacao_avaria_camaras (rode create_contagem_ocupacao_avaria_camaras.sql se ainda não tiver).
-- 3) Rode este arquivo inteiro no SQL Editor.
--
-- Atenção: operação destrutiva — não há retenção parcial; todas as linhas das três tabelas são removidas.

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

  delete from public.contagem_ocupacao_avaria_camaras;
  get diagnostics n_avaria = row_count;

  analyze public.contagem_temperatura_camaras;
  analyze public.contagem_ocupacao_camaras;
  analyze public.contagem_ocupacao_avaria_camaras;

  return jsonb_build_object(
    'ran_at_utc', now(),
    'contagem_temperatura_camaras_deleted', n_temp,
    'contagem_ocupacao_camaras_deleted', n_ocup,
    'contagem_ocupacao_avaria_camaras_deleted', n_avaria
  );
end;
$$;

comment on function public.purge_contagem_ambiental_temperatura_ocupacao_mensal() is
  'Purge completo mensal: histórico de temperatura + ocupação + ocupação avaria.';

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
