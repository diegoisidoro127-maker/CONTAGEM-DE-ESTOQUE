/**
 * Datas em formato YYYY-MM-DD (input type="date"): vencimento estritamente antes da fabricação.
 * Alinhado à validação ao finalizar a lista em ContagemEstoque.
 */
export function isVencimentoAntesFabricacao(
  dataFabricacao: string | null | undefined,
  dataValidade: string | null | undefined,
): boolean {
  const dfRaw = String(dataFabricacao ?? '').trim()
  const dvRaw = String(dataValidade ?? '').trim()
  if (!dfRaw || !dvRaw) return false
  return dvRaw < dfRaw
}
