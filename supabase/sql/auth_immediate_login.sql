-- Libera contas antigas (auth.users.email_confirmed_at nulo) em lote.
-- =============================================================================
-- Preferência: publicar a edge function `auth-login-ensure` — no login o app confirma
-- automaticamente quando a senha estiver correta (sem precisar deste SQL por usuário).
--
-- Use este script se quiser liberar todos de uma vez no SQL Editor, ou se a função não
-- estiver publicada.
-- Novos cadastros: edge `auth-register-confirmed` (usuário já confirmado).
-- =============================================================================

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- Opcional: só um usuário (ajuste o e-mail montado pelo app, ex. usuario@ultrapao.com.br)
-- update auth.users
-- set email_confirmed_at = now()
-- where email = 'diego.isidoro@ultrapao.com.br' and email_confirmed_at is null;
