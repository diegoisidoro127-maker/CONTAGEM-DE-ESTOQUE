import type { OfflineChecklistItem } from '../../lib/offlineContagemSession'

export function formatContagemLabel(contagem: number) {
  if (contagem === 1) return '1° CONTAGEM'
  if (contagem === 2) return '2° CONTAGEM'
  if (contagem === 3) return '3° CONTAGEM'
  if (contagem === 4) return '4° CONTAGEM'
  return `${contagem}° CONTAGEM`
}

function formatArmazemGroupLabel(contagem: number | null) {
  if (!contagem) return 'OUTROS'
  return formatContagemLabel(contagem)
}

/** Quantidade de abas (grupos) no inventário armazém / planilha — igual ao Excel (2 ruas por câmara). */
export const INVENTARIO_ARMAZEM_NUM_GRUPOS = 8

/** IDs dos grupos 1..N (abas CAMARA/RUA). */
export const INVENTARIO_ARMAZEM_GRUPO_IDS: readonly number[] = Array.from(
  { length: INVENTARIO_ARMAZEM_NUM_GRUPOS },
  (_, i) => i + 1,
)

/** Títulos das abas alinhados à planilha `CONTAGEM DE INVENTARIO.xlsx` (uma aba por grupo armazém). */
export const INVENTARIO_ARMAZEM_ABA_TITULOS: Partial<Record<number, string>> = {
  1: 'CAMARA 11 - RUA V',
  2: 'CAMARA 11 - RUA U',
  3: 'CAMARA 12 - RUA X',
  4: 'CAMARA 12 - RUA Y',
  5: 'CAMARA 13 - RUA W',
  6: 'CAMARA 13 - RUA Z',
  7: 'CAMARA 21 - RUA A',
  8: 'CAMARA 21 - RUA B',
}

/** Coluna RUA na planilha (letra da rua por grupo). */
export const INVENTARIO_ARMAZEM_RUA: Partial<Record<number, string>> = {
  1: 'V',
  2: 'U',
  3: 'X',
  4: 'Y',
  5: 'W',
  6: 'Z',
  7: 'A',
  8: 'B',
}

export function getInventarioRuaArmazem(contagem: number | null | undefined): string {
  if (contagem == null) return '—'
  return INVENTARIO_ARMAZEM_RUA[contagem] ?? '—'
}

/** POS e NIVEL no estilo da planilha (3 posições por nível). */
export function inventarioArmazemPosNivel(
  itemsSorted: OfflineChecklistItem[],
  it: OfflineChecklistItem,
): { pos: number; nivel: number } {
  const idx = itemsSorted.findIndex((x) => x.key === it.key)
  const pos = idx >= 0 ? idx + 1 : 1
  const nivel = Math.floor((pos - 1) / 3) + 1
  return { pos, nivel }
}

export function inventarioAbaTitulo(contagem: number | null | undefined): string {
  if (contagem == null) return '—'
  return INVENTARIO_ARMAZEM_ABA_TITULOS[contagem] ?? formatArmazemGroupLabel(contagem)
}

/**
 * Para a tabela estilo planilha (e lista mobile alinhada), remove linhas de cabeçalho de grupo.
 */
export function filtrarItensPlanilhaInventario(
  items: Array<OfflineChecklistItem | { kind: string; key: string; contagem: number | null }>,
): OfflineChecklistItem[] {
  return items.filter(
    (x): x is OfflineChecklistItem => !('kind' in x && (x as { kind?: string }).kind === 'header'),
  )
}

/** Metadados alinhados à planilha / tabela `inventario_planilha_linhas`. */
export type PlanilhaLayoutMeta = {
  grupo_armazem: number
  /** No app atual, coincide com o grupo (1ª–4ª contagem por aba). */
  numero_contagem: number
  rua: string
  posicao: number
  nivel: number
}

/**
 * Calcula RUA, POS, NIVEL e grupo por item da sessão, para gravar em `inventario_planilha_linhas`.
 * `getGrupo` deve retornar 1..N (mapa de armazém por código, `armazem_grupo` na linha em branco, etc.).
 */
export function buildPlanilhaLayoutPorItens(
  items: OfflineChecklistItem[],
  getGrupo: (it: OfflineChecklistItem) => number | null,
): Map<string, PlanilhaLayoutMeta> {
  const byGrupo = new Map<number, OfflineChecklistItem[]>()
  for (const it of items) {
    const raw = getGrupo(it)
    const g =
      raw != null ? Math.min(INVENTARIO_ARMAZEM_NUM_GRUPOS, Math.max(1, raw)) : 1
    if (!byGrupo.has(g)) byGrupo.set(g, [])
    byGrupo.get(g)!.push(it)
  }
  for (const arr of byGrupo.values()) {
    arr.sort((a, b) => {
      const c = a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
      if (c !== 0) return c
      const r = (a.inventario_repeticao ?? 0) - (b.inventario_repeticao ?? 0)
      if (r !== 0) return r
      return String(a.key).localeCompare(String(b.key), 'pt-BR')
    })
  }
  const out = new Map<string, PlanilhaLayoutMeta>()
  for (const [grupo, arr] of byGrupo) {
    const rua = getInventarioRuaArmazem(grupo)
    arr.forEach((it, idx) => {
      const pos = idx + 1
      const nivel = Math.floor((pos - 1) / 3) + 1
      out.set(it.key, {
        grupo_armazem: grupo,
        numero_contagem: grupo,
        rua,
        posicao: pos,
        nivel,
      })
    })
  }
  return out
}
