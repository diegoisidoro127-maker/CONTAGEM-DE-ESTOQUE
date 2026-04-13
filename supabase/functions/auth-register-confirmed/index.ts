// Cadastro com usuário já “confirmado” no Auth (sem depender de «Confirm email» no painel).
// Usa a service role só aqui (nunca no browser). Publicar: supabase functions deploy auth-register-confirmed
//
// Variáveis automáticas no host Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Use POST' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: 'Função sem SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const nomeRaw = typeof body.nome === 'string' ? body.nome.trim() : ''
  const nome = nomeRaw || (email.includes('@') ? email.split('@')[0]! : email)

  if (!email || !email.includes('@')) {
    return jsonResponse({ ok: false, error: 'E-mail inválido' }, 400)
  }
  if (password.length < 6) {
    return jsonResponse({ ok: false, error: 'Password should be at least 6 characters' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome },
  })

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 400)
  }

  return jsonResponse({ ok: true })
})
