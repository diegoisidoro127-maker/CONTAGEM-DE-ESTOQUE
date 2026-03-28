/**
 * Comparação de código interno em todo o app: trim nas bordas + ignorar pontos
 * (ex.: 01.01.0001 e 01010001 são o mesmo código). Espaços internos não são removidos.
 */
export function normalizeCodigoInternoCompareKey(s: string): string {
  return String(s ?? '').trim().replace(/\./g, '')
}

export function codigoInternoIguais(a: string, b: string): boolean {
  return normalizeCodigoInternoCompareKey(a) === normalizeCodigoInternoCompareKey(b)
}

export function lookupProductOptionByCodigoGeneric<T extends { codigo: string }>(
  codigo: string,
  productByCode: Map<string, T>,
  productByCodeNoDots: Map<string, T>,
): T | undefined {
  const c = codigo.trim()
  if (!c) return undefined
  let p = productByCode.get(c)
  if (!p) {
    for (const [k, v] of productByCode) {
      if (k.trim() === c) {
        p = v
        break
      }
    }
  }
  if (!p) {
    const key = normalizeCodigoInternoCompareKey(c)
    if (key) p = productByCodeNoDots.get(key)
  }
  return p
}

export function lookupInCatalogMapGeneric<T extends { codigo: string }>(
  codigo: string,
  catalogMap: Map<string, T>,
): T | undefined {
  const c = codigo.trim()
  if (!c) return undefined
  let p = catalogMap.get(c)
  if (!p) {
    const key = normalizeCodigoInternoCompareKey(c)
    if (key) p = catalogMap.get(key)
  }
  if (!p) {
    for (const [k, v] of catalogMap) {
      if (k.trim() === c) {
        p = v
        break
      }
    }
  }
  return p
}
