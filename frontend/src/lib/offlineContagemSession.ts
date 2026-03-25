export const OFFLINE_CONTAGEM_STORAGE_KEY = 'contagem-offline-session-v1'

export type OfflineChecklistItem = {
  /** Chave estável na sessão */
  key: string
  codigo_interno: string
  descricao: string
  /** Texto do usuário; vazio = pendente */
  quantidade_contada: string
}

export type ChecklistListMode = 'todos' | 'armazem'

export type OfflineSession = {
  sessionId: string
  data_contagem_ymd: string
  conferente_id: string
  status: 'aberta' | 'finalizada'
  /** Como a lista foi carregada (ordem do cadastro vs ordem dividida por contagem). */
  listMode?: ChecklistListMode
  items: OfflineChecklistItem[]
  updatedAt: string
}

export function stableItemKey(codigo: string, descricao: string, index: number) {
  return `${index}:${codigo.trim().toLowerCase()}:${descricao.trim().toLowerCase()}`
}

export function loadOfflineSession(): OfflineSession | null {
  try {
    const raw = localStorage.getItem(OFFLINE_CONTAGEM_STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as OfflineSession
    if (!s || !Array.isArray(s.items)) return null
    if (s.status !== 'aberta' && s.status !== 'finalizada') return null
    return s
  } catch {
    return null
  }
}

export function saveOfflineSession(s: OfflineSession) {
  const next = { ...s, updatedAt: new Date().toISOString() }
  localStorage.setItem(OFFLINE_CONTAGEM_STORAGE_KEY, JSON.stringify(next))
}

export function clearOfflineSession() {
  localStorage.removeItem(OFFLINE_CONTAGEM_STORAGE_KEY)
}

export function countPendingItems(items: OfflineChecklistItem[]) {
  return items.filter((i) => String(i.quantidade_contada ?? '').trim() === '').length
}
