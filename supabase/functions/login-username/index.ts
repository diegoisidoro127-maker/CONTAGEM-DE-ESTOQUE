// Login só com username + senha. E-mail interno: username@internal.local (igual ao cadastro).
//
// Publicar com verify_jwt = false (supabase/config.toml), senão preflight/CORS falha no browser:
//   supabase functions deploy login-username
//
// Painel Supabase: desative exigir JWT nesta função se publicar pela UI.
// Secrets automáticos: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

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

function isEmailNotConfirmed(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('email not confirmed') || m.includes('email_not_confirmed')
}

async function resolveAuthUserIdForUsername(
  admin: ReturnType<typeof createClient>,
  usernameRaw: string,
  emailInternal: string,
): Promise<string | null> {
  const { data: row } = await admin.from('usuarios').select('id').eq('username', usernameRaw).maybeSingle()
  if (row?.id) return String(row.id)

  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr || !listData?.users?.length) return null
  const want = emailInternal.toLowerCase()
  for (const u of listData.users) {
    if (u.email?.trim().toLowerCase() === want) return u.id
  }
  return null
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

  const emailInternal = `${usernameRaw}@${INTERNAL_EMAIL_DOMAIN}`

  let signed = await anon.auth.signInWithPassword({ email: emailInternal, password })

  if (signed.error && isEmailNotConfirmed(signed.error.message)) {
    const uid = await resolveAuthUserIdForUsername(admin, usernameRaw, emailInternal)
    if (uid) {
      const { error: upErr } = await admin.auth.admin.updateUserById(uid, { email_confirm: true })
      if (!upErr) {
        signed = await anon.auth.signInWithPassword({ email: emailInternal, password })
      }
    }
  }

  if (signed.error || !signed.data.session) {
    const { data: row } = await admin.from('usuarios').select('id').eq('username', usernameRaw).maybeSingle()
    if (row?.id) {
      const { data: authData, error: authErr } = await admin.auth.admin.getUserById(row.id)
      const emailLegacy = authData.user?.email?.trim().toLowerCase()
      if (!authErr && emailLegacy && emailLegacy !== emailInternal) {
        signed = await anon.auth.signInWithPassword({ email: emailLegacy, password })
        if (signed.error && isEmailNotConfirmed(signed.error.message)) {
          await admin.auth.admin.updateUserById(row.id, { email_confirm: true })
          signed = await anon.auth.signInWithPassword({ email: emailLegacy, password })
        }
      }
    }
  }

  if (signed.error || !signed.data.session) {
    const msg = signed.error?.message || ''
    const low = msg.toLowerCase()
    if (low.includes('invalid') && (low.includes('credential') || low.includes('login'))) {
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
