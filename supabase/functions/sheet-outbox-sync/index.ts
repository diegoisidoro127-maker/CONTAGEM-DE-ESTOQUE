import { createClient } from 'npm:@supabase/supabase-js'

// Edge Function: processa a tabela `public.sheet_outbox` e grava no Google Sheets via Apps Script (/exec).
//
// Variáveis de ambiente esperadas:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SHEET_WEBHOOK_URL (URL do Apps Script terminando em /exec)
//
// Agendamento: crie um "Scheduled job" no Supabase apontando para esta função.

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

// O Supabase (Edge Functions Secrets) não permite chaves com prefixo `SUPABASE_`.
// Por isso usamos nomes neutros aqui.
const supabaseUrl = Deno.env.get('DB_URL')!
const serviceRoleKey = Deno.env.get('DB_SERVICE_ROLE_KEY')!
const webhookUrl = Deno.env.get('SHEET_WEBHOOK_URL')!

const supabase = createClient(supabaseUrl, serviceRoleKey)

const batchSize = Number(Deno.env.get('OUTBOX_BATCH_SIZE') ?? '20')
const maxAttempts = Number(Deno.env.get('OUTBOX_MAX_ATTEMPTS') ?? '5')

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // 1) Busca pendentes
  const { data: pending, error } = await supabase
    .from('sheet_outbox')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { 'content-type': 'application/json' },
      status: 500,
    })
  }

  const rows = (pending ?? []) as unknown as OutboxRow[]

  let claimed = 0
  let okCount = 0
  let failedCount = 0

  // 2) Processa um por vez (evita corrida e reduz chances de criar coluna duplicada)
  for (const row of rows) {
    // 2.1) Tenta "claim" atômico: só processa se ainda estiver pending.
    const nowIso = new Date().toISOString()
    const attemptsNext = (row.attempts ?? 0) + 1

    const { data: claimedRow } = await supabase
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

    if (!claimedRow) continue
    claimed++

    const body: Record<string, unknown> = {
      tipo: claimedRow.event_type, // 'upsert' ou 'clear_qty'
      aba: claimedRow.aba ?? 'CONTAGEM DE ESTOQUE FISICA',
      data_contagem: claimedRow.data_contagem, // 'YYYY-MM-DD'
      codigo_interno: claimedRow.codigo_interno,
      descricao: claimedRow.descricao,
    }

    if (claimedRow.event_type === 'upsert') {
      body.quantidade_contada = claimedRow.quantidade_contada ?? 0
    }

    try {
      const res = await fetch(webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        throw new Error(`Webhook falhou: ${res.status} ${res.statusText}`)
      }

      okCount++
      await supabase
        .from('sheet_outbox')
        .update({
          status: 'done',
          processed_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
        })
        .eq('id', claimedRow.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      failedCount++
      const finalStatus = attemptsNext >= maxAttempts ? 'failed' : 'pending'

      await supabase
        .from('sheet_outbox')
        .update({
          status: finalStatus,
          last_error: msg,
          locked_at: null,
        })
        .eq('id', claimedRow.id)
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      claimed,
      processed_ok: okCount,
      processed_failed: failedCount,
    }),
    { headers: { 'content-type': 'application/json' } },
  )
})

