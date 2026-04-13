-- Libera contas antigas que foram criadas com confirmação de e-mail e nunca confirmaram.
-- =============================================================================
-- Novos cadastros pelo app usam a edge function `auth-register-confirmed` (admin API com
-- e-mail já confirmado) — não precisa desligar «Confirm email» no painel.
--
-- Use este SQL só para usuários que já existem em auth.users com email_confirmed_at nulo
-- (ex.: criados antes da edge function ou por outro fluxo).
-- =============================================================================

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- Opcional: só um usuário (ajuste o e-mail montado pelo app, ex. usuario@ultrapao.com.br)
-- update auth.users
-- set email_confirmed_at = now()
-- where email = 'diego.isidoro@ultrapao.com.br' and email_confirmed_at is null;
