-- sheet_outbox / Google Sheets: enfileirar apenas contagem diária, não inventário.
-- Rode no SQL Editor do Supabase após as migrações de origem / inventario_numero_contagem / inventario_repeticao.
--
-- Comportamento:
-- - INSERT/UPDATE/DELETE em linha de inventário (origem = 'inventario' OU repeticao/nº preenchidos): não toca sheet_outbox.
-- - Soma por (código, descrição, dia) considera só linhas sem esses marcadores de inventário.

begin;

create or replace function public.enqueue_sheet_outbox_from_contagem()
returns trigger
language plpgsql
security definer
set row_security = off
as $$
declare
  v_aba text := 'CONTAGEM DE ESTOQUE FISICA';
  v_codigo text;
  v_desc text;
  v_data_contagem date;
  v_sum numeric(18,3);
  v_event text;
  v_payload jsonb;
begin
  if (tg_op = 'DELETE') then
    if (
      coalesce(old.origem, '') = 'inventario'
      or old.inventario_repeticao is not null
      or old.inventario_numero_contagem is not null
    ) then
      return old;
    end if;
    v_codigo := old.codigo_interno;
    v_desc := old.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', old.data_hora_contagem)::date;
  else
    if (
      coalesce(new.origem, '') = 'inventario'
      or new.inventario_repeticao is not null
      or new.inventario_numero_contagem is not null
    ) then
      return new;
    end if;
    v_codigo := new.codigo_interno;
    v_desc := new.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', new.data_hora_contagem)::date;
  end if;

  select sum(c.quantidade_up)::numeric(18,3)
    into v_sum
    from public.contagens_estoque c
   where c.codigo_interno = v_codigo
     and c.descricao = v_desc
     and timezone('America/Sao_Paulo', c.data_hora_contagem)::date = v_data_contagem
     and coalesce(c.origem, '') <> 'inventario'
     and c.inventario_repeticao is null
     and c.inventario_numero_contagem is null;

  -- Soma 0: limpar célula no Sheet (evita coluna cheia de "0" onde o esperado é vazio).
  v_event := case
    when v_sum is null then 'clear_qty'
    when v_sum = 0 then 'clear_qty'
    else 'upsert'
  end;

  v_payload := jsonb_build_object(
    'codigo_interno', v_codigo,
    'descricao', v_desc,
    'data_contagem', v_data_contagem,
    'quantidade_contada', case when v_event = 'upsert' then v_sum else null end
  );

  insert into public.sheet_outbox (
    aba,
    codigo_interno,
    descricao,
    data_contagem,
    event_type,
    quantidade_contada,
    payload,
    status
  )
  values (
    v_aba,
    v_codigo,
    v_desc,
    v_data_contagem,
    v_event,
    case when v_event = 'upsert' then v_sum else null end,
    v_payload,
    'pending'
  )
  on conflict (aba, codigo_interno, descricao, data_contagem)
  do update set
    event_type = excluded.event_type,
    quantidade_contada = excluded.quantidade_contada,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    last_error = null,
    locked_at = null,
    processed_at = null,
    updated_at = now();

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

commit;
