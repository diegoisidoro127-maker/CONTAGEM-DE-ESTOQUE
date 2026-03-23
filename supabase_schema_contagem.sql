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

-- Para relatório “por data de contagem”
-- Coluna gerada (`generated always`) exige expressão IMMUTABLE no PostgreSQL.
-- Como `timestamptz::date` depende de timezone, isso quebra com 42P17.
-- Solução: coluna normal + trigger.
alter table public.contagens_estoque
  drop column if exists data_contagem;

alter table public.contagens_estoque
  add column if not exists data_contagem date;

create or replace function public.set_contagens_data_contagem()
returns trigger
language plpgsql
as $$
begin
  -- Ajusta para "dia civil" no Brasil (padrão que usamos no Sheets).
  NEW.data_contagem := timezone('America/Sao_Paulo', NEW.data_hora_contagem)::date;
  return NEW;
end;
$$;

drop trigger if exists trg_set_contagens_data_contagem on public.contagens_estoque;
create trigger trg_set_contagens_data_contagem
before insert or update on public.contagens_estoque
for each row
execute function public.set_contagens_data_contagem();

create index if not exists idx_contagens_estoque_data_contagem
  on public.contagens_estoque(data_contagem);

create index if not exists idx_contagens_estoque_produto
  on public.contagens_estoque(produto_id);

commit;

-- =========================
-- 4.1) RLS no Outbox (remover UNRESTRICTED)
-- =========================
-- A tabela `sheet_outbox` é alimentada por triggers e consumida pela Edge Function
-- usando `service_role` (que normalmente bypassa RLS no Supabase).
-- Para o front-end (authenticated/anon), deixamos SEM acesso explícito.
alter table public.sheet_outbox enable row level security;

-- Remove políticas antigas, se existirem
drop policy if exists "sheet_outbox_auth_select_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_auth_insert_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_auth_update_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_auth_delete_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_anon_select_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_anon_insert_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_anon_update_none" on public.sheet_outbox;
drop policy if exists "sheet_outbox_anon_delete_none" on public.sheet_outbox;

create policy "sheet_outbox_auth_select_none"
on public.sheet_outbox
for select
to authenticated
using (false);

create policy "sheet_outbox_auth_insert_none"
on public.sheet_outbox
for insert
to authenticated
with check (false);

create policy "sheet_outbox_auth_update_none"
on public.sheet_outbox
for update
to authenticated
using (false)
with check (false);

create policy "sheet_outbox_auth_delete_none"
on public.sheet_outbox
for delete
to authenticated
using (false);

create policy "sheet_outbox_anon_select_none"
on public.sheet_outbox
for select
to anon
using (false);

create policy "sheet_outbox_anon_insert_none"
on public.sheet_outbox
for insert
to anon
with check (false);

create policy "sheet_outbox_anon_update_none"
on public.sheet_outbox
for update
to anon
using (false)
with check (false);

create policy "sheet_outbox_anon_delete_none"
on public.sheet_outbox
for delete
to anon
using (false);

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

-- contagens_estoque: update/delete
drop policy if exists "contagens_authenticated_update" on public.contagens_estoque;
drop policy if exists "contagens_authenticated_delete" on public.contagens_estoque;
drop policy if exists "contagens_anon_update" on public.contagens_estoque;
drop policy if exists "contagens_anon_delete" on public.contagens_estoque;

create policy "contagens_authenticated_update"
on public.contagens_estoque
for update
to authenticated
using (true)
with check (true);

create policy "contagens_authenticated_delete"
on public.contagens_estoque
for delete
to authenticated
using (true);

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

create policy "contagens_anon_update"
on public.contagens_estoque
for update
to anon
using (true)
with check (true);

create policy "contagens_anon_delete"
on public.contagens_estoque
for delete
to anon
using (true);

-- =========================
-- 4) Outbox para sincronizar com Google Sheets (Opção 2)
-- =========================
begin;

