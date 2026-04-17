-- Limpeza automática de dados operacionais (retenção em dias civis, America/Sao_Paulo).
--
-- Tabelas afetadas:
--   - public.contagens_estoque
--   - public.inventario_planilha_linhas (por data_inventario)
--   - public.sheet_outbox (fila Google Sheets, por data_contagem)
--   - public.contagem_diaria_presenca
--
-- Opcional na mesma rotina: zera foto_base64 em contagens com data < hoje (alinha ao recorte:
-- mantém fotos só no dia atual nas linhas que ainda existem — reduz muito o tamanho da tabela).
--
-- Não altera: "Todos os Produtos", produtos, usuários, conferentes, auth.
--
-- Como usar:
-- 1) Supabase → Database → Extensions → ative "pg_cron".
-- 2) Rode este arquivo inteiro no SQL Editor.
--
-- Agendamento: todo dia às 00:05 horário de Brasília → cron UTC '5 3 * * *'.
-- p_keep_calendar_days = 2 → mantém hoje + ontem; remove o mais antigo (e limpa fotos de dias < hoje).

create extension if not exists pg_cron with schema extensions;

create or replace function public.purge_dados_operacionais_antigas(
  p_keep_calendar_days integer default 2,
  p_strip_foto_base64_antes_de_hoje boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date;
  v_today_sp date;
  n_inv bigint := 0;
  n_ce bigint := 0;
  n_so bigint := 0;
  n_pr bigint := 0;
  n_strip bigint := 0;
begin
  if p_keep_calendar_days < 1 then
    raise exception 'p_keep_calendar_days deve ser >= 1';
  end if;

  v_today_sp := (timezone('America/Sao_Paulo', now()))::date;
  v_cutoff := v_today_sp - (p_keep_calendar_days - 1);

  delete from public.inventario_planilha_linhas
  where data_inventario < v_cutoff;
  get diagnostics n_inv = row_count;

  delete from public.contagens_estoque
  where coalesce(
      data_contagem,
      timezone('America/Sao_Paulo', data_hora_contagem)::date
    ) < v_cutoff;
  get diagnostics n_ce = row_count;

  delete from public.sheet_outbox
  where data_contagem < v_cutoff;
  get diagnostics n_so = row_count;

  delete from public.contagem_diaria_presenca
  where data_contagem < v_cutoff;
  get diagnostics n_pr = row_count;

  if p_strip_foto_base64_antes_de_hoje then
    update public.contagens_estoque
    set foto_base64 = null
    where foto_base64 is not null
      and coalesce(
        data_contagem,
        timezone('America/Sao_Paulo', data_hora_contagem)::date
      ) < v_today_sp;
    get diagnostics n_strip = row_count;
  end if;

  analyze public.inventario_planilha_linhas;
  analyze public.contagens_estoque;
  analyze public.sheet_outbox;
  analyze public.contagem_diaria_presenca;

  return jsonb_build_object(
    'cutoff_date', v_cutoff,
    'inventario_planilha_linhas', n_inv,
    'contagens_estoque', n_ce,
    'sheet_outbox', n_so,
    'contagem_diaria_presenca', n_pr,
    'foto_base64_nulled_rows', n_strip
  );
end;
$$;

comment on function public.purge_dados_operacionais_antigas(integer, boolean) is
  'Purge operacional + opcionalmente remove foto_base64 de contagens com data anterior ao dia atual.';

revoke all on function public.purge_dados_operacionais_antigas(integer, boolean) from public;
grant execute on function public.purge_dados_operacionais_antigas(integer, boolean) to postgres;
grant execute on function public.purge_dados_operacionais_antigas(integer, boolean) to service_role;

-- Compatível com chamadas antigas: devolve só linhas removidas em contagens_estoque.
create or replace function public.purge_contagens_estoque_antigas(p_keep_calendar_days integer default 2)
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (public.purge_dados_operacionais_antigas(p_keep_calendar_days, true)->>'contagens_estoque')::bigint,
    0
  );
$$;

comment on function public.purge_contagens_estoque_antigas(integer) is
  'Wrapper: purge completo; retorno = apenas contagens_estoque removidas.';

revoke all on function public.purge_contagens_estoque_antigas(integer) from public;
grant execute on function public.purge_contagens_estoque_antigas(integer) to postgres;
grant execute on function public.purge_contagens_estoque_antigas(integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge_contagens_estoque_retencao_2d';

select cron.schedule(
  'purge_contagens_estoque_retencao_2d',
  '5 3 * * *',
  $$select public.purge_dados_operacionais_antigas(2, true);$$
);
