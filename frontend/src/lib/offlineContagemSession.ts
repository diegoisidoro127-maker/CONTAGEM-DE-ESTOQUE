export const OFFLINE_CONTAGEM_STORAGE_KEY = 'contagem-offline-session-v1'
export const OFFLINE_INVENTARIO_STORAGE_KEY = 'inventario-offline-session-v1'

export type OfflineSessionMode = 'contagem' | 'inventario'

export type OfflineChecklistItem = {
  /** Chave estável na sessão */
  key: string
  codigo_interno: string
  descricao: string
  /** Texto do usuário; vazio = pendente */
  quantidade_contada: string
  /** Foto anexada pelo usuário (base64). */
  foto_base64?: string
  /** Campo UP do formulário (texto para edição; vazio = sem valor). */
  up_quantidade?: string
  lote?: string
  observacao?: string
  /** YYYY-MM-DD ou vazio */
  data_fabricacao?: string
  data_validade?: string
  unidade_medida?: string | null
  ean?: string | null
  dun?: string | null
  /** No inventário: 1ª, 2ª e 3ª linha do mesmo produto (três contagens). */
  inventario_repeticao?: 1 | 2 | 3
}

/** `planilha` = mesmo carregamento que `armazém` (grupos 1–4), rótulo para inventário no formato da planilha. */
export type ChecklistListMode = 'todos' | 'armazem' | 'planilha'

export function isListModeArmazem(m: ChecklistListMode | undefined | null): boolean {
  return m === 'armazem' || m === 'planilha'
}

export type OfflineSession = {
  sessionId: string
  data_contagem_ymd: string
  conferente_id: string
  status: 'aberta' | 'finalizada'
  /** Como a lista foi carregada (ordem do cadastro vs ordem dividida por contagem). */
  listMode?: ChecklistListMode
  items: OfflineChecklistItem[]
  updatedAt: string
  /** Fluxo que criou a sessão (persistência em chave separada). */
  context?: OfflineSessionMode
}


export function stableItemKey(codigo: string, descricao: string, index: number) {
  return `${index}:${codigo.trim().toLowerCase()}:${descricao.trim().toLowerCase()}`
}

function storageKey(mode: OfflineSessionMode) {
  return mode === 'inventario' ? OFFLINE_INVENTARIO_STORAGE_KEY : OFFLINE_CONTAGEM_STORAGE_KEY
}

export function loadOfflineSession(mode: OfflineSessionMode = 'contagem'): OfflineSession | null {
  try {
    const raw = localStorage.getItem(storageKey(mode))
    if (!raw) return null
    const s = JSON.parse(raw) as OfflineSession
    if (!s || !Array.isArray(s.items)) return null
    if (s.status !== 'aberta' && s.status !== 'finalizada') return null
    return s
  } catch {
    return null
  }
}

export function saveOfflineSession(s: OfflineSession, mode: OfflineSessionMode = 'contagem') {
  const next = { ...s, updatedAt: new Date().toISOString(), context: mode }
  localStorage.setItem(storageKey(mode), JSON.stringify(next))
}

export function clearOfflineSession(mode: OfflineSessionMode = 'contagem') {
  localStorage.removeItem(storageKey(mode))
}

export function countPendingItems(items: OfflineChecklistItem[]) {
  return items.filter((i) => String(i.quantidade_contada ?? '').trim() === '').length
}
