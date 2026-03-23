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

// Suporte a nomes de secrets diferentes (alguns projetos usam DB_*, outros SUPABASE_*).
// Isso evita ficar preso por mismatch entre código e secrets.
const supabaseUrl = Deno.env.get('DB_URL') ?? Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('DB_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
  const claimedRows: OutboxRow[] = []

  // 2) Claim atômico dos pendentes
  for (const row of rows) {
    // 2.1) Tenta "claim" atômico: só processa se ainda estiver pending.
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
      // Se falhar por RLS / permissão, grava o erro pra você ver no banco.
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

  // 3) Envia em lote por (aba + data_contagem), reduzindo delay e risco de coluna duplicada
  const groups = new Map<string, OutboxRow[]>()
  for (const row of claimedRows) {
    const key = `${row.aba ?? 'CONTAGEM DE ESTOQUE FISICA'}|${row.data_contagem}`
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }

  for (const [, groupRows] of groups) {
    const one = groupRows[0]
    const body = {
      aba: one.aba ?? 'CONTAGEM DE ESTOQUE FISICA',
      data_contagem: one.data_contagem,
      records: groupRows.map((r) => ({
        tipo: r.event_type,
        data_contagem: r.data_contagem,
        codigo_interno: r.codigo_interno,
        descricao: r.descricao,
        quantidade_contada: r.event_type === 'upsert' ? (r.quantidade_contada ?? 0) : undefined,
      })),
    }

    try {
      const res = await fetch(webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Webhook falhou: ${res.status} ${res.statusText}`)

      const ids = groupRows.map((r) => r.id)
      okCount += ids.length
      // Após sucesso no Sheets, remove da outbox para não acumular "done".
      const { error: deleteErr } = await supabase.from('sheet_outbox').delete().in('id', ids)
      if (deleteErr) throw deleteErr
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const ids = groupRows.map((r) => r.id)
      failedCount += ids.length
      // Usa attempts já incrementado no claim para decidir failed/pending por linha.
      for (const r of groupRows) {
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
    { headers: { 'content-type': 'application/json' } },
  )
})

