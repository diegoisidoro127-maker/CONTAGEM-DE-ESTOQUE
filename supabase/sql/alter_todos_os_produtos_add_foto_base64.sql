-- Adiciona colunas necessárias para:
-- 1) Leitura por DUN/EAN (bipador) usando public."Todos os Produtos"
-- 2) Foto do produto (foto_base64) para aparecer na checklist
--
-- Rode no Supabase: SQL Editor → Run.
-- Observação: não cria tabela nova (apenas ALTER TABLE).

begin;

alter table public."Todos os Produtos"
  add column if not exists ean text;

alter table public."Todos os Produtos"
  add column if not exists dun text;

alter table public."Todos os Produtos"
  add column if not exists foto_base64 text;

commit;

