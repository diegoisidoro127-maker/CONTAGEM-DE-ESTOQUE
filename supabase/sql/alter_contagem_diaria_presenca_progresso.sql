-- Progresso agregado na presença (outros usuários veem X/Y linhas, sem ver produtos).
-- Execute após create_contagem_diaria_presenca.sql

alter table public.contagem_diaria_presenca
  add column if not exists linhas_com_qtd integer;

alter table public.contagem_diaria_presenca
  add column if not exists linhas_total integer;

comment on column public.contagem_diaria_presenca.linhas_com_qtd is
  'Quantidade de linhas da checklist com quantidade preenchida (snapshot no último heartbeat).';

comment on column public.contagem_diaria_presenca.linhas_total is
  'Total de linhas da checklist na sessão (snapshot no último heartbeat).';
