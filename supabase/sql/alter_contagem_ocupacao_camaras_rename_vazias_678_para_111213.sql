-- Renomeia colunas de vagas vazias: câmaras 6/7/8 → 11/12/13 (alinhado à temperatura).
-- Rode uma vez no SQL Editor se a tabela ainda tiver camara6_vazias, camara7_vazias, camara8_vazias.
-- Se já estiver com 11/12/13, o bloco abaixo não altera nada.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contagem_ocupacao_camaras'
      and column_name = 'camara6_vazias'
  ) then
    alter table public.contagem_ocupacao_camaras rename column camara6_vazias to camara11_vazias;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contagem_ocupacao_camaras'
      and column_name = 'camara7_vazias'
  ) then
    alter table public.contagem_ocupacao_camaras rename column camara7_vazias to camara12_vazias;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contagem_ocupacao_camaras'
      and column_name = 'camara8_vazias'
  ) then
    alter table public.contagem_ocupacao_camaras rename column camara8_vazias to camara13_vazias;
  end if;
end $$;

commit;
