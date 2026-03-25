-- Campo UP adicional do formulário (distinto de quantidade_up = "Quantidade contada").
-- Rode no Supabase: SQL Editor → Run.

begin;

alter table public.contagens_estoque
  add column if not exists up_adicional numeric(18,3);

commit;
