-- Amplia grupos de armazém para 1–8 (8 abas como no Excel: 11×2, 12×2, 13×2 W/Z, 21×2 A/B).
-- Execute no SQL Editor do Supabase após a tabela já existir (substitui limites 1–4 ou 1–6).

begin;

alter table public.inventario_planilha_linhas
  drop constraint if exists inventario_planilha_linhas_grupo_armazem_chk;

alter table public.inventario_planilha_linhas
  add constraint inventario_planilha_linhas_grupo_armazem_chk
  check (grupo_armazem between 1 and 8);

alter table public.inventario_planilha_linhas
  drop constraint if exists inventario_planilha_linhas_numero_contagem_chk;

alter table public.inventario_planilha_linhas
  add constraint inventario_planilha_linhas_numero_contagem_chk
  check (numero_contagem between 1 and 8);

comment on column public.inventario_planilha_linhas.grupo_armazem is
  '1–8 conforme divisão por armazém no app (ex.: CAMARA 13 RUA W = 5 … CAMARA 21 RUA B = 8).';

comment on column public.inventario_planilha_linhas.numero_contagem is
  'Contagem do grupo (1° a 8°), alinhado ao cabeçalho da planilha.';

commit;
