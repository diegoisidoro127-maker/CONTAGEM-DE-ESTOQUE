-- Presença em tempo quase real: quem tem sessão de contagem diária aberta no mesmo dia civil.
-- O app envia um upsert periódico (heartbeat); outros clientes listam quem está "ativo" nos últimos minutos.

create table if not exists public.contagem_diaria_presenca (
  conferente_id uuid not null references public.conferentes (id) on delete cascade,
  data_contagem date not null,
  atualizado_em timestamptz not null default now(),
  linhas_com_qtd integer,
  linhas_total integer,
  primary key (conferente_id, data_contagem)
);

create index if not exists idx_contagem_diaria_presenca_data
  on public.contagem_diaria_presenca (data_contagem);

comment on table public.contagem_diaria_presenca is
  'Heartbeat por conferente e dia da contagem diária (checklist aberta). Usado só para exibir quem está contando.';

alter table public.contagem_diaria_presenca enable row level security;

drop policy if exists "contagem_presenca_authenticated_select" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_authenticated_insert" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_authenticated_update" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_authenticated_delete" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_anon_select" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_anon_insert" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_anon_update" on public.contagem_diaria_presenca;
drop policy if exists "contagem_presenca_anon_delete" on public.contagem_diaria_presenca;

create policy "contagem_presenca_authenticated_select"
on public.contagem_diaria_presenca for select to authenticated using (true);

create policy "contagem_presenca_authenticated_insert"
on public.contagem_diaria_presenca for insert to authenticated with check (true);

create policy "contagem_presenca_authenticated_update"
on public.contagem_diaria_presenca for update to authenticated using (true) with check (true);

create policy "contagem_presenca_authenticated_delete"
on public.contagem_diaria_presenca for delete to authenticated using (true);

create policy "contagem_presenca_anon_select"
on public.contagem_diaria_presenca for select to anon using (true);

create policy "contagem_presenca_anon_insert"
on public.contagem_diaria_presenca for insert to anon with check (true);

create policy "contagem_presenca_anon_update"
on public.contagem_diaria_presenca for update to anon using (true) with check (true);

create policy "contagem_presenca_anon_delete"
on public.contagem_diaria_presenca for delete to anon using (true);
