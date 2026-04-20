-- Acrescenta campo de avaria no mesmo lançamento de ocupação (somado ao total de ocupadas).
-- Rode no SQL Editor do Supabase após create_contagem_diaria_temperatura_ocupacao.sql

begin;

alter table public.contagem_ocupacao_camaras
  add column if not exists avaria_acrescimo_ocupacao integer not null default 0
    check (avaria_acrescimo_ocupacao >= 0);

comment on column public.contagem_ocupacao_camaras.avaria_acrescimo_ocupacao is
  'Posições de avaria somadas ao total ocupado (além do cálculo pelas vagas vazias 11/12/13).';

commit;
