-- Tabela dedicada ao inventário físico no layout da planilha (CONTAGEM DE INVENTARIO.xlsx).
-- Campos: RUA, POS, NIVEL, grupo de armazém, número da contagem (1ª–4ª), produto, quantidades, lote/UP, datas.
-- Opcionalmente referencia `contagens_estoque` quando a linha for espelhada a partir do registro oficial.
--
-- Execute no SQL Editor do Supabase (projeto já deve ter `conferentes`, `produtos`, `contagens_estoque`).

begin;

create extension if not exists pgcrypto;

create table if not exists public.inventario_planilha_linhas (
  id uuid primary key default gen_random_uuid(),

  created_at timestamptz not null default now(),

  conferente_id uuid not null references public.conferentes (id) on delete restrict,

  -- Dia civil do inventário (alinhado a `data_contagem` / uso no Brasil).
  data_inventario date not null,

  -- Grupo armazém 1–4 (abas / CAMARA + RUA na planilha).
  grupo_armazem smallint not null,
  constraint inventario_planilha_linhas_grupo_armazem_chk check (grupo_armazem between 1 and 4),

  -- Colunas de posição como na planilha (ex.: RUA V/U/X/Y).
  rua text,
  posicao integer not null default 1,
  nivel integer not null default 1,

  -- Qual contagem do grupo (rótulo tipo 1° / 2° / 3° / 4° CONTAGEM).
  numero_contagem smallint not null,
  constraint inventario_planilha_linhas_numero_contagem_chk check (numero_contagem between 1 and 4),

  codigo_interno text not null,
  descricao text not null,

  -- 1ª, 2ª ou 3ª repetição do mesmo código na sessão de inventário (quando aplicável).
  inventario_repeticao smallint,
  constraint inventario_planilha_linhas_inventario_repeticao_chk
    check (inventario_repeticao is null or inventario_repeticao between 1 and 3),

  quantidade numeric(18, 3),
  data_fabricacao date,
  data_validade date,
  lote text,
  up_quantidade numeric(18, 3),
  observacao text,

  produto_id uuid references public.produtos (id) on delete set null,

  -- Vínculo opcional com o registro canônico em `contagens_estoque` (origem = inventario).
  contagens_estoque_id uuid references public.contagens_estoque (id) on delete set null
);

comment on table public.inventario_planilha_linhas is
  'Linhas do inventário físico no formato da planilha (RUA, POS, NIVEL, grupo armazém, contagem).';

comment on column public.inventario_planilha_linhas.grupo_armazem is
  '1–4 conforme divisão por armazém no app (ex.: CAMARA 11 RUA V = 1).';

comment on column public.inventario_planilha_linhas.numero_contagem is
  'Qual contagem do grupo (1° a 4°), alinhado ao cabeçalho da planilha.';

comment on column public.inventario_planilha_linhas.contagens_estoque_id is
  'Opcional: FK para o registro correspondente em contagens_estoque, se a linha for derivada dele.';

create index if not exists idx_inventario_planilha_data_grupo
  on public.inventario_planilha_linhas (data_inventario, grupo_armazem);

create index if not exists idx_inventario_planilha_conferente
  on public.inventario_planilha_linhas (conferente_id);

create index if not exists idx_inventario_planilha_codigo
  on public.inventario_planilha_linhas (codigo_interno);

create index if not exists idx_inventario_planilha_contagens_fk
  on public.inventario_planilha_linhas (contagens_estoque_id)
  where contagens_estoque_id is not null;

-- RLS (mesmo padrão de `contagens_estoque`: anon + authenticated com CRUD liberado até regras futuras).
alter table public.inventario_planilha_linhas enable row level security;

drop policy if exists "inventario_planilha_auth_select" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_auth_insert" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_auth_update" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_auth_delete" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_anon_select" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_anon_insert" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_anon_update" on public.inventario_planilha_linhas;
drop policy if exists "inventario_planilha_anon_delete" on public.inventario_planilha_linhas;

create policy "inventario_planilha_auth_select"
  on public.inventario_planilha_linhas for select to authenticated using (true);

create policy "inventario_planilha_auth_insert"
  on public.inventario_planilha_linhas for insert to authenticated with check (true);

create policy "inventario_planilha_auth_update"
  on public.inventario_planilha_linhas for update to authenticated using (true) with check (true);

create policy "inventario_planilha_auth_delete"
  on public.inventario_planilha_linhas for delete to authenticated using (true);

create policy "inventario_planilha_anon_select"
  on public.inventario_planilha_linhas for select to anon using (true);

create policy "inventario_planilha_anon_insert"
  on public.inventario_planilha_linhas for insert to anon with check (true);

create policy "inventario_planilha_anon_update"
  on public.inventario_planilha_linhas for update to anon using (true) with check (true);

create policy "inventario_planilha_anon_delete"
  on public.inventario_planilha_linhas for delete to anon using (true);

commit;
