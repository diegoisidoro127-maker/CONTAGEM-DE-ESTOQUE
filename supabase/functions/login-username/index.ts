// Login só com username + senha. Resolve username → auth.users (e-mail interno) e devolve tokens.
//
// Publicar com verify_jwt = false (supabase/config.toml), senão preflight/CORS falha no browser:
//   supabase functions deploy login-username
//
// Painel Supabase: desative exigir JWT nesta função se publicar pela UI.
// Secrets automáticos: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js'

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

function isEmailNotConfirmed(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('email not confirmed') || m.includes('email_not_confirmed')
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
    return jsonResponse({ ok: false, error: 'Informe o nome de usuário (sem @).' }, 400)
  }
  if (!password) {
    return jsonResponse({ ok: false, error: 'Informe a senha.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: row, error: rowErr } = await admin
    .from('usuarios')
    .select('id')
    .eq('username', usernameRaw)
    .maybeSingle()

  if (rowErr || !row?.id) {
    return jsonResponse({ ok: false, error: 'Usuário ou senha incorretos.' }, 401)
  }

  const { data: authData, error: authErr } = await admin.auth.admin.getUserById(row.id)
  const email = authData.user?.email?.trim().toLowerCase()
  if (authErr || !email) {
    return jsonResponse({ ok: false, error: 'Conta inválida. Contate o suporte.' }, 400)
  }

  let signed = await anon.auth.signInWithPassword({ email, password })

  if (signed.error && isEmailNotConfirmed(signed.error.message)) {
    const { error: upErr } = await admin.auth.admin.updateUserById(row.id, { email_confirm: true })
    if (upErr) {
      return jsonResponse({ ok: false, error: upErr.message }, 400)
    }
    signed = await anon.auth.signInWithPassword({ email, password })
  }

  if (signed.error || !signed.data.session) {
    const msg = signed.error?.message || ''
    const low = msg.toLowerCase()
    if (low.includes('invalid') && low.includes('credential')) {
      return jsonResponse({ ok: false, error: 'Usuário ou senha incorretos.' }, 401)
    }
    return jsonResponse({ ok: false, error: msg || 'Não foi possível entrar.' }, 400)
  }

  return jsonResponse({
    ok: true,
    access_token: signed.data.session.access_token,
    refresh_token: signed.data.session.refresh_token,
  })
})
