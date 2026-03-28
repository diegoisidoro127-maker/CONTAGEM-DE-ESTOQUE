-- Datas da última alteração de EAN e de DUN no cadastro (apenas dia; fuso local do app ao salvar).
-- Compatível com instalações que já tinham apenas ean_dun_alterado_em.
-- Rode no Supabase SQL Editor após backup se necessário.

alter table public."Todos os Produtos"
  add column if not exists ean_dun_alterado_em date;

alter table public."Todos os Produtos"
  add column if not exists ean_alterado_em date;

alter table public."Todos os Produtos"
  add column if not exists dun_alterado_em date;

-- Copia valor antigo único para as duas colunas novas, onde ainda estiverem vazias.
update public."Todos os Produtos"
set
  ean_alterado_em = coalesce(ean_alterado_em, ean_dun_alterado_em),
  dun_alterado_em = coalesce(dun_alterado_em, ean_dun_alterado_em)
where ean_dun_alterado_em is not null;

comment on column public."Todos os Produtos".ean_dun_alterado_em is
  'Legado: última data em que EAN ou DUN foi alterado (YYYY-MM-DD). Preferir ean_alterado_em e dun_alterado_em.';

comment on column public."Todos os Produtos".ean_alterado_em is
  'Última data em que o EAN foi alterado no cadastro (YYYY-MM-DD).';

comment on column public."Todos os Produtos".dun_alterado_em is
  'Última data em que o DUN foi alterado no cadastro (YYYY-MM-DD).';
