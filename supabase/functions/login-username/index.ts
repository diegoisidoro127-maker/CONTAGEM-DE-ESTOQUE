// Login só com username + senha. Ordem de tentativa de e-mail:
//1) username@internal.local (cadastro novo)
// 2) username@ultrapao.com.br (legado)
//   3) linha em usuarios + qualquer auth.users cujo local-part do e-mail = username
//
// Publicar: supabase functions deploy login-username
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js'

const INTERNAL_EMAIL_DOMAIN = 'internal.local'
const LEGACY_EMAIL_DOMAIN = 'ultrapao.com.br'

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

type SupabaseAdmin = ReturnType<typeof createClient>

async function resolveAuthUserIdForExactEmail(
  admin: SupabaseAdmin,
  usernameRaw: string,
  emailWant: string,
): Promise<string | null> {
  const { data: row } = await admin.from('usuarios').select('id').eq('username', usernameRaw).maybeSingle()
  if (row?.id) return String(row.id)

  const want = emailWant.toLowerCase()
  let page = 1
  const perPage = 1000
  for (let i = 0; i < 100; i++) {
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage })
    if (listErr || !listData?.users?.length) return null
    for (const u of listData.users) {
      if (u.email?.trim().toLowerCase() === want) return u.id
    }
    if (listData.users.length < perPage) break
    page++
  }
  return null
}

/** Qualquer conta Auth cujo e-mail seja «username@*» (útil se username na tabela estiver vazio ou desatualizado). */
async function findAuthUserIdByEmailLocalPart(admin: SupabaseAdmin, localPart: string): Promise<string | null> {
  const want = localPart.toLowerCase()
  let page = 1
  const perPage = 1000
  for (let i = 0; i < 100; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return null
    const users = data?.users ?? []
    for (const u of users) {
      const em = (u.email || '').trim().toLowerCase()
      if (!em.includes('@')) continue
      const local = em.slice(0, em.indexOf('@'))
      if (local === want) return u.id
    }
    if (users.length < perPage) break
    page++
  }
  return null
}

async function trySignInWithEmail(
  admin: SupabaseAdmin,
  anon: SupabaseAdmin,
  email: string,
  password: string,
  usernameRaw: string,
) {
  let signed = await anon.auth.signInWithPassword({ email, password })
  if (signed.error && isEmailNotConfirmed(signed.error.message)) {
    const uid = await resolveAuthUserIdForExactEmail(admin, usernameRaw, email)
    if (uid) {
      const { error: upErr } = await admin.auth.admin.updateUserById(uid, { email_confirm: true })
      if (!upErr) {
        signed = await anon.auth.signInWithPassword({ email, password })
      }
    }
  }
  return signed
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
  const emailLegacyDomain = `${usernameRaw}@${LEGACY_EMAIL_DOMAIN}`

  let signed = await trySignInWithEmail(admin, anon, emailInternal, password, usernameRaw)

  if (signed.error || !signed.data.session) {
    signed = await trySignInWithEmail(admin, anon, emailLegacyDomain, password, usernameRaw)
  }

  if (signed.error || !signed.data.session) {
    const { data: row } = await admin.from('usuarios').select('id').eq('username', usernameRaw).maybeSingle()
    if (row?.id) {
      const { data: authData, error: authErr } = await admin.auth.admin.getUserById(row.id)
      const emailFromRow = authData.user?.email?.trim()
      if (!authErr && emailFromRow) {
        const emLower = emailFromRow.toLowerCase()
        if (emLower !== emailInternal.toLowerCase() && emLower !== emailLegacyDomain.toLowerCase()) {
          signed = await trySignInWithEmail(admin, anon, emailFromRow, password, usernameRaw)
        }
      }
    }
  }

  if (signed.error || !signed.data.session) {
    const uid = await findAuthUserIdByEmailLocalPart(admin, usernameRaw)
    if (uid) {
      const { data: authData } = await admin.auth.admin.getUserById(uid)
      const em = authData.user?.email?.trim()
      if (em) {
        signed = await trySignInWithEmail(admin, anon, em, password, usernameRaw)
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
