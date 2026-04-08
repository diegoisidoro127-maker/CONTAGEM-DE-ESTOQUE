-- Habilita Realtime na tabela `contagens_estoque` (atualizações visíveis para todos os conferentes).
-- Execute no SQL Editor do Supabase (ou via migração) uma vez por projeto.
-- Documentação: https://supabase.com/docs/guides/realtime/postgres-changes

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'contagens_estoque'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contagens_estoque;
  END IF;
END $$;
