-- Ajuste pontual: data de fabricação → 25/02/2026
-- Linha: CAMARA 11 · Rua V · POS 4 · Nível 4 · 1ª contagem · Pedro · 01.04.0066 · UP 22470 · qtd 70
-- Dia do inventário / contagem: 2026-03-28
--
-- Rode no SQL Editor do Supabase. Afeta contagens_estoque e inventario_planilha_linhas (mesmo registro vinculado).

begin;

update public.contagens_estoque ce
set data_fabricacao = date '2026-02-25'
from public.inventario_planilha_linhas ipl
join public.conferentes c on c.id = ipl.conferente_id
where ce.id = ipl.contagens_estoque_id
  and trim(c.nome) = 'Pedro'
  and ce.data_contagem = date '2026-03-28'
  and ipl.data_inventario = date '2026-03-28'
  and trim(ce.codigo_interno) = '01.04.0066'
  and trim(ipl.codigo_interno) = '01.04.0066'
  and ipl.grupo_armazem = 1
  and upper(trim(coalesce(ipl.rua, ''))) = 'V'
  and ipl.posicao = 4
  and ipl.nivel = 4
  and ce.quantidade_up = 70
  and ce.up_adicional is not distinct from 22470;

update public.inventario_planilha_linhas ipl
set data_fabricacao = date '2026-02-25'
from public.conferentes c
where ipl.conferente_id = c.id
  and trim(c.nome) = 'Pedro'
  and ipl.data_inventario = date '2026-03-28'
  and trim(ipl.codigo_interno) = '01.04.0066'
  and ipl.grupo_armazem = 1
  and upper(trim(coalesce(ipl.rua, ''))) = 'V'
  and ipl.posicao = 4
  and ipl.nivel = 4
  and ipl.up_quantidade is not distinct from 22470
  and ipl.quantidade = 70;

commit;
