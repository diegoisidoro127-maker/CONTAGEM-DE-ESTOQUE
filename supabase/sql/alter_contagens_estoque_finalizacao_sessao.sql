-- Agrupa cada finalização da contagem diária (mesmo conferente, mesmo dia civil).
-- Permite listar e exportar lotes separados em vez de somar numa linha só.

alter table public.contagens_estoque
  add column if not exists finalizacao_sessao_id uuid;

create index if not exists idx_contagens_estoque_finalizacao_sessao
  on public.contagens_estoque (finalizacao_sessao_id)
  where finalizacao_sessao_id is not null;

comment on column public.contagens_estoque.finalizacao_sessao_id is
  'Identificador único da finalização (várias no mesmo dia/conferente ficam separadas no relatório).';
