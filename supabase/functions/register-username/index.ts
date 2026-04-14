// Cadastro só com username + senha. E-mail interno: username@internal.local (nunca mostrado no front).
// Publicar: supabase functions deploy register-username
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js'

const INTERNAL_EMAIL_DOMAIN = 'internal.local'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Use POST' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ ok: false, error: 'Função sem variáveis SUPABASE_*' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, 400)
  }

  const usernameRaw = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!usernameRaw || usernameRaw.includes('@')) {
    return jsonResponse({ ok: false, error: 'Use um nome de usuário sem @.' }, 400)
  }
  if (usernameRaw.length < 2) {
    return jsonResponse({ ok: false, error: 'O nome de usuário deve ter pelo menos 2 caracteres.' }, 400)
  }
  if (!/^[a-z0-9._-]+$/.test(usernameRaw)) {
    return jsonResponse(
      { ok: false, error: 'Use apenas letras minúsculas, números, ponto, traço ou sublinhado.' },
      400,
    )
  }
  if (password.length < 6) {
    return jsonResponse({ ok: false, error: 'A senha deve ter pelo menos 6 caracteres.' }, 400)
  }

  const email = `${usernameRaw}@${INTERNAL_EMAIL_DOMAIN}`

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome: usernameRaw, username: usernameRaw },
  })

  if (createErr) {
    return jsonResponse({ ok: false, error: createErr.message }, 400)
  }

  const userId = created.user?.id
  if (userId) {
    await admin.from('usuarios').update({ username: usernameRaw }).eq('id', userId)
  }

  const signed = await anon.auth.signInWithPassword({ email, password })
  if (!signed.error && signed.data.session) {
    return jsonResponse({
      ok: true,
      access_token: signed.data.session.access_token,
      refresh_token: signed.data.session.refresh_token,
    })
  }

  return jsonResponse(
    {
      ok: false,
      error: signed.error?.message || 'Conta criada, mas nao foi possivel abrir a sessao. Use Entrar.',
    },
    500,
  )
})