-- Fila de eventos para o Apps Script atualizar a planilha.
-- A regra de deduplicação é por célula lógica do Sheets:
-- (aba, codigo_interno, descricao, data_contagem)
create table if not exists public.sheet_outbox (
  id uuid primary key default gen_random_uuid(),

  -- Aba alvo na planilha do Sheets
  aba text not null default 'CONTAGEM DE ESTOQUE FISICA',

  -- Identidade do produto (linhas A/B no Sheets)
  codigo_interno text not null,
  descricao text not null,

  -- Dia civil para virar coluna (cabecalho na linha 1)
  data_contagem date not null,

  -- upsert = escreve quantidade; clear_qty = limpa célula
  event_type text not null check (event_type in ('upsert', 'clear_qty')),
  quantidade_contada numeric(18,3),

  -- Payload rastreável (opcional)
  payload jsonb not null default '{}'::jsonb,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),

  attempts int not null default 0,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (aba, codigo_interno, descricao, data_contagem)
);

create index if not exists idx_sheet_outbox_pending
  on public.sheet_outbox(status, created_at);

create or replace function public.enqueue_sheet_outbox_from_contagem()
returns trigger
language plpgsql
as $$
declare
  v_aba text := 'CONTAGEM DE ESTOQUE FISICA';
  v_codigo text;
  v_desc text;
  v_data_contagem date;
  v_sum numeric(18,3);
  v_event text;
  v_payload jsonb;
begin
  -- Em DELETE, NEW é NULL; então não podemos acessar new.*
  if (tg_op = 'DELETE') then
    v_codigo := old.codigo_interno;
    v_desc := old.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', old.data_hora_contagem)::date;
  else
    v_codigo := new.codigo_interno;
    v_desc := new.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', new.data_hora_contagem)::date;
  end if;

  -- Soma atual para garantir que DELETE (ex.: deletar duplicados) não “limpa” a célula
  -- quando ainda existe outro registro para o mesmo (codigo/descricao/dia).
  select sum(c.quantidade_up)::numeric(18,3)
    into v_sum
    from public.contagens_estoque c
   where c.codigo_interno = v_codigo
     and c.descricao = v_desc
     and timezone('America/Sao_Paulo', c.data_hora_contagem)::date = v_data_contagem;

  v_event := case when v_sum is null then 'clear_qty' else 'upsert' end;

  v_payload := jsonb_build_object(
    'codigo_interno', v_codigo,
    'descricao', v_desc,
    'data_contagem', v_data_contagem,
    'quantidade_contada', v_sum
  );

  insert into public.sheet_outbox (
    aba,
    codigo_interno,
    descricao,
    data_contagem,
    event_type,
    quantidade_contada,
    payload,
    status
  )
  values (
    v_aba,
    v_codigo,
    v_desc,
    v_data_contagem,
    v_event,
    v_sum,
    v_payload,
    'pending'
  )
  on conflict (aba, codigo_interno, descricao, data_contagem)
  do update set
    event_type = excluded.event_type,
    quantidade_contada = excluded.quantidade_contada,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    last_error = null,
    locked_at = null,
    processed_at = null,
    updated_at = now();

  -- Retorno é ignorado para triggers AFTER, mas mantemos o padrão.
  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sheet_outbox_contagens_insert on public.contagens_estoque;
create trigger trg_sheet_outbox_contagens_insert
after insert on public.contagens_estoque
for each row
execute function public.enqueue_sheet_outbox_from_contagem();

drop trigger if exists trg_sheet_outbox_contagens_update on public.contagens_estoque;
create trigger trg_sheet_outbox_contagens_update
after update on public.contagens_estoque
for each row
execute function public.enqueue_sheet_outbox_from_contagem();

drop trigger if exists trg_sheet_outbox_contagens_delete on public.contagens_estoque;
create trigger trg_sheet_outbox_contagens_delete
after delete on public.contagens_estoque
for each row
execute function public.enqueue_sheet_outbox_from_contagem();

commit;

