import { supabase } from './supabaseClient'

export const PLANILHA_ENRICH_CHUNK = 200

export type PlanilhaLinhasFields = {
  planilha_grupo_armazem: number | null
  planilha_rua: string | null
  planilha_posicao: number | null
  planilha_nivel: number | null
}

function withNullPlanilha<T extends { id: string }>(r: T): T & PlanilhaLinhasFields {
  return {
    ...r,
    planilha_grupo_armazem: (r as T & Partial<PlanilhaLinhasFields>).planilha_grupo_armazem ?? null,
    planilha_rua: (r as T & Partial<PlanilhaLinhasFields>).planilha_rua ?? null,
    planilha_posicao: (r as T & Partial<PlanilhaLinhasFields>).planilha_posicao ?? null,
    planilha_nivel: (r as T & Partial<PlanilhaLinhasFields>).planilha_nivel ?? null,
  }
}

/**
 * Preenche Câmara/Rua/POS/Nível a partir de `inventario_planilha_linhas` (uma linha por `contagens_estoque_id`).
 * Em erro ou tabela ausente, devolve as linhas com campos nulos (não lança).
 */
export async function enrichContagemRowsWithPlanilhaLinhas<T extends { id: string }>(
  rows: T[],
  logLabel = 'enrichContagemRowsWithPlanilhaLinhas',
): Promise<Array<T & PlanilhaLinhasFields>> {
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (ids.length === 0) return rows.map(withNullPlanilha)
  const byContagem = new Map<
    string,
    { grupo_armazem: number; rua: string | null; posicao: number; nivel: number }
  >()
  try {
    for (let i = 0; i < ids.length; i += PLANILHA_ENRICH_CHUNK) {
      const chunk = ids.slice(i, i + PLANILHA_ENRICH_CHUNK)
      const { data, error } = await supabase
        .from('inventario_planilha_linhas')
        .select('contagens_estoque_id, grupo_armazem, rua, posicao, nivel')
        .in('contagens_estoque_id', chunk)
      if (error) {
        console.warn(`[${logLabel}] inventario_planilha_linhas:`, error)
        return rows.map(withNullPlanilha)
      }
      for (const row of data ?? []) {
        const cid = row.contagens_estoque_id != null ? String(row.contagens_estoque_id) : ''
        if (!cid || byContagem.has(cid)) continue
        byContagem.set(cid, {
          grupo_armazem: Number(row.grupo_armazem),
          rua: row.rua != null ? String(row.rua) : null,
          posicao: Number(row.posicao),
          nivel: Number(row.nivel),
        })
      }
    }
  } catch (e) {
    console.warn(`[${logLabel}] inventario_planilha_linhas:`, e)
    return rows.map(withNullPlanilha)
  }
  return rows.map((r) => {
    const p = byContagem.get(r.id)
    if (!p) return withNullPlanilha(r)
    return {
      ...r,
      planilha_grupo_armazem: p.grupo_armazem,
      planilha_rua: p.rua,
      planilha_posicao: p.posicao,
      planilha_nivel: p.nivel,
    }
  })
}
