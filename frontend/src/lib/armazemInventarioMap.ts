import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import type { OfflineChecklistItem } from './offlineContagemSession'

/** Grupos 1–4 no inventário; alinhado a `INVENTARIO_ARMAZEM_NUM_GRUPOS` em inventarioPlanilhaModel. */
const INVENTARIO_ARMAZEM_NUM_GRUPOS = 4

/**
 * Ordem do armazém dividida em rotas/contagens.
 * A lista abaixo define SOMENTE a divisão (grupo) e a ordem relativa de exibição.
 */
const ARMAZEM_CONTAGEM_CODES = {
  1: [
    '01.01.0001',
    '01.01.0002',
    '01.02.0001',
    '01.02.0003',
    '01.02.0005',
    '01.02.0007',
    '01.04.0008',
    '01.04.0009',
    '01.04.0019',
    '01.04.0020',
    '01.04.0021',
    '01.04.0022',
    '01.10.0005',
    '01.10.0003',
    '01.10.0004',
    '01.10.0006',
    '01.02.0009',
    '01.02.0011',
    '01.04.0006',
    '01.03.0019',
    '01.04.0001',
    '01.04.0002',
    '02.04.0001',
    '02.01.0005',
    '02.01.0004',
    '01.10.0013',
    '01.10.0014',
    '01.04.0066',
  ],
  2: [
    '01.09.0007',
    '01.09.0008',
    '01.09.0009',
    '01.09.0010',
    '01.09.0011',
    '01.09.0012',
    '01.06.0001',
    '01.06.0002',
    '01.06.0059',
    '02.03.0001',
    '02.03.0039',
    '02.03.0042',
    '02.02.0045',
    '02.03.0041',
    '02.03.0013',
    '02.02.0038',
    '01.04.0063',
    '01.04.0064',
    '02.02.0044',
    '02.02.0047',
    '02.02.0048',
    '02.02.0049',
    '02.02.0050',
  ],
  3: [
    '02.01.0007',
    '02.02.0034',
    '02.02.0033',
    '02.02.0031',
    '02.02.0046',
    '02.02.0036',
    '02.02.0035',
    '02.02.0032',
    '01.04.0014',
    '01.04.0025',
    '01.04.0026',
    '01.04.0054',
    '01.04.0055',
    '01.04.0028',
    '02.04.0002',
    '01.06.0058',
    '01.06.0022',
    '01.06.0024',
  ],
  4: [
    '02.03.1003',
    '02.03.1004',
    '02.03.1005',
    '02.03.1006',
    '02.03.1007',
    '02.03.1008',
    '02.03.1009',
    '02.03.1010',
    '02.03.1011',
    '02.03.1012',
    '02.03.1013',
    '02.03.1014',
    '02.03.1015',
    '02.03.1016',
    '02.03.1017',
    '01.04.0058',
    '01.04.0062',
    '01.04.0059',
    '01.04.0060',
    '01.04.0068',
    '01.04.0061',
  ],
  /** CAMARA 13 - RUA W (grupo 5). */
  5: [],
  /** CAMARA 13 - RUA Z (grupo 6). */
  6: [],
  /** CAMARA 21 - RUA A (grupo 7). */
  7: [],
  /** CAMARA 21 - RUA B (grupo 8). */
  8: [],
} as const satisfies Record<number, string[]>

const ARMAZEM_POS_BY_CODIGO = (() => {
  const m = new Map<string, { contagem: number; pos: number }>()
  for (const contagemStr of Object.keys(ARMAZEM_CONTAGEM_CODES)) {
    const contagem = Number(contagemStr)
    const codes = (ARMAZEM_CONTAGEM_CODES as Record<string, string[]>)[contagemStr] as string[]
    codes.forEach((codigo, pos) => {
      const meta = { contagem, pos }
      m.set(codigo, meta)
      const norm = normalizeCodigoInternoCompareKey(codigo)
      if (norm && !m.has(norm)) m.set(norm, meta)
    })
  }
  return m
})()

export function getArmazemContagem(codigo: string): number | null {
  const t = codigo.trim()
  return (
    ARMAZEM_POS_BY_CODIGO.get(t)?.contagem ??
    ARMAZEM_POS_BY_CODIGO.get(normalizeCodigoInternoCompareKey(t))?.contagem ??
    null
  )
}

/** Índice na rota do grupo (0-based). Não confundir com POS da planilha física — usado para ordenar como na lista. */
export function getArmazemPos(codigo: string): number {
  const t = codigo.trim()
  return (
    ARMAZEM_POS_BY_CODIGO.get(t)?.pos ??
    ARMAZEM_POS_BY_CODIGO.get(normalizeCodigoInternoCompareKey(t))?.pos ??
    Number.MAX_SAFE_INTEGER
  )
}

export function getArmazemContagemForItem(it: OfflineChecklistItem): number | null {
  const g = it.armazem_grupo
  if (g != null && g >= 1 && g <= INVENTARIO_ARMAZEM_NUM_GRUPOS) return g
  return getArmazemContagem(it.codigo_interno)
}

/**
 * Ordem canônica das linhas dentro de cada aba (grupo) — a mesma usada em POS/Nível ao finalizar
 * (`buildPlanilhaLayoutPorItens` → `inventario_planilha_linhas`).
 *
 * Sem `planilha_ordem_na_aba` (lista armazém), a ordem **não** é alfabética: segue a ordem do mapa
 * (`getArmazemPos`), igual ao `sort` do carregamento da lista em ContagemEstoque.
 */
export function compareInventarioPlanilhaItens(a: OfflineChecklistItem, b: OfflineChecklistItem): number {
  const oa = a.planilha_ordem_na_aba
  const ob = b.planilha_ordem_na_aba
  if (oa != null && ob != null && oa !== ob) return oa - ob
  if (oa != null && ob == null) return -1
  if (oa == null && ob != null) return 1
  const pa = getArmazemPos(a.codigo_interno)
  const pb = getArmazemPos(b.codigo_interno)
  if (pa !== pb) return pa - pb
  const na = normalizeCodigoInternoCompareKey(a.codigo_interno)
  const nb = normalizeCodigoInternoCompareKey(b.codigo_interno)
  const c = na !== nb ? na.localeCompare(nb, 'pt-BR') : a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
  if (c !== 0) return c
  const r = (a.inventario_repeticao ?? 0) - (b.inventario_repeticao ?? 0)
  if (r !== 0) return r
  return String(a.key).localeCompare(String(b.key), 'pt-BR')
}
