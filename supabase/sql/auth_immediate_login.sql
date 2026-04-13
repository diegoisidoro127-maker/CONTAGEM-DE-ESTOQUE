-- Login imediato só com usuário + senha (sem confirmação por e-mail)
-- =============================================================================
-- Passo 1 — Painel Supabase (obrigatório para novos cadastros)
--   Authentication → Providers → Email
--   Desligar "Confirm email" / "Confirmar e-mail" e salvar.
--   Assim, após cadastrar, o app já recebe sessão e o usuário pode entrar na hora.
--
-- Passo 2 — Contas criadas ANTES dessa mudança (ficaram sem confirmar)
--   Rode o bloco abaixo no SQL Editor (uma vez, ou só para quem precisar).
-- =============================================================================

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- Opcional: só um usuário (ajuste o e-mail montado pelo app, ex. usuario@ultrapao.com.br)
-- update auth.users
-- set email_confirmed_at = now()
-- where email = 'diego.isidoro@ultrapao.com.br' and email_confirmed_at is null;
