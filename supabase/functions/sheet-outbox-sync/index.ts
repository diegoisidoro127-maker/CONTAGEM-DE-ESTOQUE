import { createClient } from 'npm:@supabase/supabase-js'

// Edge Function: processa a tabela `public.sheet_outbox` e grava no Google Sheets via Apps Script (/exec).
// Também atua como proxy de leitura GET/POST ?action=list_items | check_date_column (mesmo SHEET_WEBHOOK_URL),
// para o front usar o mesmo slug que já funciona (ex.: dynamic-endpoint).
//
// Variáveis de ambiente esperadas:
// - SUPABASE_URL (ou DB_URL)
// - SUPABASE_SERVICE_ROLE_KEY (ou DB_SERVICE_ROLE_KEY)
// - SHEET_WEBHOOK_URL (URL do Apps Script terminando em /exec)

type OutboxRow = {
  id: string
  status: string
  attempts: number
  event_type: 'upsert' | 'clear_qty'
  aba: string
  codigo_interno: string
  descricao: string
  data_contagem: string
  quantidade_contada: number | null
  last_error: string | null
}

const supabaseUrl = Deno.env.get('DB_URL') ?? Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('DB_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
/** URL do Web App (/exec); se vazia, a fila não pode ser drenada (erro explícito). */
const webhookUrlRaw = (Deno.env.get('SHEET_WEBHOOK_URL') ?? '').trim()

const supabase = createClient(supabaseUrl, serviceRoleKey)

// Lotes maiores = menos voltas edge↔webhook; o Apps Script agora consolida a planilha 1× por lote (não por linha).
const batchSize = Number(Deno.env.get('OUTBOX_BATCH_SIZE') ?? '80')
const maxAttempts = Number(Deno.env.get('OUTBOX_MAX_ATTEMPTS') ?? '5')

/**
 * Mantém zero explícito para o Apps Script não tratar como "vazio".
 * Retorna string numérica ("0", "12.5", etc) para evitar checagem falsy de number.
 */
function quantidadeAsText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '0'
  const n = Number(v)
  if (Object.is(n, -0)) return '0'
  return String(n)
}

/** Mesmo dia civil do Postgres (coluna `date`) vira sempre `yyyy-mm-dd` — evita dois grupos/POSTs para o mesmo dia. */
function normalizeDataContagemToYmd(v: unknown): string {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  return ''
}

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

