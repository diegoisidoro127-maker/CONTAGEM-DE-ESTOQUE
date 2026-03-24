// Proxy GET/POST → Apps Script (list_items, check_date_column) para evitar CORS no navegador.
// Secret: SHEET_WEBHOOK_URL (mesma URL /exec do webhook já usada em sheet-outbox-sync).
// POST: body JSON { "action": "list_items" } ou { "action": "check_date_column", "ymd": "yyyy-mm-dd" }
// (o front usa POST via supabase.functions.invoke — mais estável que fetch manual no browser).

function incomingRequestUrl(req: Request): URL {
  const raw = req.url
  if (raw.startsWith('http://') || raw.startsWith('https://')) return new URL(raw)
  const host = req.headers.get('host') ?? 'localhost'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  return new URL(raw, `${proto}://${host}`)
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Use GET ou POST' }, 405)
  }

  const webhookUrl = Deno.env.get('SHEET_WEBHOOK_URL')
  if (!webhookUrl?.trim()) {
    return jsonResponse({ ok: false, error: 'SHEET_WEBHOOK_URL não configurada na edge function.' }, 500)
  }

  let action = ''
  let ymd = ''
  const paramsToForward = new URLSearchParams()

  if (req.method === 'GET') {
    let incoming: URL
    try {
      incoming = incomingRequestUrl(req)
    } catch {
      return jsonResponse({ ok: false, error: 'URL da requisição inválida' }, 400)
    }
    incoming.searchParams.forEach((v, k) => paramsToForward.set(k, v))
    action = incoming.searchParams.get('action') || ''
    ymd = (incoming.searchParams.get('ymd') || '').trim()
  } else {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido no body' }, 400)
    }
    action = typeof body.action === 'string' ? body.action : ''
    ymd = typeof body.ymd === 'string' ? body.ymd.trim() : ''
    paramsToForward.set('action', action)
    if (ymd) paramsToForward.set('ymd', ymd)
  }

  if (action === 'list_items') {
    // ok
  } else if (action === 'check_date_column') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return jsonResponse({ ok: false, error: 'Parâmetro ymd inválido (use yyyy-mm-dd)' }, 400)
    }
  } else {
    return jsonResponse({ ok: false, error: 'action deve ser list_items ou check_date_column' }, 400)
  }

  const target = new URL(webhookUrl.trim())
  paramsToForward.forEach((value, key) => {
    target.searchParams.set(key, value)
  })

  let scriptRes: Response
  try {
    scriptRes = await fetch(target.toString(), { redirect: 'follow' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ ok: false, error: `Falha ao contatar Apps Script: ${msg}` }, 502)
  }

  const bodyText = await scriptRes.text()
  const ct = scriptRes.headers.get('content-type') || 'application/json'
  return new Response(bodyText, {
    status: scriptRes.status,
    headers: { ...corsHeaders, 'content-type': ct },
  })
})
