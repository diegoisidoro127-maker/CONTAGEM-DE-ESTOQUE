-- Ajusta a view para respeitar o contexto do usuário (RLS/permissions),
-- removendo o comportamento "unrestricted" no Dashboard do Supabase.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_views
    where schemaname = 'public'
      and viewname = 'v_contagem_diaria_painel'
  ) then
    execute 'alter view public.v_contagem_diaria_painel set (security_invoker = true)';
  end if;
end
$$;

