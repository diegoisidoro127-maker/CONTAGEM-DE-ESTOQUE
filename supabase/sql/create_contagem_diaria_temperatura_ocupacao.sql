-- Dados operacionais da contagem diária:
-- 1) Temperatura das câmaras 11/12/13
-- 2) Ocupação (vagas vazias) das câmaras 6/7/8
--
-- Rode no SQL Editor do Supabase.

begin;

create table if not exists public.contagem_temperatura_camaras (
  id uuid primary key default gen_random_uuid(),
  data_registro date not null,
  conferente_nome text not null,
  camara11_temp numeric(6,2) not null,
  camara12_temp numeric(6,2) not null,
  camara13_temp numeric(6,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_contagem_temperatura_camaras_data
  on public.contagem_temperatura_camaras (data_registro desc, created_at desc);

comment on table public.contagem_temperatura_camaras is
  'Temperatura diária das câmaras 11, 12 e 13.';

create table if not exists public.contagem_ocupacao_camaras (
  id uuid primary key default gen_random_uuid(),
  data_registro date not null,
  conferente_nome text not null,
  camara6_vazias integer not null check (camara6_vazias >= 0),
  camara7_vazias integer not null check (camara7_vazias >= 0),
  camara8_vazias integer not null check (camara8_vazias >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_contagem_ocupacao_camaras_data
  on public.contagem_ocupacao_camaras (data_registro desc, created_at desc);

comment on table public.contagem_ocupacao_camaras is
  'Posições vazias por câmara no fechamento diário.';

alter table public.contagem_temperatura_camaras enable row level security;
alter table public.contagem_ocupacao_camaras enable row level security;

drop policy if exists "temp_cam_auth_all" on public.contagem_temperatura_camaras;
drop policy if exists "temp_cam_anon_all" on public.contagem_temperatura_camaras;
drop policy if exists "ocup_cam_auth_all" on public.contagem_ocupacao_camaras;
drop policy if exists "ocup_cam_anon_all" on public.contagem_ocupacao_camaras;

create policy "temp_cam_auth_all"
on public.contagem_temperatura_camaras
for all
to authenticated
using (true)
with check (true);

create policy "temp_cam_anon_all"
on public.contagem_temperatura_camaras
for all
to anon
using (true)
with check (true);

create policy "ocup_cam_auth_all"
on public.contagem_ocupacao_camaras
for all
to authenticated
using (true)
with check (true);

create policy "ocup_cam_anon_all"
on public.contagem_ocupacao_camaras
for all
to anon
using (true)
with check (true);

grant select, insert, update, delete on public.contagem_temperatura_camaras to authenticated, anon;
grant select, insert, update, delete on public.contagem_ocupacao_camaras to authenticated, anon;
grant all on public.contagem_temperatura_camaras to service_role;
grant all on public.contagem_ocupacao_camaras to service_role;

commit;
