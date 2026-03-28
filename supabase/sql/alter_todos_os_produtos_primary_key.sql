-- Garante chave primária em public."Todos os Produtos".id e preenche id NULL.
-- Sem PK o Table Editor do Supabase não permite excluir/editar linhas ("table has no primary keys").
-- Inserções só (codigo_interno, descricao) podem deixar id NULL se não houver SERIAL/default.
--
-- Rode no Supabase: SQL Editor → Run (uma vez).
--
-- Se DELETE com codigo_interno = '…' afetar 0 linhas, normalize espaços com
-- normalize_todos_os_produtos_codigo_trim.sql ou use where trim(both from codigo_interno) = '…'.

begin;

do $$
declare
  seq_name text;
begin
  select pg_get_serial_sequence('public."Todos os Produtos"', 'id') into seq_name;

  if seq_name is null then
    create sequence if not exists public."Todos os Produtos_id_seq";
    alter table public."Todos os Produtos"
      alter column id set default nextval('public."Todos os Produtos_id_seq"'::regclass);
    perform setval(
      'public."Todos os Produtos_id_seq"'::regclass,
      coalesce((select max(id) from public."Todos os Produtos" where id is not null), 0),
      true
    );
    alter sequence public."Todos os Produtos_id_seq" owned by public."Todos os Produtos".id;
  else
    -- Sobe o contador da sequência existente para não colidir com ids já usados
    execute format(
      'select setval(%L::regclass, (select coalesce(max(id), 0) from public."Todos os Produtos"), true)',
      seq_name
    );
  end if;
end $$;

-- Uma linha por valor novo da sequência
update public."Todos os Produtos"
set id = nextval(pg_get_serial_sequence('public."Todos os Produtos"', 'id')::regclass)
where id is null;

alter table public."Todos os Produtos"
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on c.conrelid = r.oid
    join pg_namespace n on r.relnamespace = n.oid
    where n.nspname = 'public'
      and r.relname = 'Todos os Produtos'
      and c.contype = 'p'
  ) then
    alter table public."Todos os Produtos" add primary key (id);
  end if;
end $$;

commit;
