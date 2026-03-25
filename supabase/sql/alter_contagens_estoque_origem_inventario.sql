-- Separa registros de inventário (3 contagens por produto) da contagem diária.
-- Execute no SQL Editor do Supabase (ou via migration).

alter table public.contagens_estoque
  add column if not exists origem text default 'contagem_diaria';

alter table public.contagens_estoque
  add column if not exists inventario_repeticao smallint;

comment on column public.contagens_estoque.origem is 'contagem_diaria | inventario';
comment on column public.contagens_estoque.inventario_repeticao is '1, 2 ou 3 quando origem = inventario';

-- Linhas antigas permanecem com origem nula ou default; o app trata como contagem diária.
