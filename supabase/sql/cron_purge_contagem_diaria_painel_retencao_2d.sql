-- Autoexclusão da base do painel de contagem diária (mesmo padrão dos outros cron jobs).
--
-- Importante:
-- - As views `v_contagem_diaria_painel` e `v_contagem_diaria_itens_painel` não armazenam dados.
-- - O volume vem das tabelas-base, principalmente `contagens_estoque` (origem contagem diária)
--   e `contagem_diaria_presenca`.
--
-- Este job remove dados da contagem diária com retenção de 2 dias civis (hoje + ontem),
-- preservando inventário e outros módulos.
--
-- Pré-requisito:
-- 1) Extensão pg_cron habilitada.
-- 2) Rodar este arquivo no SQL Editor do Supabase.

create extension if not exists pg_cron with schema extensions;

create or replace function public.purge_contagem_diaria_painel_antigas(
  p_keep_calendar_days integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date;
  v_today_sp date;
  n_ce bigint := 0;
  n_pr bigint := 0;
begin
  if p_keep_calendar_days < 1 then
    raise exception 'p_keep_calendar_days deve ser >= 1';
  end if;

  v_today_sp := (timezone('America/Sao_Paulo', now()))::date;
  v_cutoff := v_today_sp - (p_keep_calendar_days - 1);

  -- Base do painel (itens): remove somente contagem diária antiga.
  delete from public.contagens_estoque
  where coalesce(
      data_contagem,
      timezone('America/Sao_Paulo', data_hora_contagem)::date
    ) < v_cutoff
    and (
      coalesce(origem, '') <> 'inventario'
      and coalesce(inventario_repeticao::text, '') = ''
      and coalesce(inventario_numero_contagem::text, '') = ''
    );
  get diagnostics n_ce = row_count;

  -- Heartbeat do painel.
  delete from public.contagem_diaria_presenca
  where data_contagem < v_cutoff;
  get diagnostics n_pr = row_count;

  analyze public.contagens_estoque;
  analyze public.contagem_diaria_presenca;

  return jsonb_build_object(
    'cutoff_date', v_cutoff,
    'contagens_estoque_contagem_diaria', n_ce,
    'contagem_diaria_presenca', n_pr
  );
end;
$$;

comment on function public.purge_contagem_diaria_painel_antigas(integer) is
  'Purge diário da base do painel de contagem diária (retém hoje+ontem por padrão).';

revoke all on function public.purge_contagem_diaria_painel_antigas(integer) from public;
grant execute on function public.purge_contagem_diaria_painel_antigas(integer) to postgres;
grant execute on function public.purge_contagem_diaria_painel_antigas(integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge_contagem_diaria_painel_retencao_2d';

-- 00:10 BRT (03:10 UTC): roda após os processos de virada do dia.
select cron.schedule(
  'purge_contagem_diaria_painel_retencao_2d',
  '10 3 * * *',
  $$select public.purge_contagem_diaria_painel_antigas(2);$$
);

