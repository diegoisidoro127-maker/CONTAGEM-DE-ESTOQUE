import { supabase } from './supabaseClient'

/** Considera “ativo” quem deu sinal nos últimos 3 minutos. */
export const PRESENCA_STALE_MS = 3 * 60 * 1000

/** Enquanto a sessão de checklist estiver aberta, enviar presença a cada ~45s. */
export const PRESENCA_PING_INTERVAL_MS = 45 * 1000

/** Atualizar a lista visível para todos a cada ~30s. */
export const PRESENCA_POLL_INTERVAL_MS = 30 * 1000

export function isPresencaAtiva(iso: string, now = Date.now()): boolean {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && now - t <= PRESENCA_STALE_MS
}

export function formatPresencaRelativo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const sec = Math.floor((Date.now() - t) / 1000)
  if (sec < 45) return 'agora'
  if (sec < 3600) return `há ${Math.max(1, Math.floor(sec / 60))} min`
  return 'há muito tempo'
}

export type PresencaRow = {
  conferente_id: string
  atualizado_em: string
  linhas_com_qtd?: number | null
  linhas_total?: number | null
}

export type PresencaProgresso = {
  linhasComQtd: number
  linhasTotal: number
}

function isMissingColumnError(e: unknown, columnSqlName: string): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const code = o && 'code' in o ? String(o.code) : ''
  const msg = [
    o && 'message' in o ? String(o.message) : '',
    o && 'details' in o ? String(o.details) : '',
    String(e),
  ]
    .join(' ')
    .toLowerCase()
  const col = columnSqlName.toLowerCase()
  return (
    code === '42703' ||
    (msg.includes('does not exist') && msg.includes(col)) ||
    (msg.includes('could not find') && msg.includes(col)) ||
    (msg.includes('schema cache') && msg.includes(col))
  )
}

/**
 * Envia/renova presença no dia civil da contagem (mesma tabela para todos os usuários).
 * Opcionalmente envia progresso (linhas com quantidade / total) para outros verem o andamento.
 * Falha silenciosa se a tabela ainda não existir no Supabase.
 */
export async function upsertContagemDiariaPresenca(
  conferenteId: string,
  dataContagemYmd: string,
  progresso?: PresencaProgresso,
): Promise<void> {
  const cid = String(conferenteId ?? '').trim()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
  const base = {
    conferente_id: cid,
    data_contagem: ymd,
    atualizado_em: new Date().toISOString(),
  }
  const podeProgresso =
    progresso != null &&
    Number.isFinite(progresso.linhasTotal) &&
    progresso.linhasTotal >= 0 &&
    Number.isFinite(progresso.linhasComQtd) &&
    progresso.linhasComQtd >= 0
  const payload =
    podeProgresso && progresso
      ? {
          ...base,
          linhas_com_qtd: Math.min(Math.floor(progresso.linhasComQtd), Math.floor(progresso.linhasTotal)),
          linhas_total: Math.floor(progresso.linhasTotal),
        }
      : base

  try {
    let { error } = await supabase.from('contagem_diaria_presenca').upsert(payload, { onConflict: 'conferente_id,data_contagem' })
    if (error && podeProgresso && (isMissingColumnError(error, 'linhas_com_qtd') || isMissingColumnError(error, 'linhas_total'))) {
      const r2 = await supabase.from('contagem_diaria_presenca').upsert(base, { onConflict: 'conferente_id,data_contagem' })
      error = r2.error
    }
    if (error && import.meta.env.DEV) console.warn('[contagem_diaria_presenca] upsert', error)
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] upsert', e)
  }
}

/** Linhas brutas do dia (inclui inativos); filtre com `isPresencaAtiva`. */
export async function fetchContagemDiariaPresencaDia(dataContagemYmd: string): Promise<PresencaRow[]> {
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return []
  try {
    let data: unknown[] | null = null
    let res = await supabase
      .from('contagem_diaria_presenca')
      .select('conferente_id,atualizado_em,linhas_com_qtd,linhas_total')
      .eq('data_contagem', ymd)
    if (res.error && (isMissingColumnError(res.error, 'linhas_com_qtd') || isMissingColumnError(res.error, 'linhas_total'))) {
      res = await supabase
        .from('contagem_diaria_presenca')
        .select('conferente_id,atualizado_em')
        .eq('data_contagem', ymd)
    }
    const { error } = res
    data = res.data as unknown[] | null
    if (error) {
      if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] select', error)
      return []
    }
    const out: PresencaRow[] = []
    for (const r of data ?? []) {
      const rec = r as {
        conferente_id?: string
        atualizado_em?: string
        linhas_com_qtd?: number | null
        linhas_total?: number | null
      }
      const id = rec.conferente_id != null ? String(rec.conferente_id).trim() : ''
      const em = rec.atualizado_em != null ? String(rec.atualizado_em) : ''
      if (id && em) {
        out.push({
          conferente_id: id,
          atualizado_em: em,
          linhas_com_qtd: rec.linhas_com_qtd != null ? Number(rec.linhas_com_qtd) : null,
          linhas_total: rec.linhas_total != null ? Number(rec.linhas_total) : null,
        })
      }
    }
    return out
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] select', e)
    return []
  }
}
