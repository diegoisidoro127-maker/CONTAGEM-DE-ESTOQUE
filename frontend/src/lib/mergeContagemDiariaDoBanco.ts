import { supabase } from './supabaseClient'
import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import { isContagemDiariaRowResumo } from './contagemDiariaPresenca'
import type { OfflineChecklistItem } from './offlineContagemSession'

const FETCH_CHUNK = 2000

function toDateInputValue(v?: string | null) {
  if (!v) return ''
  const str = String(v)
  const m = str.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : ''
}

function formatQtyFromNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = String(n)
  return s.includes('.') ? s.replace('.', ',') : s
}

type RowSnapshot = {
  quantidade_up: number
  up_adicional: number | null
  lote: string | null
  observacao: string | null
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
  data_hora_contagem: string
}

function parseDataHoraMs(dh: string): number {
  const t = new Date(dh).getTime()
  return Number.isFinite(t) ? t : -1
}

/**
 * Busca registros em `contagens_estoque` do dia + conferente, só contagem diária,
 * e devolve a linha mais recente por código (`data_hora_contagem`).
 */
async function fetchUltimasPorCodigo(
  conferenteId: string,
  dataContagemYmd: string,
): Promise<Map<string, RowSnapshot>> {
  const map = new Map<string, RowSnapshot>()
  const cid = String(conferenteId ?? '').trim()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map

  const sel =
    'codigo_interno,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,data_hora_contagem,origem,inventario_repeticao,inventario_numero_contagem'

  const acc: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('contagens_estoque')
      .select(sel)
      .eq('data_contagem', ymd)
      .eq('conferente_id', cid)
      .order('id', { ascending: true })
      .range(from, from + FETCH_CHUNK - 1)
    if (error) {
      if (import.meta.env.DEV) console.warn('[mergeContagemDiariaDoBanco] select', error)
      return map
    }
    const batch = (data ?? []) as Record<string, unknown>[]
    acc.push(...batch)
    if (batch.length < FETCH_CHUNK) break
    from += FETCH_CHUNK
    if (from > 120000) break
  }

  for (const r of acc) {
    if (!isContagemDiariaRowResumo(r)) continue
    const codRaw = r.codigo_interno != null ? String(r.codigo_interno) : ''
    const key = normalizeCodigoInternoCompareKey(codRaw)
    if (!key) continue
    const dhRaw = r.data_hora_contagem != null ? String(r.data_hora_contagem) : ''
    const qRaw = r.quantidade_up
    const q = typeof qRaw === 'number' ? qRaw : Number(String(qRaw ?? '').replace(',', '.'))
    if (!Number.isFinite(q) || q < 0) continue

    let up_adicional: number | null = null
    const upRaw = r.up_adicional
    if (upRaw != null && String(upRaw).trim() !== '') {
      const u = typeof upRaw === 'number' ? upRaw : Number(String(upRaw).replace(',', '.'))
      if (Number.isFinite(u) && u >= 0) up_adicional = u
    }

    const snap: RowSnapshot = {
      quantidade_up: q,
      up_adicional,
      lote: r.lote != null && String(r.lote).trim() !== '' ? String(r.lote) : null,
      observacao: r.observacao != null && String(r.observacao).trim() !== '' ? String(r.observacao) : null,
      data_fabricacao: r.data_fabricacao != null ? String(r.data_fabricacao) : null,
      data_validade: r.data_validade != null ? String(r.data_validade) : null,
      ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean).trim() : null,
      dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun).trim() : null,
      data_hora_contagem: dhRaw || new Date(0).toISOString(),
    }

    const prev = map.get(key)
    if (!prev || parseDataHoraMs(snap.data_hora_contagem) > parseDataHoraMs(prev.data_hora_contagem)) {
      map.set(key, snap)
    }
  }

  return map
}

/**
 * Preenche itens da checklist com a última contagem diária já gravada no banco (mesmo dia + conferente).
 */
export async function mergeContagensDiariasDoDiaParaItems(
  conferenteId: string,
  dataContagemYmd: string,
  items: OfflineChecklistItem[],
): Promise<{ items: OfflineChecklistItem[]; preenchidos: number }> {
  const porCodigo = await fetchUltimasPorCodigo(conferenteId, dataContagemYmd)
  if (porCodigo.size === 0) {
    return { items: items.map((i) => ({ ...i })), preenchidos: 0 }
  }

  let preenchidos = 0
  const next = items.map((it) => {
    const k = normalizeCodigoInternoCompareKey(it.codigo_interno)
    const snap = k ? porCodigo.get(k) : undefined
    if (!snap) return { ...it }

    preenchidos += 1
    return {
      ...it,
      quantidade_contada: formatQtyFromNumber(snap.quantidade_up),
      up_quantidade: snap.up_adicional != null ? formatQtyFromNumber(snap.up_adicional) : '',
      lote: snap.lote ?? '',
      observacao: snap.observacao ?? '',
      data_fabricacao: snap.data_fabricacao != null ? toDateInputValue(snap.data_fabricacao) : it.data_fabricacao ?? '',
      data_validade: snap.data_validade != null ? toDateInputValue(snap.data_validade) : it.data_validade ?? '',
      ean: snap.ean != null ? snap.ean : it.ean ?? null,
      dun: snap.dun != null ? snap.dun : it.dun ?? null,
    }
  })

  return { items: next, preenchidos }
}
