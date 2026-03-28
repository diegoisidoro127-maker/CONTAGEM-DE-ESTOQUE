import type { OfflineChecklistItem } from '../../lib/offlineContagemSession'
import { compareInventarioPlanilhaItens } from '../../lib/armazemInventarioMap'

export { compareInventarioPlanilhaItens }

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

/** Níveis por posição na planilha (1–5). */
export const INVENTARIO_PLANILHA_NIVEIS = 5

/** Cada nível repete esta quantidade de linhas antes de subir o nível (ex.: três caixas no mesmo nível). */
export const INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL = 3

/** Linhas por POS = 5 níveis × 3 repetições = 15 (padrão da planilha). */
export const INVENTARIO_PLANILHA_LINHAS_POR_POSICAO =
  INVENTARIO_PLANILHA_NIVEIS * INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL

/** Referência: a planilha física tem 15 posições por RUA (POS 1–15); acima disso o índice segue a mesma lógica. */
export const INVENTARIO_PLANILHA_NUM_POSICOES = 15

/** Uma aba Excel = 15 POS × 15 linhas/POS (cobrindo todos os níveis em cada posição). */
export const INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA =
  INVENTARIO_PLANILHA_NUM_POSICOES * INVENTARIO_PLANILHA_LINHAS_POR_POSICAO

/**
 * POS e NIVEL a partir da ordem da linha (0-based), igual ao Excel:
 * em cada POS, NIVEL 1 repete 3×, depois NIVEL 2 repete 3×, … até NIVEL 5; a cada 15 linhas incrementa POS.
 */
export function inventarioPlanilhaPosNivelFromIndex(idx: number): { pos: number; nivel: number } {
  const rows = INVENTARIO_PLANILHA_LINHAS_POR_POSICAO
  const rep = INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL
  const pos = Math.floor(idx / rows) + 1
  const within = idx % rows
  const nivel = Math.floor(within / rep) + 1
  return { pos, nivel }
}

export function inventarioArmazemPosNivel(
  itemsSorted: OfflineChecklistItem[],
  it: OfflineChecklistItem,
): { pos: number; nivel: number } {
  const idx = itemsSorted.findIndex((x) => x.key === it.key)
  if (idx < 0) return { pos: 1, nivel: 1 }
  return inventarioPlanilhaPosNivelFromIndex(idx)
}

export function inventarioAbaTitulo(contagem: number | null | undefined): string {
  if (contagem == null) return '—'
  return INVENTARIO_ARMAZEM_ABA_TITULOS[contagem] ?? formatArmazemGroupLabel(contagem)
}

/** Primeira parte do título da aba, ex.: "CAMARA 11" (antes de " - RUA …"). */
export function inventarioCamaraLabelFromGrupo(grupo: number | null | undefined): string {
  if (grupo == null || !Number.isFinite(grupo)) return '—'
  const t = INVENTARIO_ARMAZEM_ABA_TITULOS[grupo]
  if (!t) return '—'
  const first = t.split(' - ')[0]?.trim()
  return first ?? '—'
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
  /** Aba física (CAMARA + RUA), 1–8. */
  grupo_armazem: number
  /** Rodada da contagem escolhida pelo usuário (1–4), mesma em todas as abas. */
  numero_contagem: number
  rua: string
  posicao: number
  nivel: number
}

/**
 * Calcula RUA, POS, NIVEL e grupo por item da sessão, para gravar em `inventario_planilha_linhas`.
 * `getGrupo` deve retornar 1..N (mapa de armazém por código, `armazem_grupo` na linha em branco, etc.).
 */
function clampNumeroContagemRodada(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(4, Math.max(1, Math.round(n)))
}

export function buildPlanilhaLayoutPorItens(
  items: OfflineChecklistItem[],
  getGrupo: (it: OfflineChecklistItem) => number | null,
  /** 1–4: qual contagem da rodada (cabeçalho da coluna na planilha). */
  numeroContagemRodada: number,
): Map<string, PlanilhaLayoutMeta> {
  const rodada = clampNumeroContagemRodada(numeroContagemRodada)
  const byGrupo = new Map<number, OfflineChecklistItem[]>()
  for (const it of items) {
    const raw = getGrupo(it)
    const g =
      raw != null ? Math.min(INVENTARIO_ARMAZEM_NUM_GRUPOS, Math.max(1, raw)) : 1
    if (!byGrupo.has(g)) byGrupo.set(g, [])
    byGrupo.get(g)!.push(it)
  }
  for (const arr of byGrupo.values()) {
    arr.sort(compareInventarioPlanilhaItens)
  }
  const out = new Map<string, PlanilhaLayoutMeta>()
  for (const [grupo, arr] of byGrupo) {
    const rua = getInventarioRuaArmazem(grupo)
    arr.forEach((it, idx) => {
      const { pos, nivel } = inventarioPlanilhaPosNivelFromIndex(idx)
      out.set(it.key, {
        grupo_armazem: grupo,
        numero_contagem: rodada,
        rua,
        posicao: pos,
        nivel,
      })
    })
  }
  return out
}
