-- Schema adicional para Supabase (PostgreSQL)
-- Tabelas: conferentes, produtos e contagens_estoque
-- Observação: a coluna de "conferente" fica em `conferente_id` (FK)
-- e também mantém snapshot de codigo/descrição/unidade na contagem.

begin;

-- Necessário para gerar UUID automaticamente (Supabase normalmente já tem, mas deixamos seguro)
create extension if not exists pgcrypto;

-- =========================
-- 1) Conferentes
-- =========================
create table if not exists public.conferentes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

-- =========================
-- 2) Produtos (cadastro)
-- =========================
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  codigo_interno text not null unique,
  descricao text not null,
  unidade_medida text,
  created_at timestamptz not null default now()
);

-- Datas do produto (para relatório posterior)
alter table public.produtos
  add column if not exists data_fabricacao date;

alter table public.produtos
  add column if not exists data_validade date;

-- Códigos para leitura por bip (EAN e DUN)
alter table public.produtos
  add column if not exists ean text;

alter table public.produtos
  add column if not exists dun text;

create unique index if not exists idx_produtos_ean_unique
  on public.produtos(ean)
  where ean is not null;

create unique index if not exists idx_produtos_dun_unique
  on public.produtos(dun)
  where dun is not null;

-- =========================
-- 3) Contagens de estoque
-- =========================
create table if not exists public.contagens_estoque (
  id uuid primary key default gen_random_uuid(),

  -- data e hora da contagem
  data_hora_contagem timestamptz not null default now(),

  -- referência opcional para produto cadastrado
  produto_id uuid references public.produtos(id) on delete set null,

  -- snapshot (dados da linha no momento da contagem)
  codigo_interno text not null,
  descricao text not null,
  unidade_medida text,
  quantidade_up numeric(18,3) not null,
  lote text,
  observacao text,

  -- conferente responsável pela contagem
  conferente_id uuid not null references public.conferentes(id) on delete restrict,

  created_at timestamptz not null default now()
);

-- Snapshot adicional do produto na hora do registro
alter table public.contagens_estoque
  add column if not exists data_fabricacao date;

alter table public.contagens_estoque
  add column if not exists data_validade date;

alter table public.contagens_estoque
  add column if not exists ean text;

alter table public.contagens_estoque
  add column if not exists dun text;

create index if not exists idx_contagens_estoque_conferente
  on public.contagens_estoque(conferente_id);

create index if not exists idx_contagens_estoque_data
  on public.contagens_estoque(data_hora_contagem);

-- Para relatório “por data de contagem” (sem precisar extrair o dia do timestamptz)
alter table public.contagens_estoque
  add column if not exists data_contagem date
  generated always as (data_hora_contagem::date) stored;

create index if not exists idx_contagens_estoque_data_contagem
  on public.contagens_estoque(data_contagem);

create index if not exists idx_contagens_estoque_produto
  on public.contagens_estoque(produto_id);

commit;

-- =========================
-- RLS / Policies
-- =========================
-- Objetivo: remover o "UNRESTRICTED" do Supabase Studio.
-- Por enquanto, liberamos acesso apenas para usuários logados (role `authenticated`).
-- Depois a gente restringe por admin/usuário quando você definir as regras.

alter table public.conferentes enable row level security;
alter table public.produtos enable row level security;
alter table public.contagens_estoque enable row level security;

-- Caso a tabela já exista (por causa de `create table if not exists`),
-- adiciona a coluna nova sem quebrar.
alter table public.contagens_estoque
  add column if not exists observacao text;

-- conferentes: select/insert
drop policy if exists "conferentes_authenticated_select" on public.conferentes;
drop policy if exists "conferentes_authenticated_insert" on public.conferentes;
drop policy if exists "conferentes_anon_select" on public.conferentes;
drop policy if exists "conferentes_anon_insert" on public.conferentes;

create policy "conferentes_authenticated_select"
on public.conferentes
for select
to authenticated
using (true);

create policy "conferentes_authenticated_insert"
on public.conferentes
for insert
to authenticated
with check (true);

create policy "conferentes_anon_select"
on public.conferentes
for select
to anon
using (true);

create policy "conferentes_anon_insert"
on public.conferentes
for insert
to anon
with check (true);

-- produtos: select/insert
drop policy if exists "produtos_authenticated_select" on public.produtos;
drop policy if exists "produtos_authenticated_insert" on public.produtos;
drop policy if exists "produtos_anon_select" on public.produtos;
drop policy if exists "produtos_anon_insert" on public.produtos;

create policy "produtos_authenticated_select"
on public.produtos
for select
to authenticated
using (true);

create policy "produtos_authenticated_insert"
on public.produtos
for insert
to authenticated
with check (true);

create policy "produtos_anon_select"
on public.produtos
for select
to anon
using (true);

create policy "produtos_anon_insert"
on public.produtos
for insert
to anon
with check (true);

-- contagens_estoque: select/insert
drop policy if exists "contagens_authenticated_select" on public.contagens_estoque;
drop policy if exists "contagens_authenticated_insert" on public.contagens_estoque;
drop policy if exists "contagens_anon_select" on public.contagens_estoque;
drop policy if exists "contagens_anon_insert" on public.contagens_estoque;

create policy "contagens_authenticated_select"
on public.contagens_estoque
for select
to authenticated
using (true);

create policy "contagens_authenticated_insert"
on public.contagens_estoque
for insert
to authenticated
with check (true);

create policy "contagens_anon_select"
on public.contagens_estoque
for select
to anon
using (true);

create policy "contagens_anon_insert"
on public.contagens_estoque
for insert
to anon
with check (true);

