// Login com correção automática de conta “não confirmada” no Auth (sem e-mail de confirmação).
// Só avança para confirmar no servidor se o GoTrue indicar erro de e-mail não confirmado
// (senha já foi validada nessa tentativa de login).
//
// Publicar: supabase functions deploy auth-login-ensure
// Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

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

function isInvalidCredentials(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('invalid login') || m.includes('invalid_credentials') || m.includes('invalid credentials')
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

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return jsonResponse({ ok: false, error: 'Informe e-mail e senha.' }, 400)
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const first = await anon.auth.signInWithPassword({ email, password })

  if (!first.error && first.data.session) {
    return jsonResponse({
      ok: true,
      access_token: first.data.session.access_token,
      refresh_token: first.data.session.refresh_token,
    })
  }

  const errMsg = first.error?.message || ''
  if (isInvalidCredentials(errMsg)) {
    return jsonResponse({ ok: false, error: errMsg }, 401)
  }

  if (!isEmailNotConfirmed(errMsg)) {
    return jsonResponse({ ok: false, error: errMsg }, 400)
  }

  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) {
    return jsonResponse({ ok: false, error: listErr.message }, 500)
  }
  const user = listData?.users?.find((x) => (x.email || '').toLowerCase() === email)
  if (!user?.id) {
    return jsonResponse({ ok: false, error: 'Usuário não encontrado.' }, 404)
  }

  const { error: upErr } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
  if (upErr) {
    return jsonResponse({ ok: false, error: upErr.message }, 500)
  }

  const second = await anon.auth.signInWithPassword({ email, password })
  if (second.error || !second.data.session) {
    return jsonResponse(
      { ok: false, error: second.error?.message || 'Login após liberação falhou.' },
      500,
    )
  }

  return jsonResponse({
    ok: true,
    access_token: second.data.session.access_token,
    refresh_token: second.data.session.refresh_token,
  })
})
