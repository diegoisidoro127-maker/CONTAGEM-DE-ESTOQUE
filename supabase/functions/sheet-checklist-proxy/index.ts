// Proxy GET → Apps Script (list_items, check_date_column) para evitar CORS no navegador.
// Secret: SHEET_WEBHOOK_URL (mesma URL /exec do webhook já usada em sheet-outbox-sync).

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Use GET' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const webhookUrl = Deno.env.get('SHEET_WEBHOOK_URL')
  if (!webhookUrl?.trim()) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SHEET_WEBHOOK_URL não configurada na edge function.' }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    )
  }

  const incoming = new URL(req.url)
  const action = incoming.searchParams.get('action')

  if (action === 'list_items') {
    // ok
  } else if (action === 'check_date_column') {
    const ymd = (incoming.searchParams.get('ymd') || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return new Response(JSON.stringify({ ok: false, error: 'Parâmetro ymd inválido (use yyyy-mm-dd)' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }
  } else {
    return new Response(JSON.stringify({ ok: false, error: 'action deve ser list_items ou check_date_column' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const target = new URL(webhookUrl.trim())
  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })

  let scriptRes: Response
  try {
    scriptRes = await fetch(target.toString(), { redirect: 'follow' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ ok: false, error: `Falha ao contatar Apps Script: ${msg}` }), {
      status: 502,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const body = await scriptRes.text()
  const ct = scriptRes.headers.get('content-type') || 'application/json'
  return new Response(body, {
    status: scriptRes.status,
    headers: { ...corsHeaders, 'content-type': ct },
  })
})
