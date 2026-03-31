-- Ajuste complementar da base "Todos os Produtos" para alinhar com a lista oficial enviada.
-- Foco: códigos faltantes e divergências que impactam Contagem diária / Inventário.
--
-- Pode rodar no SQL Editor do Supabase.

begin;

-- 1) Normaliza código com trim (evita falha em join/busca por espaços).
update public."Todos os Produtos"
set codigo_interno = trim(both from codigo_interno)
where codigo_interno is not null
  and codigo_interno <> trim(both from codigo_interno);

-- 2) Upsert dos códigos que estavam faltando / divergentes.
create temporary table _stg_ajuste (
  codigo_interno text primary key,
  descricao text not null,
  unidade text not null
) on commit drop;

insert into _stg_ajuste (codigo_interno, descricao, unidade) values
  ('01.04.0028', 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO DE REQUEIJAO ST MARCHE 65G - 20 PCTS DE 400G', 'CX'),
  ('01.04.0068', 'MASSA CONGELADA DE PAO DE QUEIJO COQUETEL EMPANADO - CX 10KG - 5 UN', 'CX'),
  ('02.02.0046', 'EMPADA DE FRANGO MASSA TUNG C/ 12 UND CAIXA C/ 6 PCTS', 'CX');

-- Atualiza descrição.
update public."Todos os Produtos" t
set descricao = s.descricao
from _stg_ajuste s
where trim(both from t.codigo_interno) = s.codigo_interno
  and coalesce(t.descricao, '') <> s.descricao;

-- Atualiza unidade (compatível com esquema unidade/unidade_medida).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade'
  ) then
    update public."Todos os Produtos" t
    set unidade = s.unidade
    from _stg_ajuste s
    where trim(both from t.codigo_interno) = s.codigo_interno
      and coalesce(t.unidade, '') <> s.unidade;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade_medida'
  ) then
    update public."Todos os Produtos" t
    set unidade_medida = s.unidade
    from _stg_ajuste s
    where trim(both from t.codigo_interno) = s.codigo_interno
      and coalesce(t.unidade_medida, '') <> s.unidade;
  end if;
end $$;

-- Insere os códigos ausentes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade'
  ) then
    insert into public."Todos os Produtos" (codigo_interno, descricao, unidade)
    select s.codigo_interno, s.descricao, s.unidade
    from _stg_ajuste s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade_medida'
  ) then
    insert into public."Todos os Produtos" (codigo_interno, descricao, unidade_medida)
    select s.codigo_interno, s.descricao, s.unidade
    from _stg_ajuste s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  else
    insert into public."Todos os Produtos" (codigo_interno, descricao)
    select s.codigo_interno, s.descricao
    from _stg_ajuste s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  end if;
end $$;

-- 3) Remove código obsoleto que não está mais na lista oficial enviada.
delete from public."Todos os Produtos"
where trim(both from codigo_interno) = '01.06.0030';

commit;

-- Conferência rápida (rode separado, se quiser):
-- select codigo_interno, descricao, unidade
-- from public."Todos os Produtos"
-- where trim(both from codigo_interno) in ('01.04.0028','01.04.0068','02.02.0046','01.06.0030')
-- order by codigo_interno;

