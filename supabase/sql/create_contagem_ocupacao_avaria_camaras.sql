-- Legado / opcional: tabela separada de avaria. O app atual usa apenas
-- contagem_ocupacao_camaras.avaria_acrescimo_ocupacao (ver alter_contagem_ocupacao_camaras_add_avaria_acrescimo.sql).
-- Mantido para dados antigos ou purge mensal; novos lançamentos não dependem desta tabela.
--
-- Ocupação diária nas câmaras 11/12/13 — área de AVARIA legada (mesma lógica de vagas vazias que contagem_ocupacao_camaras).
-- Rode no SQL Editor do Supabase após as tabelas principais já existirem.

begin;

create table if not exists public.contagem_ocupacao_avaria_camaras (
  id uuid primary key default gen_random_uuid(),
  data_registro date not null,
  conferente_nome text not null,
  camara11_vazias integer not null check (camara11_vazias >= 0),
  camara12_vazias integer not null check (camara12_vazias >= 0),
  camara13_vazias integer not null check (camara13_vazias >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_contagem_ocupacao_avaria_data
  on public.contagem_ocupacao_avaria_camaras (data_registro desc, created_at desc);

comment on table public.contagem_ocupacao_avaria_camaras is
  'Legado: posições vazias câm. 11/12/13 — setor de avaria (tabela separada).';

alter table public.contagem_ocupacao_avaria_camaras enable row level security;

drop policy if exists "ocup_avaria_auth_all" on public.contagem_ocupacao_avaria_camaras;
drop policy if exists "ocup_avaria_anon_all" on public.contagem_ocupacao_avaria_camaras;

create policy "ocup_avaria_auth_all"
on public.contagem_ocupacao_avaria_camaras
for all
to authenticated
using (true)
with check (true);

create policy "ocup_avaria_anon_all"
on public.contagem_ocupacao_avaria_camaras
for all
to anon
using (true)
with check (true);

grant select, insert, update, delete on public.contagem_ocupacao_avaria_camaras to authenticated, anon;
grant all on public.contagem_ocupacao_avaria_camaras to service_role;

commit;