function jsonWithCors(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/** POST JSON com action=list_items | check_date_column → repassa ao doGet do Apps Script (body lido uma vez no handler). */
async function forwardChecklistFromPostBody(parsed: Record<string, unknown>): Promise<Response | null> {
  const action = typeof parsed.action === 'string' ? parsed.action : ''
  if (!action) return null
  if (action !== 'list_items' && action !== 'check_date_column') return null
  const ymd = typeof parsed.ymd === 'string' ? parsed.ymd.trim() : ''
  if (action === 'check_date_column' && !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return jsonWithCors({ ok: false, error: 'Parâmetro ymd inválido (use yyyy-mm-dd)' }, 400)
  }
  if (!webhookUrlRaw) {
    return jsonWithCors({ ok: false, error: 'SHEET_WEBHOOK_URL não configurada na edge function.' }, 500)
  }
  const target = new URL(webhookUrlRaw)
  target.searchParams.set('action', action)
  if (ymd) target.searchParams.set('ymd', ymd)
  try {
    const scriptRes = await fetch(target.toString(), { redirect: 'follow' })
    const bodyText = await scriptRes.text()
    const ct = scriptRes.headers.get('content-type') || 'application/json'
    return new Response(bodyText, {
      status: scriptRes.status,
      headers: { ...corsHeaders, 'content-type': ct },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonWithCors({ ok: false, error: `Falha ao contatar Apps Script: ${msg}` }, 502)
  }
}

/** Proxy checklist → Apps Script (doGet). Só GET (POST consome body uma vez em Deno.serve). */
async function tryChecklistProxyGet(req: Request): Promise<Response | null> {
  if (req.method !== 'GET') return null

  let incoming: URL
  try {
    incoming = incomingRequestUrl(req)
  } catch {
    return jsonWithCors({ ok: false, error: 'URL da requisição inválida' }, 400)
  }

  const action = incoming.searchParams.get('action') || ''
  const ymd = (incoming.searchParams.get('ymd') || '').trim()

  if (action !== 'list_items' && action !== 'check_date_column') return null
  if (action === 'check_date_column' && !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return jsonWithCors({ ok: false, error: 'Parâmetro ymd inválido (use yyyy-mm-dd)' }, 400)
  }

  if (!webhookUrlRaw) {
    return jsonWithCors({ ok: false, error: 'SHEET_WEBHOOK_URL não configurada na edge function.' }, 500)
  }

  const target = new URL(webhookUrlRaw)
  incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v))

  try {
    const scriptRes = await fetch(target.toString(), { redirect: 'follow' })
    const bodyText = await scriptRes.text()
    const ct = scriptRes.headers.get('content-type') || 'application/json'
    return new Response(bodyText, {
      status: scriptRes.status,
      headers: { ...corsHeaders, 'content-type': ct },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonWithCors({ ok: false, error: `Falha ao contatar Apps Script: ${msg}` }, 502)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    const checklist = await tryChecklistProxyGet(req)
    if (checklist) return checklist
  }

  // POST: lê o body uma única vez (evita falha ao combinar clone + req.json + dreno da outbox).
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      let text = ''
      try {
        text = await req.text()
      } catch {
        /* ignore */
      }
      let parsed: Record<string, unknown> = {}
      if (text && text.trim()) {
        try {
          const j = JSON.parse(text) as unknown
          if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j as Record<string, unknown>
        } catch {
          /* JSON inválido: não é checklist; segue para outbox */
        }
      }
      const checklist = await forwardChecklistFromPostBody(parsed)
      if (checklist) return checklist
    }
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const { data: pending, error } = await supabase
    .from('sheet_outbox')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      status: 500,
    })
  }

  const rows = (pending ?? []) as unknown as OutboxRow[]

  if (rows.length > 0 && !webhookUrlRaw) {
    return jsonWithCors(
      {
        ok: false,
        error:
          'SHEET_WEBHOOK_URL não configurada na Edge Function (Secrets). Sem ela não é possível enviar dados ao Google Sheets.',
      },
      500,
    )
  }

  let claimed = 0
  let okCount = 0
  let failedCount = 0
  const claimedRows: OutboxRow[] = []

  for (const row of rows) {
    const nowIso = new Date().toISOString()
    const attemptsNext = (row.attempts ?? 0) + 1

    const { data: claimedRow, error: claimErr } = await supabase
      .from('sheet_outbox')
      .update({
        status: 'processing',
        locked_at: nowIso,
        attempts: attemptsNext,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (claimErr) {
      await supabase
        .from('sheet_outbox')
        .update({
          status: 'failed',
          last_error: claimErr.message,
          locked_at: null,
        })
        .eq('id', row.id)
      continue
    }

    if (!claimedRow) continue
    claimed++
    claimedRows.push(claimedRow as unknown as OutboxRow)
  }

  const byAba = new Map<string, OutboxRow[]>()
  for (const row of claimedRows) {
    const aba = row.aba ?? 'CONTAGEM DE ESTOQUE FISICA'
    const arr = byAba.get(aba) ?? []
    arr.push(row)
    byAba.set(aba, arr)
  }

  for (const [, abaRows] of byAba) {
    const records = abaRows.map((r) => {
      const ymd = normalizeDataContagemToYmd(r.data_contagem)
      return {
        tipo: r.event_type,
        data_contagem: ymd,
        codigo_interno: r.codigo_interno,
        descricao: r.descricao,
        quantidade_contada: r.event_type === 'upsert' ? (r.quantidade_contada ?? 0) : undefined,
        quantidade_contada_text: r.event_type === 'upsert' ? quantidadeAsText(r.quantidade_contada) : undefined,
      }
    })

    const firstYmd = normalizeDataContagemToYmd(abaRows[0]?.data_contagem) || records[0]?.data_contagem || ''
    const body = {
      aba: abaRows[0]?.aba ?? 'CONTAGEM DE ESTOQUE FISICA',
      data_contagem: firstYmd,
      modo_planilha: 'contagem_diaria',
      records,
    }

    try {
      const res = await fetch(webhookUrlRaw, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })
      const errText = await res.text()
      if (!res.ok) {
        throw new Error(
          `Webhook falhou: ${res.status} ${res.statusText}. Resposta: ${errText.slice(0, 500)}`,
        )
      }

      const ids = abaRows.map((r) => r.id)
      okCount += ids.length
      const { error: deleteErr } = await supabase.from('sheet_outbox').delete().in('id', ids)
      if (deleteErr) throw deleteErr
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failedCount += abaRows.length
      for (const r of abaRows) {
        const finalStatus = (r.attempts ?? 0) + 1 >= maxAttempts ? 'failed' : 'pending'
        await supabase
          .from('sheet_outbox')
          .update({
            status: finalStatus,
            last_error: msg,
            locked_at: null,
          })
          .eq('id', r.id)
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      claimed,
      processed_ok: okCount,
      processed_failed: failedCount,
    }),
    { headers: { ...corsHeaders, 'content-type': 'application/json' } },
  )
})
