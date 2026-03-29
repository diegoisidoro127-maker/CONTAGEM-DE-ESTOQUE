/**
 * Preenche EAN, DUN e unidade_medida a partir de public."Todos os Produtos" (mesma lógica do app).
 */

const TABELA = 'Todos os Produtos'
const CHUNK = 200

export function normalizeCodigoInternoCompareKey(s) {
  const digits = String(s ?? '')
    .trim()
    .replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length >= 8) return digits
  if (digits.length === 6 || digits.length === 7) {
    const head = digits.slice(0, 4)
    const tail = digits.slice(4).padStart(4, '0')
    return head + tail
  }
  return digits
}

function isEmpty(v) {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  return false
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<Record<string, unknown>>} staging
 */
export async function enrichStagingEanDunFromTodosOsProdutos(supabase, staging) {
  const needEan = staging.some((r) => isEmpty(r.ean))
  const needDun = staging.some((r) => isEmpty(r.dun))
  const needUn = staging.some((r) => isEmpty(r.unidade_medida))
  if (!needEan && !needDun && !needUn) {
    console.log('EAN/DUN/unidade: já preenchidos na planilha; nada a buscar no cadastro.')
    return staging
  }

  const cods = [...new Set(staging.map((r) => String(r.codigo_interno ?? '').trim()).filter(Boolean))]
  if (cods.length === 0) return staging

  const eanByCod = new Map()
  const dunByCod = new Map()
  const unByCod = new Map()

  for (let i = 0; i < cods.length; i += CHUNK) {
    const chunk = cods.slice(i, i + CHUNK)
    let { data, error } = await supabase.from(TABELA).select('codigo_interno,ean,dun,unidade').in('codigo_interno', chunk)
    if (error) {
      const r2 = await supabase.from(TABELA).select('codigo_interno,ean,dun,unidade_medida').in('codigo_interno', chunk)
      data = r2.data
      error = r2.error
    }
    if (error) {
      const r3 = await supabase.from(TABELA).select('codigo_interno,ean,dun').in('codigo_interno', chunk)
      data = r3.data
      error = r3.error
    }
    if (error) {
      console.warn(`[enrichEanDun] ${TABELA}:`, error.message ?? error)
      continue
    }
    for (const row of data ?? []) {
      const c = String(row.codigo_interno ?? '').trim()
      if (!c) continue
      const e = row.ean != null && String(row.ean).trim() !== '' ? String(row.ean).trim() : null
      const d = row.dun != null && String(row.dun).trim() !== '' ? String(row.dun).trim() : null
      const u =
        row.unidade != null && String(row.unidade).trim() !== ''
          ? String(row.unidade).trim()
          : row.unidade_medida != null && String(row.unidade_medida).trim() !== ''
            ? String(row.unidade_medida).trim()
            : null
      const keyNorm = normalizeCodigoInternoCompareKey(c)
      const applyKey = (key) => {
        if (e && !eanByCod.has(key)) eanByCod.set(key, e)
        if (d && !dunByCod.has(key)) dunByCod.set(key, d)
        if (u && !unByCod.has(key)) unByCod.set(key, u)
      }
      applyKey(c)
      if (keyNorm && keyNorm !== c) applyKey(keyNorm)
    }
  }

  let filledEan = 0
  let filledDun = 0
  let filledUn = 0
  const out = staging.map((r) => {
    const cod = String(r.codigo_interno ?? '').trim()
    if (!cod) return r
    const keyNorm = normalizeCodigoInternoCompareKey(cod)
    const eanCat = eanByCod.get(cod) ?? (keyNorm ? eanByCod.get(keyNorm) : undefined)
    const dunCat = dunByCod.get(cod) ?? (keyNorm ? dunByCod.get(keyNorm) : undefined)
    const unCat = unByCod.get(cod) ?? (keyNorm ? unByCod.get(keyNorm) : undefined)
    const next = { ...r }
    if (needEan && isEmpty(r.ean) && eanCat) {
      next.ean = eanCat
      filledEan++
    }
    if (needDun && isEmpty(r.dun) && dunCat) {
      next.dun = dunCat
      filledDun++
    }
    if (needUn && isEmpty(r.unidade_medida) && unCat) {
      next.unidade_medida = unCat
      filledUn++
    }
    return next
  })

  console.log(
    `Cadastro "${TABELA}": preenchidos EAN em ${filledEan} linha(s), DUN em ${filledDun}, unidade em ${filledUn} (onde estavam vazios).`,
  )
  return out
}
