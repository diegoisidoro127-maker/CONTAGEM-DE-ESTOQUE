-- Opcional: ao excluir um registro em `contagens_estoque`, remove a linha espelhada em `inventario_planilha_linhas`
-- (em vez de só anular `contagens_estoque_id` com ON DELETE SET NULL).
-- O app já apaga explicitamente em `inventarioPlanilhaLinhasDelete.ts`; este script alinha o banco.

begin;

alter table public.inventario_planilha_linhas
  drop constraint if exists inventario_planilha_linhas_contagens_estoque_id_fkey;

alter table public.inventario_planilha_linhas
  add constraint inventario_planilha_linhas_contagens_estoque_id_fkey
  foreign key (contagens_estoque_id) references public.contagens_estoque (id) on delete cascade;

commit;
