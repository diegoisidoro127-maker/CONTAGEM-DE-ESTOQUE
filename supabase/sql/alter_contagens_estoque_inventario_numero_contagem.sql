-- Rodada da contagem física no inventário (1ª a 4ª), independente da aba CAMARA/RUA.
-- Execute no SQL Editor do Supabase.

begin;

alter table public.contagens_estoque
  add column if not exists inventario_numero_contagem smallint;

comment on column public.contagens_estoque.inventario_numero_contagem is
  'Quando origem = inventario: qual das 4 contagens da rodada (1–4). Usado em relatórios por data e número da contagem.';

alter table public.contagens_estoque
  drop constraint if exists contagens_estoque_inventario_numero_contagem_chk;

alter table public.contagens_estoque
  add constraint contagens_estoque_inventario_numero_contagem_chk
  check (inventario_numero_contagem is null or inventario_numero_contagem between 1 and 4);

commit;
