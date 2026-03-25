-- Adiciona a coluna para armazenar a foto anexada durante a contagem.
-- A foto fica ligada ao registro inserido em public.contagens_estoque.
--
-- Rode no Supabase: SQL Editor → Run.
-- Observação: não cria tabela nova; apenas ALTER TABLE.

begin;

alter table public.contagens_estoque
  add column if not exists foto_base64 text;

commit;

