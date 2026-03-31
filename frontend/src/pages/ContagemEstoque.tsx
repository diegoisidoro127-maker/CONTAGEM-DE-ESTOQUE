import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Fila serial: um POST por vez para o webhook do Sheets (evita colunas duplicadas no servidor). */
let sheetWebhookQueue = Promise.resolve(true as boolean)
import type React from 'react'
import { supabase } from '../lib/supabaseClient'
import { toDatetimeLocalValue, toISOStringFromDatetimeLocal } from '../lib/datetime'
import {
  clearOfflineSession,
  countPendingItems,
  loadOfflineSession,
  type OfflineChecklistItem,
  type OfflineSession,
  type OfflineSessionMode,
  type ChecklistListMode,
  isListModeArmazem,
  saveOfflineSession,
  stableItemKey,
} from '../lib/offlineContagemSession'
import {
  inventarioAbaTitulo,
  InventarioPlanilhaAbas,
  InventarioPlanilhaTabela,
} from '../components/inventario/inventarioPlanilhaArmazem'
import {
  buildPlanilhaLayoutPorItens,
  inventarioCamaraLabelFromGrupo,
  INVENTARIO_ARMAZEM_GRUPO_IDS,
  INVENTARIO_ARMAZEM_NUM_GRUPOS,
  INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA,
} from '../components/inventario/inventarioPlanilhaModel'
import {
  compareInventarioPlanilhaItens,
  getArmazemContagem,
  getArmazemContagemForItem,
  getArmazemPos,
} from '../lib/armazemInventarioMap'
import { enrichContagemRowsWithPlanilhaLinhas } from '../lib/enrichContagemRowsWithPlanilhaLinhas'
import { enrichContagemRowsEanDunFromTodosOsProdutos } from '../lib/enrichContagemRowsEanDunFromTodosOsProdutos'
import { isVencimentoAntesFabricacao } from '../lib/contagemDatasValidacao'
import {
  codigoInternoIguais,
  lookupInCatalogMapGeneric as lookupInCatalogMap,
  lookupProductOptionByCodigoGeneric as lookupProductOptionByCodigo,
  normalizeCodigoInternoCompareKey,
} from '../lib/codigoInternoCompare'
import { handleChecklistFieldNavKeyDown } from '../lib/checklistFieldNavigation'
import {
  deleteInventarioPlanilhaLinhasForContagensIds,
  deleteInventarioPlanilhaLinhasForDay,
} from '../lib/inventarioPlanilhaLinhasDelete'
import {
  CHECKLIST_VISIBLE_COLS_STORAGE,
  loadChecklistVisibleColsFromStorage,
} from '../lib/checklistVisibleCols'
import { fetchConferentesNomesPorIds } from '../lib/conferentesNomesBatch'

const PREVIEW_PAGE_SIZE = 15
/** Colunas fixas na prévia (Câmara / Rua / POS / Nível / Conferente), alinhadas ao relatório completo. */
/** Câmara, Rua, POS, Nível [, Contagem rodada], Conferente — Contagem só no inventário. */
const PREVIEW_COLS_PLANILHA_BASE = 5
const CHECKLIST_PAGE_SIZE = 15
/** Linhas por página na tabela “Inventário — formato planilha” (cada aba pode ter centenas de linhas). */
const PLANILHA_TABELA_PAGE_SIZE = 30

/** Senha exigida em "Excluir tudo (banco)" na prévia (proteção contra exclusão acidental). */
const SENHA_EXCLUIR_TUDO_BANCO = 'AdminUltrapao'

type Conferente = {
  id: string
  nome: string
}

type Produto = {
  id: string
  codigo_interno: string
  descricao: string
  unidade_medida: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
}

type ContagemPreviewRow = {
  id: string
  source_ids: string[]
  /** YYYY-MM-DD (dia civil da contagem; alinhado ao relatório / Excel) */
  data_contagem: string
  data_hora_contagem: string
  conferente_id: string
  conferente_nome: string
  codigo_interno: string
  descricao: string
  unidade_medida: string | null
  /** Mesmo valor persistido em `quantidade_up` no banco (rótulo na UI: Quantidade contada). */
  quantidade_up: number
  /** Campo UP do formulário (`up_adicional` no banco). */
  quantidade_up_secundaria: number | null
  lote: string | null
  observacao: string | null
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
  foto_base64?: string | null
  origem?: string | null
  inventario_repeticao?: number | null
  /** Rodada 1–4 (inventário). */
  inventario_numero_contagem?: number | null
  /** `inventario_planilha_linhas` por `contagens_estoque_id`. */
  planilha_grupo_armazem?: number | null
  planilha_rua?: string | null
  planilha_posicao?: number | null
  planilha_nivel?: number | null
}

type ProductOption = {
  id: string
  codigo: string
  descricao: string
  unidade_medida: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
  foto_base64?: string | null
  foto_url?: string | null
}

function pickFirstString(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

/** Código/descrição podem vir como string ou número do PostgREST. */
function pickFirstCell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && !Number.isNaN(v)) return String(v)
    if (typeof v === 'boolean') continue
    if (typeof v === 'string') {
      const t = v.trim()
      if (t !== '') return t
    }
  }
  return ''
}

/** Cadastro existente no Supabase (não criar tabela nova no app). */
const TABELA_PRODUTOS = 'Todos os Produtos'

/** Alguns códigos da tabela não devem entrar na checklist do app (lista vazia = nenhum). */
const CHECKLIST_EXCLUIR_CODIGOS = new Set<string>([])

function countPendingForSession(session: OfflineSession | null): number {
  if (!session || session.status !== 'aberta') return 0
  if (session.listMode === 'planilha') {
    return session.items.filter((i) => {
      const c = String(i.codigo_interno ?? '').trim()
      if (!c) return false
      return String(i.quantidade_contada ?? '').trim() === ''
    }).length
  }
  return countPendingItems(session.items)
}

function formatContagemLabel(contagem: number) {
  if (contagem === 1) return '1° CONTAGEM'
  if (contagem === 2) return '2° CONTAGEM'
  if (contagem === 3) return '3° CONTAGEM'
  if (contagem === 4) return '4° CONTAGEM'
  return `${contagem}° CONTAGEM`
}

function formatInventarioRodadaPreviewCell(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return formatContagemLabel(Number(n))
}

function clampInventarioNumeroContagem(n: number | null | undefined): 1 | 2 | 3 | 4 {
  if (n == null || !Number.isFinite(Number(n))) return 1
  const x = Math.round(Number(n))
  if (x < 1) return 1
  if (x > 4) return 4
  return x as 1 | 2 | 3 | 4
}

function formatArmazemGroupLabel(contagem: number | null) {
  if (!contagem) return 'OUTROS'
  return formatContagemLabel(contagem)
}

function isUuid(value: string | null | undefined) {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function mapRowToProductOption(row: Record<string, any>): ProductOption | null {
  const codigo = pickFirstCell(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto'])
  if (!codigo) return null
  const descricao =
    pickFirstCell(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto']) || 'Produto sem descrição'
  // Só usar como produto_id no Supabase se for UUID real (nunca row_index/dataset_id numérico).
  const rawId = row.id
  const id = rawId != null && isUuid(String(rawId)) ? String(rawId) : codigo
  return {
    id,
    codigo,
    descricao,
    unidade_medida:
      pickFirstString(row, ['unidade_medida', 'unidade', 'UNIDADE', 'und']) || null,
    data_fabricacao: row.data_fabricacao ?? null,
    data_validade: row.data_validade ?? null,
    ean: row.ean != null ? String(row.ean) : row.EAN != null ? String(row.EAN) : null,
    dun: row.dun != null ? String(row.dun) : row.DUN != null ? String(row.DUN) : null,
    foto_base64: (row.foto_base64 ?? row.FOTO_BASE64 ?? row.fotoBase64) as string | null,
    foto_url: (row.foto_url ?? row.fotoUrl ?? row.foto_url_base ?? row.FOTO_URL) as string | null,
  }
}

function toDateInputValue(v?: string | null) {
  if (!v) return ''
  const str = String(v)
  const m = str.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : ''
}

function formatDateBRFromIso(isoLike: string) {
  const dt = new Date(isoLike)
  if (Number.isNaN(dt.getTime())) return isoLike
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`
}

function formatDateTimeBRFromIso(isoLike: string) {
  const dt = new Date(isoLike)
  if (Number.isNaN(dt.getTime())) return isoLike
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

function formatDateBRFromYmd(ymd: string) {
  const [y, m, d] = String(ymd).split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y}`
}

function conferenteNomeFromJoin(row: Record<string, unknown>): string {
  const c = row.conferentes as { nome?: string } | Array<{ nome?: string }> | null | undefined
  if (!c) return ''
  if (Array.isArray(c)) return String(c[0]?.nome ?? '')
  return String(c.nome ?? '')
}

/** Ao agrupar linhas da prévia com conferentes diferentes, lista nomes únicos separados por vírgula. */
function mergeConferenteNomesUnicos(a: string, b: string): string {
  const parts = new Set<string>()
  for (const s of [a, b]) {
    for (const part of String(s ?? '').split(',')) {
      const t = part.trim()
      if (t) parts.add(t)
    }
  }
  return Array.from(parts).sort((x, y) => x.localeCompare(y, 'pt-BR')).join(', ') || '—'
}

/**
 * Dia civil local (navegador) a partir de um ISO — deve ser o MESMO em:
 * salvar, editar prévia, excluir e webhook da planilha (senão o Sheet cria outra coluna).
 * Não usar slice(0,10) no ISO (isso é data em UTC, não o dia local).
 */
function dataContagemYmdFromIso(isoLike: string) {
  const dt = new Date(isoLike)
  if (Number.isNaN(dt.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/** Erro PostgREST / Postgres: coluna inexistente (ex.: migração `origem` ainda não aplicada). */
function isMissingDbColumnError(e: unknown, columnSqlName: string): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const code = o && 'code' in o ? String(o.code) : ''
  const msg = [
    o && 'message' in o ? String(o.message) : '',
    o && 'details' in o ? String(o.details) : '',
    o && 'hint' in o ? String(o.hint) : '',
    String(e),
  ]
    .join(' ')
    .toLowerCase()
  const col = columnSqlName.toLowerCase()
  return (
    code === '42703' ||
    (msg.includes('does not exist') && msg.includes(col)) ||
    /** PostgREST: "Could not find the 'col' column ... in the schema cache" */
    (msg.includes('could not find') && msg.includes(col)) ||
    (msg.includes('schema cache') && msg.includes(col))
  )
}

/** INSERT em bancos sem migração `alter_contagens_estoque_origem_inventario.sql` / número da contagem. */
function stripContagensEstoqueInventarioColumns(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.origem
  delete r.inventario_repeticao
  delete r.inventario_numero_contagem
  return r
}

function isMissingAnyInventarioContagensColumn(e: unknown): boolean {
  return (
    isMissingDbColumnError(e, 'origem') ||
    isMissingDbColumnError(e, 'inventario_repeticao') ||
    isMissingDbColumnError(e, 'inventario_numero_contagem')
  )
}

/** Tabela `inventario_planilha_linhas` ainda não criada no projeto Supabase. */
function isMissingInventarioPlanilhaTableError(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)).toLowerCase()
  return (
    code === '42P01' ||
    (msg.includes('inventario_planilha_linhas') && (msg.includes('does not exist') || msg.includes('não existe')))
  )
}

function toISODateLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export default function ContagemEstoque({ inventario = false }: { inventario?: boolean }) {
  const sessionMode: OfflineSessionMode = inventario ? 'inventario' : 'contagem'
  const sheetWebhookUrl = import.meta.env.VITE_SHEET_WEBHOOK_URL as string | undefined
  // Modo definitivo: usar SOMENTE outbox (evita escrita paralela e coluna duplicada).
  // Mantemos o envio direto desativado de forma fixa.
  const enableDirectSheetsWebhook = false
  // Kick imediato do processador de outbox (opção 2).
  // Coloque VITE_OUTBOX_KICK=false para desabilitar.
  const enableOutboxKick = (import.meta.env.VITE_OUTBOX_KICK as string | undefined) !== 'false'
  // Slug da edge function pode variar por ambiente (ex.: dynamic-endpoint).
  // Pode definir VITE_OUTBOX_FUNCTION_NAME no Render.
  const outboxFunctionName = (import.meta.env.VITE_OUTBOX_FUNCTION_NAME as string | undefined)?.trim()
  const supabaseUrlEnv = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const supabaseAnonKeyEnv = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)
  const [showAddConferente, setShowAddConferente] = useState(false)
  const [newConferenteNome, setNewConferenteNome] = useState('')
  const [addingConferente, setAddingConferente] = useState(false)

  // Relógio de contagem: usuário informa o início e o campo segue atualizando automaticamente.
  const [clockBaseMs, setClockBaseMs] = useState(() => Date.now())
  const [clockRealStartMs, setClockRealStartMs] = useState(() => Date.now())
  const [clockTick, setClockTick] = useState(0)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const [conferenteId, setConferenteId] = useState<string>('')

  const conferenteNomeSelecionado = useMemo(() => {
    const c = conferentes.find((x) => x.id === conferenteId)
    if (c?.nome && String(c.nome).trim() !== '') return String(c.nome).trim()
    if (conferenteId.trim() !== '') return conferenteId
    return '—'
  }, [conferentes, conferenteId])

  const [codigoInterno, setCodigoInterno] = useState('')
  const [descricaoInput, setDescricaoInput] = useState('')
  const [produto, setProduto] = useState<Produto | null>(null)
  const [produtoLoading, setProdutoLoading] = useState(false)
  const [produtoError, setProdutoError] = useState<string>('')
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [productOptionsLoading, setProductOptionsLoading] = useState(false)
  /** datalist HTML não abre a lista ao clicar na seta; usamos lista própria */
  const [codigoListOpen, setCodigoListOpen] = useState(false)
  const [descricaoListOpen, setDescricaoListOpen] = useState(false)
  const codigoWrapRef = useRef<HTMLDivElement>(null)
  const descricaoWrapRef = useRef<HTMLDivElement>(null)

  // Leitura de código de barras (DUN/EAN) via bipador (keyboard) ou câmera (opcional).
  const [barcodeLeitura, setBarcodeLeitura] = useState('')
  const [barcodeTipoLeitura, setBarcodeTipoLeitura] = useState<'DUN' | 'EAN' | null>(null)
  const [barcodeCameraOpen, setBarcodeCameraOpen] = useState(false)
  const [barcodeCameraError, setBarcodeCameraError] = useState('')
  const [barcodeFotoHint, setBarcodeFotoHint] = useState('')
  const barcodeVideoRef = useRef<HTMLVideoElement | null>(null)

  // Foto do produto (captura de câmera).
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false)
  const [photoTargetCodigo, setPhotoTargetCodigo] = useState<string>('')
  const [photoPreviewBase64, setPhotoPreviewBase64] = useState<string>('')
  const [photoSaving, setPhotoSaving] = useState(false)
  const [photoUiError, setPhotoUiError] = useState('')
  const photoVideoRef = useRef<HTMLVideoElement | null>(null)
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [lote, setLote] = useState('')
  const [dataFabricacao, setDataFabricacao] = useState('')
  const [dataVencimento, setDataVencimento] = useState('')
  const [quantidadeContada, setQuantidadeContada] = useState<string>('') // quantidade principal da contagem
  const [quantidadeUp, setQuantidadeUp] = useState<string>('') // campo UP adicional
  const [observacao, setObservacao] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>('')
  const [saveSuccess, setSaveSuccess] = useState<string>('')

  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRows, setPreviewRows] = useState<ContagemPreviewRow[]>([])
  /** Dia consultado em `contagens_estoque.data_contagem` (alinha sessão / planilha; não só “hoje”). */
  const [previewConsultaDiaYmd, setPreviewConsultaDiaYmd] = useState<string>(() => toISODateLocal(new Date()))

  /** Dia civil da contagem diária (lista + finalize usam este YMD). */
  const [contagemDiaYmd, setContagemDiaYmd] = useState(() => toISODateLocal(new Date()))
  const [offlineSession, setOfflineSession] = useState<OfflineSession | null>(null)
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [checklistError, setChecklistError] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeProgress, setFinalizeProgress] = useState('')
  const [startFreshNotice, setStartFreshNotice] = useState<string>('')
  const [checklistFilterCodigo, setChecklistFilterCodigo] = useState('')
  const [checklistFilterDescricao, setChecklistFilterDescricao] = useState('')
  const [checklistFilterPendentes, setChecklistFilterPendentes] = useState(false)
  const [checklistListCollapsed, setChecklistListCollapsed] = useState(false)
  const [checklistListMode, setChecklistListMode] = useState<ChecklistListMode>('todos')
  const [checklistVisibleCols, setChecklistVisibleCols] = useState<Record<string, boolean>>(() =>
    loadChecklistVisibleColsFromStorage(inventario),
  )
  const [checklistEditingKey, setChecklistEditingKey] = useState<string | null>(null)
  const [checklistEditDraft, setChecklistEditDraft] = useState<{
    codigo_interno: string
    descricao: string
    quantidade_contada: string
  } | null>(null)
  const [armazemMissingCodes, setArmazemMissingCodes] = useState<string[]>([])
  const [confirmFinalizeMissingOpen, setConfirmFinalizeMissingOpen] = useState(false)
  const [missingItemsForFinalize, setMissingItemsForFinalize] = useState<OfflineChecklistItem[]>([])
  const [checklistPage, setChecklistPage] = useState(1)
  /** Página dentro da tabela planilha da aba atual (independe das abas CAMARA/RUA). */
  const [planilhaTabelaPage, setPlanilhaTabelaPage] = useState(1)
  const [checklistShowAll, setChecklistShowAll] = useState(false)
  /** Feedback visual: linha da checklist acabou de ser gravada no `localStorage`. */
  const [checklistSavedFlashKey, setChecklistSavedFlashKey] = useState<string | null>(null)
  const checklistSavedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Ancora scroll após “Atualizar prévia” para a seção ficar visível (página longa no mobile). */
  const previewSectionRef = useRef<HTMLDivElement | null>(null)

  function flashChecklistRowSaved(key: string) {
    setChecklistSavedFlashKey(key)
    if (checklistSavedFlashTimerRef.current) window.clearTimeout(checklistSavedFlashTimerRef.current)
    checklistSavedFlashTimerRef.current = window.setTimeout(() => {
      setChecklistSavedFlashKey(null)
      checklistSavedFlashTimerRef.current = null
    }, 1800)
  }

  const dataHoraContagem = useMemo(() => {
    const elapsed = Date.now() - clockRealStartMs
    return toDatetimeLocalValue(new Date(clockBaseMs + elapsed))
  }, [clockBaseMs, clockRealStartMs, clockTick])

  useEffect(() => {
    const id = setInterval(() => setClockTick((v) => v + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    try {
      const ck = inventario ? 'inventario-checklist-collapsed' : 'contagem-checklist-collapsed'
      if (sessionStorage.getItem(ck) === '1') {
        setChecklistListCollapsed(true)
      }
    } catch {
      /* ignore */
    }
  }, [inventario])

  useEffect(() => {
    try {
      const k = inventario ? CHECKLIST_VISIBLE_COLS_STORAGE.inventario : CHECKLIST_VISIBLE_COLS_STORAGE.contagem
      localStorage.setItem(k, JSON.stringify(checklistVisibleCols))
    } catch {
      /* ignore */
    }
  }, [inventario, checklistVisibleCols])

  useEffect(() => {
    if (codigoInterno.trim()) setBarcodeFotoHint('')
  }, [codigoInterno])

  // Restaura sessão offline aberta (persistência no navegador).
  useEffect(() => {
    const s = loadOfflineSession(sessionMode)
    if (s && s.status === 'aberta') {
      // Painel começa "livre": descartamos a sessão em andamento e voltamos ao início.
      clearOfflineSession(sessionMode)
      setOfflineSession(null)
      setContagemDiaYmd(toISODateLocal(new Date()))
      setChecklistListMode('todos')
      setStartFreshNotice('Sessão anterior limpa ao abrir a tela. Comece do zero.')
    }
  }, [sessionMode])

  useEffect(() => {
    setChecklistPage(1)
    setChecklistShowAll(false)
    setPlanilhaTabelaPage(1)
  }, [checklistListMode, checklistFilterCodigo, checklistFilterDescricao, checklistFilterPendentes, offlineSession?.status])

  useEffect(() => {
    setPlanilhaTabelaPage(1)
  }, [checklistPage])

  // Persiste alterações da sessão aberta.
  useEffect(() => {
    if (!offlineSession || offlineSession.status !== 'aberta') return
    saveOfflineSession(offlineSession, sessionMode)
  }, [offlineSession, sessionMode])

  // O "dia civil" deve acompanhar o "data e hora do registro" quando não há sessão aberta.
  useEffect(() => {
    if (offlineSession?.status === 'aberta') return
    const next = dataContagemYmdFromIso(toISOStringFromDatetimeLocal(dataHoraContagem))
    if (next && next !== contagemDiaYmd) setContagemDiaYmd(next)
  }, [dataHoraContagem, offlineSession?.status, contagemDiaYmd])

  // Prévia do banco: mesmo dia da sessão de inventário/contagem (evita buscar “hoje” quando os dados são de outro dia).
  useEffect(() => {
    if (offlineSession?.status !== 'aberta') return
    const y = offlineSession.data_contagem_ymd
    if (y && /^\d{4}-\d{2}-\d{2}$/.test(y)) setPreviewConsultaDiaYmd(y)
  }, [offlineSession?.status, offlineSession?.data_contagem_ymd])

  // Mantém conferente_id da sessão alinhado ao seletor.
  useEffect(() => {
    if (!offlineSession || offlineSession.status !== 'aberta') return
    if (!conferenteId) return
    if (offlineSession.conferente_id === conferenteId) return
    setOfflineSession((prev) =>
      prev && prev.status === 'aberta' ? { ...prev, conferente_id: conferenteId } : prev,
    )
  }, [conferenteId, offlineSession?.status, offlineSession?.conferente_id])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    return () => {
      if (checklistSavedFlashTimerRef.current) window.clearTimeout(checklistSavedFlashTimerRef.current)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      setConferentesLoading(true)
      setSaveError('')
      const { data, error } = await supabase.from('conferentes').select('id,nome').order('nome')
      if (error) {
        setSaveError(`Erro ao carregar conferentes: ${error.message}`)
        setConferentes([])
      } else {
        setConferentes(data ?? [])
      }
      setConferentesLoading(false)
    })()
  }, [])

  const loadProductOptions = useCallback(async (): Promise<ProductOption[]> => {
    setProductOptionsLoading(true)
    setProdutoError('')
    let loaded: ProductOption[] = []
    let lastLoadError: string | null = null
    let rawRowCount = 0

    try {
      try {
        const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').limit(15000)
        rawRowCount = data?.length ?? 0

        if (error) {
          lastLoadError = error.message ?? 'erro ao carregar produtos'
        } else if (data?.length) {
          loaded = (data as Array<Record<string, any>>)
            .map((row) => mapRowToProductOption(row))
            .filter(Boolean) as ProductOption[]
          loaded.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
        }
      } catch (e: any) {
        lastLoadError =
          e?.message != null
            ? String(e.message)
            : 'Falha ao consultar o Supabase. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no deploy (Render) e recarregue a página.'
      }

      const byCode = new Map<string, ProductOption>()
      for (const p of loaded) {
        if (!byCode.has(p.codigo)) byCode.set(p.codigo, p)
      }
      const normalized = Array.from(byCode.values())
      setProductOptions(normalized)

      if (!normalized.length) {
        if (lastLoadError) {
          setProdutoError(`Erro ao carregar produtos da base: ${lastLoadError}`)
        } else if (rawRowCount === 0) {
          setProdutoError(
            `Nenhuma linha retornada de "${TABELA_PRODUTOS}". Confira políticas RLS (SELECT para o papel anon), se a tabela tem dados e o nome exato no Supabase.`,
          )
        } else {
          setProdutoError(
            `A tabela retornou ${rawRowCount} linha(s), mas nenhuma com código válido (esperado codigo_interno ou colunas equivalentes). Revise o cadastro.`,
          )
        }
      }

      return normalized
    } finally {
      setProductOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProductOptions()
  }, [loadProductOptions])

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) map.set(p.codigo, p)
    return map
  }, [productOptions])

  /** Índice por `normalizeCodigoInternoCompareKey(codigo)` — mesma regra para todos os produtos. */
  const productByCodeNoDots = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) {
      const k = normalizeCodigoInternoCompareKey(p.codigo)
      if (k && !map.has(k)) map.set(k, p)
    }
    return map
  }, [productOptions])

  const productByDescricao = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) map.set(p.descricao.trim().toLowerCase(), p)
    return map
  }, [productOptions])

  const productByEan = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) {
      if (!p.ean) continue
      if (!map.has(p.ean)) map.set(p.ean, p)
    }
    return map
  }, [productOptions])

  const productByDun = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) {
      if (!p.dun) continue
      if (!map.has(p.dun)) map.set(p.dun, p)
    }
    return map
  }, [productOptions])

  const SUGGEST_LIMIT = 400
  const codigoSuggestions = useMemo(() => {
    const q = codigoInterno.trim().toLowerCase()
    const qNoDots = normalizeCodigoInternoCompareKey(codigoInterno).toLowerCase()
    const list = q
      ? productOptions.filter((p) => {
          const pc = p.codigo.toLowerCase()
          if (pc.includes(q)) return true
          return normalizeCodigoInternoCompareKey(p.codigo).toLowerCase().includes(qNoDots)
        })
      : productOptions
    return list.slice(0, SUGGEST_LIMIT)
  }, [productOptions, codigoInterno])

  const descricaoSuggestions = useMemo(() => {
    const q = descricaoInput.trim().toLowerCase()
    const list = q
      ? productOptions.filter((p) => p.descricao.toLowerCase().includes(q))
      : productOptions
    return list.slice(0, SUGGEST_LIMIT)
  }, [productOptions, descricaoInput])

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      const t = ev.target as Node
      if (codigoWrapRef.current && !codigoWrapRef.current.contains(t)) setCodigoListOpen(false)
      if (descricaoWrapRef.current && !descricaoWrapRef.current.contains(t)) setDescricaoListOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  function applyProductByCode(codigo: string, opts?: { updateBarcodeLeitura?: boolean }) {
    const p = lookupProductOptionByCodigo(codigo, productByCode, productByCodeNoDots)
    if (!p) return false
    setProduto({
      id: p.id,
      codigo_interno: p.codigo,
      descricao: p.descricao,
      unidade_medida: p.unidade_medida,
      data_fabricacao: p.data_fabricacao ?? null,
      data_validade: p.data_validade ?? null,
      ean: p.ean ?? null,
      dun: p.dun ?? null,
    })
    setDescricaoInput(p.descricao)
    setDataFabricacao(toDateInputValue(p.data_fabricacao))
    setDataVencimento(toDateInputValue(p.data_validade))
    setProdutoError('')
    if (opts?.updateBarcodeLeitura !== false) {
      const um = String(p.unidade_medida ?? '')
        .trim()
        .toLowerCase()
      const isCaixa = um.includes('cx') || um.includes('caixa')
      // Regra: caixa -> DUN; pacote/unidade -> EAN.
      // Fallback: se faltar o preferido, usa o outro; por último, código interno.
      const preferred = isCaixa ? (p.dun ?? p.ean ?? p.codigo) : (p.ean ?? p.dun ?? p.codigo)
      const tipo: 'DUN' | 'EAN' | null = preferred === p.dun ? 'DUN' : preferred === p.ean ? 'EAN' : null
      setBarcodeLeitura(String(preferred))
      setBarcodeTipoLeitura(tipo)
    }
    return true
  }

  function applyProductByBarcode(barcode: string) {
    const code = barcode.trim()
    if (!code) return false

    const pDun = productByDun.get(code)
    if (pDun) {
      setBarcodeTipoLeitura('DUN')
      setCodigoInterno(pDun.codigo)
      applyProductByCode(pDun.codigo, { updateBarcodeLeitura: false })
      setBarcodeLeitura(code)
      setProdutoError('')
      return true
    }

    const pEan = productByEan.get(code)
    if (pEan) {
      setBarcodeTipoLeitura('EAN')
      setCodigoInterno(pEan.codigo)
      applyProductByCode(pEan.codigo, { updateBarcodeLeitura: false })
      setBarcodeLeitura(code)
      setProdutoError('')
      return true
    }

    // Fallback: se o bipador estiver enviando o próprio código interno.
    const pCode = lookupProductOptionByCodigo(code, productByCode, productByCodeNoDots)
    if (pCode) {
      setBarcodeTipoLeitura(null)
      setCodigoInterno(pCode.codigo)
      applyProductByCode(pCode.codigo, { updateBarcodeLeitura: false })
      setBarcodeLeitura(code)
      setProdutoError('')
      return true
    }

    setProdutoError('Código de barras não encontrado (DUN/EAN).')
    return false
  }

  useEffect(() => {
    if (!barcodeCameraOpen) return
    let stream: MediaStream | null = null
    let detector: any = null
    let stopped = false
    let intervalId: number | null = null

    async function start() {
      try {
        setBarcodeCameraError('')

        const supportsBarcodeDetector = typeof (window as any).BarcodeDetector === 'function'
        if (!supportsBarcodeDetector) {
          setBarcodeCameraError(
            'Seu navegador não suporta leitura por câmera (BarcodeDetector). Use o bipador ou digite o código.',
          )
          return
        }

        const formats = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39']
        detector = new (window as any).BarcodeDetector({ formats })

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (!barcodeVideoRef.current) return
        barcodeVideoRef.current.srcObject = stream
        await barcodeVideoRef.current.play()

        intervalId = window.setInterval(async () => {
          if (stopped || !detector || !barcodeVideoRef.current) return
          try {
            const barcodes = await detector.detect(barcodeVideoRef.current)
            if (barcodes && barcodes.length) {
              const rawValue = barcodes[0].rawValue
              if (rawValue && applyProductByBarcode(rawValue)) {
                setBarcodeCameraOpen(false)
                setBarcodeCameraError('')
              }
            }
          } catch {
            // ignora frame falho
          }
        }, 450)
      } catch (e: any) {
        setBarcodeCameraError(e?.message ? String(e.message) : 'Erro ao abrir câmera.')
      }
    }

    void start()

    return () => {
      stopped = true
      if (intervalId) window.clearInterval(intervalId)
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [barcodeCameraOpen, productByDun, productByEan, productByCode, productByCodeNoDots])

  function openPhotoModalForCodigo(codigo: string) {
    const code = codigo.trim()
    if (!code) return
    setPhotoTargetCodigo(code)
    setPhotoUiError('')
    setPhotoSaving(false)
    const item = offlineSession?.items.find((it) => codigoInternoIguais(it.codigo_interno, code))
    setPhotoPreviewBase64((item?.foto_base64 ?? '') || '')
    setPhotoCameraOpen(true)
  }

  useEffect(() => {
    if (!photoCameraOpen) return
    let stream: MediaStream | null = null
    let stopped = false

    async function start() {
      try {
        setPhotoUiError('')
        setPhotoSaving(false)
        const facing: MediaTrackConstraints['facingMode'] = 'environment'

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        })

        if (!photoVideoRef.current) return
        photoVideoRef.current.srcObject = stream
        await photoVideoRef.current.play()
      } catch (e: any) {
        if (stopped) return
        setPhotoUiError(e?.message ? String(e.message) : 'Erro ao abrir câmera.')
      }
    }

    void start()

    return () => {
      stopped = true
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [photoCameraOpen])

  function capturePhotoToBase64() {
    const video = photoVideoRef.current
    const canvas = photoCanvasRef.current
    if (!video || !canvas) return

    const width = video.videoWidth || 800
    const height = video.videoHeight || 600
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const base64 = dataUrl.split(',')[1] ?? ''
    setPhotoPreviewBase64(base64)
  }

  async function savePhotoToDb() {
    const codigo = photoTargetCodigo.trim()
    if (!codigo) return
    if (!photoPreviewBase64.trim()) {
      setPhotoUiError('Tire uma foto antes de salvar.')
      return
    }
    setPhotoSaving(true)
    setPhotoUiError('')

    try {
      // Foto deve ficar ligada ao registro de contagem; enquanto você conta, salvamos na sessão offline.
      if (!offlineSession || offlineSession.status !== 'aberta') {
        setPhotoUiError('Carregue a lista e abra uma sessão de contagem antes de salvar foto.')
        setPhotoSaving(false)
        return
      }

      setOfflineSession((prev) => {
        if (!prev || prev.status !== 'aberta') return prev
        const next = {
          ...prev,
          items: prev.items.map((it) =>
            codigoInternoIguais(it.codigo_interno, codigo) ? { ...it, foto_base64: photoPreviewBase64 } : it,
          ),
        }
        saveOfflineSession(next, sessionMode)
        const hit = next.items.find((it) => codigoInternoIguais(it.codigo_interno, codigo))
        if (hit) flashChecklistRowSaved(hit.key)
        return next
      })

      setPhotoCameraOpen(false)
      setPhotoTargetCodigo('')
      setPhotoSaving(false)
      setPhotoUiError('')
    } catch (e: any) {
      setPhotoUiError(e?.message ? String(e.message) : 'Erro ao salvar foto no banco.')
      setPhotoSaving(false)
    }
  }

  function removePhotoFromPhotoModal() {
    const codigo = photoTargetCodigo.trim()
    if (!codigo) return
    if (!offlineSession || offlineSession.status !== 'aberta') {
      setPhotoUiError('Carregue a lista e abra uma sessão de contagem antes de remover a foto.')
      return
    }
    const item = offlineSession.items.find((it) => codigoInternoIguais(it.codigo_interno, codigo))
    const hadSaved = Boolean(String(item?.foto_base64 ?? '').trim())
    const hadPreview = Boolean(photoPreviewBase64.trim())
    if (!hadSaved && !hadPreview) return
    if (!confirm('Remover a foto deste item da lista local?')) return
    setPhotoUiError('')
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((it) =>
          codigoInternoIguais(it.codigo_interno, codigo) ? { ...it, foto_base64: '' } : it,
        ),
      }
      saveOfflineSession(next, sessionMode)
      const hit = next.items.find((it) => codigoInternoIguais(it.codigo_interno, codigo))
      if (hit) flashChecklistRowSaved(hit.key)
      return next
    })
    setPhotoPreviewBase64('')
  }

  function removePhotoFromChecklistItem(it: OfflineChecklistItem) {
    if (!offlineSession || offlineSession.status !== 'aberta') return
    if (!String(it.foto_base64 ?? '').trim()) return
    if (!confirm('Remover a foto deste produto da lista?')) return
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((row) => (row.key === it.key ? { ...row, foto_base64: '' } : row)),
      }
      saveOfflineSession(next, sessionMode)
      flashChecklistRowSaved(it.key)
      return next
    })
  }

  // Busca automática do produto pelo `codigo_interno`
  useEffect(() => {
    const codigo = codigoInterno.trim()
    setProdutoError('')

    if (!codigo) {
      setProduto(null)
      return
    }

    const handle = setTimeout(async () => {
      setProdutoLoading(true)

      // Primeiro tenta no cache local da tabela de produtos carregada
      if (applyProductByCode(codigo)) {
        setProdutoLoading(false)
        return
      }

      const colunasBusca = ['codigo_interno', 'codigo', 'CÓDIGO', 'ean', 'dun']

      let found: Produto | null = null
      let lastMeaningfulError: any = null

      for (const coluna of colunasBusca) {
        const resp = await supabase.from(TABELA_PRODUTOS).select('*').eq(coluna, codigo).limit(1).maybeSingle()

        if (resp.error) {
          const code = String(resp.error.code ?? '')
          const msg = String(resp.error.message ?? '').toLowerCase()
          if (code !== '42703' && code !== '42P01' && code !== 'PGRST205' && !msg.includes('schema cache')) {
            lastMeaningfulError = resp.error
          }
          continue
        }

        if (resp.data) {
          const row = resp.data as Record<string, any>
          const descricao = pickFirstString(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto'])
          const codigoInterno =
            pickFirstString(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto']) || codigo
          const unidade = pickFirstString(row, ['unidade_medida', 'UNIDADE', 'unidade', 'und']) || null

          found = {
            id: String(row.id ?? codigoInterno),
            codigo_interno: codigoInterno,
            descricao: descricao || 'Produto sem descrição',
            unidade_medida: unidade,
            data_fabricacao: row.data_fabricacao ?? null,
            data_validade: row.data_validade ?? null,
            ean: (row.ean ?? row.EAN) as string | null,
            dun: (row.dun ?? row.DUN) as string | null,
          }
          break
        }
      }

      if (!found && lastMeaningfulError) {
        setProduto(null)
        setProdutoError(`Erro ao buscar o produto: ${lastMeaningfulError.message ?? 'verifique o cadastro'}`)
      } else if (!found) {
        setProduto(null)
        setProdutoError('Código não encontrado no cadastro de produtos.')
      } else {
        setProduto(found)
      }

      setProdutoLoading(false)
    }, 500)

    return () => clearTimeout(handle)
  }, [codigoInterno, productByCode, productByCodeNoDots])

  const canSubmit = useMemo(() => {
    const datasOk = !isVencimentoAntesFabricacao(dataFabricacao, dataVencimento)
    const descricaoFinal = (descricaoInput.trim() || produto?.descricao || '').trim()
    const codigoFinal = (() => {
      const code = codigoInterno.trim()
      if (code) return code
      if (!descricaoFinal) return ''
      if (offlineSession?.status !== 'aberta') return ''
      const descNorm = descricaoFinal.toLowerCase()
      const matches = offlineSession.items.filter((it) => it.descricao.trim().toLowerCase() === descNorm)
      return matches.length === 1 ? matches[0].codigo_interno.trim() : ''
    })()

    return (
      Boolean(conferenteId) &&
      codigoFinal.length > 0 &&
      descricaoFinal.length > 0 &&
      datasOk &&
      !saving
    )
  }, [
    conferenteId,
    codigoInterno,
    descricaoInput,
    produto?.descricao,
    saving,
    dataFabricacao,
    dataVencimento,
    offlineSession,
  ])

  const hasAnyQtyInChecklist = useMemo(
    () =>
      offlineSession?.status === 'aberta' &&
      offlineSession.items.some((i) => String(i.quantidade_contada ?? '').trim() !== ''),
    [offlineSession],
  )

  const canPressSalvarLista = useMemo(
    () =>
      Boolean(conferenteId) && offlineSession?.status === 'aberta' && !saving && (canSubmit || hasAnyQtyInChecklist),
    [conferenteId, offlineSession?.status, saving, canSubmit, hasAnyQtyInChecklist],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaveSuccess('')

    if (!conferenteId) {
      setSaveError('Selecione um conferente.')
      return
    }
    if (!offlineSession || offlineSession.status !== 'aberta') {
      setSaveError('Carregue a lista de produtos (sessão diária) antes de "Salvar na lista".')
      return
    }

    const codeFromInput = codigoInterno.trim()
    const descricaoDigitada = descricaoInput.trim()
    const formIdentityEmpty = !codeFromInput && !descricaoDigitada
    const countedItems = offlineSession.items.filter((i) => String(i.quantidade_contada ?? '').trim() !== '').length

    if (formIdentityEmpty && countedItems > 0) {
      saveOfflineSession(offlineSession, sessionMode)
      setSaveSuccess(
        `Lista salva na sessão local (${countedItems} produto(s) com quantidade). As alterações na coluna Qtd já eram gravadas ao digitar; use Finalizar contagem diária para enviar ao Supabase.`,
      )
      setSaveError('')
      return
    }

    const descricaoFinal = (descricaoDigitada || produto?.descricao || '').trim()
    const codeFinal = (() => {
      if (codeFromInput) return codeFromInput
      if (!descricaoFinal || offlineSession.status !== 'aberta') return ''
      const descNorm = descricaoFinal.toLowerCase()
      const matches = offlineSession.items.filter((it) => it.descricao.trim().toLowerCase() === descNorm)
      return matches.length === 1 ? matches[0].codigo_interno.trim() : ''
    })()
    if (!codeFinal) {
      if (!descricaoFinal) {
        setSaveError(
          countedItems > 0
            ? 'Ou preencha código ou descrição abaixo para gravar lote/UP/observação num produto, ou deixe só as quantidades na lista e use Finalizar contagem diária.'
            : 'Informe o código do produto, a descrição, ou preencha ao menos uma quantidade na lista acima.',
        )
      } else {
        setSaveError(
          'Não foi possível identificar o código pelo texto da descrição (há mais de um produto com texto parecido ou não há correspondência). Informe o código do produto.',
        )
      }
      return
    }
    if (!descricaoFinal) {
      setSaveError('Informe a descrição do produto.')
      return
    }

    const qtd = quantidadeContada.trim() === '' ? 0 : Number(quantidadeContada.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setSaveError('Quantidade contada inválida.')
      return
    }

    if (isVencimentoAntesFabricacao(dataFabricacao, dataVencimento)) {
      setSaveError('Data de vencimento não pode ser menor que a data de fabricação.')
      return
    }

    setSaving(true)
    try {
      const code = codeFinal
      const descNorm = descricaoFinal.trim().toLowerCase()
      const idx = offlineSession.items.findIndex(
        (it) => codigoInternoIguais(it.codigo_interno, code) && it.descricao.trim().toLowerCase() === descNorm,
      )
      if (idx < 0) {
        setSaveError(
          'Produto não está na lista do dia. Use código e descrição iguais aos cadastrados em Todos os Produtos.',
        )
        setSaving(false)
        return
      }

      const upStr = quantidadeUp.trim()
      if (upStr !== '') {
        const u = Number(upStr.replace(',', '.'))
        if (!Number.isFinite(u) || u < 0) {
          setSaveError('UP inválido.')
          setSaving(false)
          return
        }
      }

      const catalog =
        lookupProductOptionByCodigo(codeFinal.trim(), productByCode, productByCodeNoDots) ??
        productByDescricao.get(descricaoFinal.trim().toLowerCase())

      const qtdStr = String(qtd)
      const itemPatch: Pick<OfflineChecklistItem, 'quantidade_contada'> & Partial<OfflineChecklistItem> = {
        quantidade_contada: qtdStr,
        up_quantidade: upStr,
        lote: lote.trim(),
        observacao: observacao.trim(),
        data_fabricacao: dataFabricacao.trim(),
        data_validade: dataVencimento.trim(),
        unidade_medida: catalog?.unidade_medida ?? produto?.unidade_medida ?? null,
        ean: catalog?.ean ?? produto?.ean ?? null,
        dun: catalog?.dun ?? produto?.dun ?? null,
      }

      setOfflineSession((prev) => {
        if (!prev || prev.status !== 'aberta') return prev
        const nextItems = prev.items.map((it, i) => (i === idx ? { ...it, ...itemPatch } : it))
        const next = { ...prev, items: nextItems }
        saveOfflineSession(next, sessionMode)
        const row = nextItems[idx]
        if (row) flashChecklistRowSaved(row.key)
        return next
      })

      setSaveSuccess(
        `Quantidade ${qtd} gravada na lista local (offline). Clique em "Finalizar contagem diária" para salvar no banco.`,
      )
      setSaveError('')
      if (!codeFromInput) setCodigoInterno(code)
      setLote('')
      setDataFabricacao('')
      setDataVencimento('')
      setObservacao('')
      setQuantidadeContada('')
      setQuantidadeUp('')
      setCodigoInterno('')
      setDescricaoInput('')
      setProduto(null)
    } catch (e: any) {
      setSaveError(`Erro ao salvar contagem: ${e?.message ? String(e.message) : 'verifique'}`)
      setSaveSuccess('')
    } finally {
      setSaving(false)
    }
  }

  async function loadPreview(dayOverride?: string) {
    setPreviewLoading(true)
    try {
    const pad = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const hojeYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const dayKey =
      dayOverride && /^\d{4}-\d{2}-\d{2}$/.test(dayOverride)
        ? dayOverride
        : /^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)
          ? previewConsultaDiaYmd
          : offlineSession?.status === 'aberta' &&
              offlineSession.data_contagem_ymd &&
              /^\d{4}-\d{2}-\d{2}$/.test(offlineSession.data_contagem_ymd)
            ? offlineSession.data_contagem_ymd
            : /^\d{4}-\d{2}-\d{2}$/.test(contagemDiaYmd)
              ? contagemDiaYmd
              : hojeYmd

    const previewSelectFull =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao,inventario_numero_contagem'
    const previewSelectSemNc =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao'
    /** Sem `origem` no SELECT (coluna inexistente no banco) — mantém repetição e nº para agrupar a prévia. */
    const previewSelectSemOrigem =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,inventario_repeticao,inventario_numero_contagem'
    const previewSelectSemOrigemSemNc =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,inventario_repeticao'
    /** Sem repetição (último fallback antes do legado mínimo). */
    const previewSelectSemOrigemSemRepSemNc =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,inventario_numero_contagem'
    const previewSelectSemRepSemNcComOrigem =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_numero_contagem'
    /** Mesmas colunas do “completo”, sem join em `conferentes` (RLS/embed quebra o SELECT inteiro). */
    const previewSelectFlatFull =
      'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao,inventario_numero_contagem'
    const previewSelectFlatSemOrigem =
      'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,inventario_repeticao,inventario_numero_contagem'
    const previewSelectFlatSemNc =
      'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao'
    const previewSelectFlatSemOrigemSemNc =
      'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,inventario_repeticao'

    let previewOrigemAusenteNoResultado = false

    const queryPreview = (selectStr: string) =>
      supabase
        .from('contagens_estoque')
        .select(selectStr)
        .eq('data_contagem', dayKey)
        .order('data_hora_contagem', { ascending: false })
        .limit(2000)

    let { data, error } = await queryPreview(previewSelectFull)

    if (error && isMissingDbColumnError(error, 'origem')) {
      previewOrigemAusenteNoResultado = true
      const r = await queryPreview(previewSelectSemOrigem)
      data = r.data
      error = r.error
    }

    if (error && isMissingDbColumnError(error, 'inventario_numero_contagem')) {
      const sel = previewOrigemAusenteNoResultado ? previewSelectSemOrigemSemNc : previewSelectSemNc
      const rNc = await queryPreview(sel)
      data = rNc.data
      error = rNc.error
    }

    /** Ex.: SELECT completo falhou por `inventario_numero_contagem`; o retry com `semNc` ainda pedia `origem`. */
    if (error && isMissingDbColumnError(error, 'origem') && !previewOrigemAusenteNoResultado) {
      previewOrigemAusenteNoResultado = true
      const rO = await queryPreview(previewSelectSemOrigemSemNc)
      data = rO.data
      error = rO.error
    }

    if (error && isMissingDbColumnError(error, 'inventario_repeticao')) {
      const sel = previewOrigemAusenteNoResultado ? previewSelectSemOrigemSemRepSemNc : previewSelectSemRepSemNcComOrigem
      const rRep = await queryPreview(sel)
      data = rRep.data
      error = rRep.error
    }

    /** Falha comum: embed `conferentes(nome)` bloqueado por RLS — tenta colunas planas (sem join). */
    if (error) {
      const rFlat = await queryPreview(previewSelectFlatFull)
      if (!rFlat.error) {
        data = rFlat.data
        error = null
        previewOrigemAusenteNoResultado = false
      }
    }
    if (error) {
      const sel = previewOrigemAusenteNoResultado ? previewSelectFlatSemOrigemSemNc : previewSelectFlatSemNc
      const rFlat2 = await queryPreview(sel)
      if (!rFlat2.error) {
        data = rFlat2.data
        error = null
        previewOrigemAusenteNoResultado = sel === previewSelectFlatSemOrigemSemNc
      }
    }

    if (error) {
      const legacySelect =
        'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64'
      const leg = await queryPreview(legacySelect)
      if (leg.error) {
        setSaveError(`Erro ao carregar prévia: ${leg.error.message}`)
        return
      }
      data = leg.data
      error = null
      previewOrigemAusenteNoResultado = true
    }

    if (!error) {
      setSaveError('')

      let planilhaContagemIds = new Set<string>()
      if (inventario) {
        try {
          const { data: plData } = await supabase
            .from('inventario_planilha_linhas')
            .select('contagens_estoque_id')
            .eq('data_inventario', dayKey)
            .limit(5000)
          for (const pr of plData ?? []) {
            const cid = (pr as { contagens_estoque_id?: string | null }).contagens_estoque_id
            if (cid != null) planilhaContagemIds.add(String(cid))
          }
        } catch {
          /* tabela ausente ou RLS — byOrigem segue só com colunas em contagens_estoque */
        }
      }

      const hasInventarioMeta = (r: Record<string, unknown>) =>
        (r.inventario_repeticao != null && String(r.inventario_repeticao).trim() !== '') ||
        (r.inventario_numero_contagem != null && String(r.inventario_numero_contagem).trim() !== '')

      const byOrigem = (r: Record<string, unknown>) => {
        const o = r.origem != null ? String(r.origem) : ''
        const rid = String(r.id ?? '')
        if (!inventario) return o !== 'inventario'
        if (o === 'inventario') return true
        /** Vínculo na tabela planilha (mesmo quando o SELECT legado não traz origem/repetição/nº). */
        if (planilhaContagemIds.has(rid)) return true
        /** Sem coluna `origem` no banco: só inventário se houver repetição ou nº da rodada (não misturar contagem diária). */
        if (previewOrigemAusenteNoResultado) return hasInventarioMeta(r)
        return hasInventarioMeta(r)
      }
      const rawRows = (data ?? []).filter(byOrigem).map((r: Record<string, any>) => {
        const nomeJoin = conferenteNomeFromJoin(r)
        const cid = String(r.conferente_id ?? '')
        return {
          id: String(r.id),
          source_ids: [String(r.id)],
          data_contagem: r.data_contagem != null ? String(r.data_contagem) : dayKey,
          data_hora_contagem: String(r.data_hora_contagem ?? ''),
          conferente_id: cid,
          conferente_nome: nomeJoin.trim() || cid,
          codigo_interno: String(r.codigo_interno ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade_medida: r.unidade_medida ?? null,
          quantidade_up: Number(r.quantidade_up ?? 0),
          quantidade_up_secundaria: (() => {
            const v = r.up_adicional
            if (v === null || v === undefined || v === '') return null
            const n = Number(v)
            return Number.isFinite(n) ? n : null
          })(),
          lote: r.lote ?? null,
          observacao: r.observacao ?? null,
          data_fabricacao: r.data_fabricacao ?? null,
          data_validade: r.data_validade ?? null,
          ean: r.ean != null ? String(r.ean) : null,
          dun: r.dun != null ? String(r.dun) : null,
          foto_base64: r.foto_base64 ?? null,
          origem: r.origem != null ? String(r.origem) : null,
          inventario_repeticao:
            r.inventario_repeticao != null && r.inventario_repeticao !== ''
              ? Number(r.inventario_repeticao)
              : null,
          inventario_numero_contagem:
            r.inventario_numero_contagem != null && r.inventario_numero_contagem !== ''
              ? Number(r.inventario_numero_contagem)
              : null,
        }
      }) as ContagemPreviewRow[]

      const rawEnriched = await enrichContagemRowsWithPlanilhaLinhas(rawRows, 'ContagemEstoque.preview')
      const rawEnrichedCatalog = await enrichContagemRowsEanDunFromTodosOsProdutos(
        rawEnriched,
        'ContagemEstoque.preview',
      )

      const nomePorId = await fetchConferentesNomesPorIds(rawEnrichedCatalog.map((r) => r.conferente_id))
      const rawPreviewLinhas: ContagemPreviewRow[] = rawEnrichedCatalog.map((r) => {
        const nome = nomePorId.get(r.conferente_id)?.trim()
        return nome ? { ...r, conferente_nome: nome } : r
      })

      // Contagem diária: agrupa por dia + código + descrição e soma quantidades.
      // Inventário: uma linha por registro em `contagens_estoque` (mesma lógica da planilha: mesmo código em POS/Níveis diferentes não pode virar uma linha só).
      let previewList: ContagemPreviewRow[]
      if (inventario) {
        previewList = [...rawPreviewLinhas].sort((a, b) => {
          const g = (a.planilha_grupo_armazem ?? 0) - (b.planilha_grupo_armazem ?? 0)
          if (g !== 0) return g
          const ruaCmp = String(a.planilha_rua ?? '').localeCompare(String(b.planilha_rua ?? ''), 'pt-BR')
          if (ruaCmp !== 0) return ruaCmp
          const p = (a.planilha_posicao ?? 0) - (b.planilha_posicao ?? 0)
          if (p !== 0) return p
          const n = (a.planilha_nivel ?? 0) - (b.planilha_nivel ?? 0)
          if (n !== 0) return n
          const rep = (a.inventario_repeticao ?? 0) - (b.inventario_repeticao ?? 0)
          if (rep !== 0) return rep
          const nc = (a.inventario_numero_contagem ?? 0) - (b.inventario_numero_contagem ?? 0)
          if (nc !== 0) return nc
          return String(a.id).localeCompare(String(b.id), 'pt-BR')
        })
      } else {
        const grouped = new Map<string, ContagemPreviewRow>()
        for (const row of rawPreviewLinhas) {
          const day = dayKey
          const key = `${day}|${normalizeCodigoInternoCompareKey(row.codigo_interno).toLowerCase()}|${row.descricao.trim().toLowerCase()}`
          const existing = grouped.get(key)
          if (!existing) {
            grouped.set(key, { ...row })
            continue
          }
          existing.quantidade_up += Number(row.quantidade_up ?? 0)
          existing.source_ids = existing.source_ids.concat(row.source_ids)
          existing.conferente_nome = mergeConferenteNomesUnicos(existing.conferente_nome, row.conferente_nome)
          if (!existing.foto_base64 && row.foto_base64) existing.foto_base64 = row.foto_base64
          if (existing.planilha_grupo_armazem == null && row.planilha_grupo_armazem != null) {
            existing.planilha_grupo_armazem = row.planilha_grupo_armazem
            existing.planilha_rua = row.planilha_rua ?? null
            existing.planilha_posicao = row.planilha_posicao ?? null
            existing.planilha_nivel = row.planilha_nivel ?? null
          }
          if (!existing.lote && row.lote) existing.lote = row.lote
          if (!existing.observacao && row.observacao) existing.observacao = row.observacao
          if (!existing.unidade_medida && row.unidade_medida) existing.unidade_medida = row.unidade_medida
          if (!existing.data_fabricacao && row.data_fabricacao) existing.data_fabricacao = row.data_fabricacao
          if (!existing.data_validade && row.data_validade) existing.data_validade = row.data_validade
          if (!existing.ean && row.ean) existing.ean = row.ean
          if (!existing.dun && row.dun) existing.dun = row.dun
          const av = row.quantidade_up_secundaria
          if (av != null && Number.isFinite(av)) {
            const ev = existing.quantidade_up_secundaria
            existing.quantidade_up_secundaria = (ev != null && Number.isFinite(ev) ? ev : 0) + av
          }
        }
        previewList = Array.from(grouped.values())
      }

      setPreviewQueryDayYmd(dayKey)
      setPreviewRows(previewList)
      window.setTimeout(() => {
        previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 0)
    }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSaveError(`Erro ao carregar prévia: ${msg}`)
    } finally {
      setPreviewLoading(false)
    }
  }


  async function kickOutboxSync() {
    if (!enableOutboxKick) return
    try {
      // Edge Function: processa `public.sheet_outbox` e grava no Google Sheets.
      // Usa a URL da função via supabase-js (não precisa Function URL no .env).
      if (typeof (supabase as any)?.functions?.invoke !== 'function') return
      const candidates = [outboxFunctionName, 'sheet-outbox-sync', 'dynamic-endpoint'].filter(
        (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
      )

      let lastErr: any = null
      for (const fnName of candidates) {
        const res = await (supabase as any).functions.invoke(fnName, { body: {} })
        if (!res?.error) return
        lastErr = res.error
      }

      // Fallback extra para produção: chamada HTTP direta da function.
      // Ajuda quando `functions.invoke()` não dispara por configuração de SDK/ambiente.
      if (supabaseUrlEnv && supabaseAnonKeyEnv) {
        for (const fnName of candidates) {
          try {
            const url = `${supabaseUrlEnv.replace(/\/$/, '')}/functions/v1/${fnName}`
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKeyEnv,
                Authorization: `Bearer ${supabaseAnonKeyEnv}`,
              },
              body: '{}',
            })
            if (res.ok) return
            lastErr = new Error(`fallback ${fnName}: ${res.status} ${res.statusText}`)
          } catch (e) {
            lastErr = e
          }
        }
      }

      if (lastErr && import.meta.env.DEV) console.warn('[outbox kick] todas tentativas falharam:', lastErr)
    } catch (err) {
      // Não bloqueia o fluxo de salvamento.
      if (import.meta.env.DEV) console.warn('[outbox kick] falhou:', err)
    }
  }

  // Dispara o processador da outbox de forma agressiva:
  // imediato + retries curtos para reduzir atraso percebido.
  function kickOutboxSyncNowWithRetry() {
    if (!enableOutboxKick) return
    void kickOutboxSync()
    setTimeout(() => {
      void kickOutboxSync()
    }, 1500)
    setTimeout(() => {
      void kickOutboxSync()
    }, 5000)
  }

  async function fetchListaChecklistFromDb(): Promise<Array<{ codigo_interno: string; descricao: string }>> {
    const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').limit(15000)
    if (error) {
      throw new Error(`Erro ao carregar "${TABELA_PRODUTOS}": ${error.message}`)
    }
    const opts = (data ?? [])
      .map((row) => mapRowToProductOption(row as Record<string, any>))
      .filter(Boolean) as ProductOption[]
    opts.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
    const out = opts.map((r) => ({
      codigo_interno: r.codigo,
      descricao: r.descricao,
    }))

    // Remove da checklist os códigos que você não quer contar.
    const outFiltrado = out.filter((r) => !CHECKLIST_EXCLUIR_CODIGOS.has(r.codigo_interno))
    if (outFiltrado.length === 0) {
      const n = (data ?? []).length
      throw new Error(
        n === 0
          ? `Nenhuma linha retornada de "${TABELA_PRODUTOS}". Confira RLS (SELECT para anon/authenticated), se a tabela tem dados e o nome exato no Supabase.`
          : `Nenhum produto válido após ler "${TABELA_PRODUTOS}" (${n} linhas: falta codigo_interno ou colunas incompatíveis).`,
      )
    }
    return outFiltrado
  }

  async function handleCarregarListaPlanilha() {
    setChecklistError('')
    if (!conferenteId) {
      setChecklistError('Selecione um conferente antes de carregar a lista.')
      return
    }
    if (
      offlineSession &&
      offlineSession.status === 'aberta' &&
      !confirm('Já existe uma sessão em andamento no navegador. Substituir a lista (perde edições não finalizadas)?')
    ) {
      return
    }
    setChecklistLoading(true)
    try {
      const listModeEfetivo: ChecklistListMode = checklistListMode

      if (listModeEfetivo === 'planilha' && inventario) {
        setArmazemMissingCodes([])
        const LINHAS_POR_ABA = INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA
        const items: OfflineChecklistItem[] = []
        let seq = 0
        for (const g of INVENTARIO_ARMAZEM_GRUPO_IDS) {
          for (let i = 0; i < LINHAS_POR_ABA; i++) {
            items.push({
              key: `pl-${g}-${i}-${seq++}`,
              codigo_interno: '',
              descricao: '',
              armazem_grupo: g,
              planilha_ordem_na_aba: i,
              quantidade_contada: '',
              foto_base64: '',
              up_quantidade: '',
              lote: '',
              observacao: '',
              data_fabricacao: '',
              data_validade: '',
              unidade_medida: null,
              ean: null,
              dun: null,
              inventario_repeticao: undefined,
            })
          }
        }
        const sess: OfflineSession = {
          sessionId: newSessionId(),
          data_contagem_ymd: contagemDiaYmd,
          conferente_id: conferenteId,
          status: 'aberta',
          listMode: listModeEfetivo,
          context: sessionMode,
          items,
          inventario_numero_contagem: 1,
          updatedAt: new Date().toISOString(),
        }
        setOfflineSession(sess)
        saveOfflineSession(sess, sessionMode)
        setSaveSuccess(
          `Planilha em branco: ${items.length} linhas (${INVENTARIO_ARMAZEM_NUM_GRUPOS} abas × ${LINHAS_POR_ABA} linhas = 15 posições × 15 linhas por posição). Digite o código em cada linha; ao sair do campo, a descrição é preenchida pelo cadastro.`,
        )
        setSaveError('')
        return
      }

      let itemsRaw = await fetchListaChecklistFromDb()

      if (isListModeArmazem(listModeEfetivo)) {
        const missing = itemsRaw.map((it) => it.codigo_interno).filter((codigo) => getArmazemContagem(codigo) === null)
        setArmazemMissingCodes(missing)
        if (missing.length > 0) {
          throw new Error(
            `Modo armazém não está completo: faltam ${missing.length} código(s) para mapear nos grupos 1–${INVENTARIO_ARMAZEM_NUM_GRUPOS} (armazém). ` +
              `Ex.: ${missing.slice(0, 10).join(', ')}. ` +
              `Para continuar (sem "OUTROS"), ajuste o mapeamento no app (armazemInventarioMap.ts).`,
          )
        }

        itemsRaw = itemsRaw.slice().sort((a, b) => {
          const ga = getArmazemContagem(a.codigo_interno) ?? 999
          const gb = getArmazemContagem(b.codigo_interno) ?? 999
          if (ga !== gb) return ga - gb
          const pa = getArmazemPos(a.codigo_interno)
          const pb = getArmazemPos(b.codigo_interno)
          if (pa !== pb) return pa - pb
          return a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
        })
      } else {
        setArmazemMissingCodes([])
      }

      const items: OfflineChecklistItem[] = []
      itemsRaw.forEach((row, index) => {
        const p = lookupProductOptionByCodigo(row.codigo_interno.trim(), productByCode, productByCodeNoDots)
        const repeticoes = inventario ? ([1, 2, 3] as const) : ([1] as const)
        repeticoes.forEach((rep) => {
          const idx = inventario ? index * 3 + (rep - 1) : index
          items.push({
            key: stableItemKey(row.codigo_interno, row.descricao, idx),
            codigo_interno: row.codigo_interno,
            descricao: row.descricao,
            inventario_repeticao: inventario ? rep : undefined,
            quantidade_contada: '',
            foto_base64: '',
            up_quantidade: '',
            lote: '',
            observacao: '',
            data_fabricacao: p?.data_fabricacao ? toDateInputValue(p.data_fabricacao) : '',
            data_validade: p?.data_validade ? toDateInputValue(p.data_validade) : '',
            unidade_medida: p?.unidade_medida ?? null,
            ean: p?.ean ?? null,
            dun: p?.dun ?? null,
          })
        })
      })
      const sess: OfflineSession = {
        sessionId: newSessionId(),
        data_contagem_ymd: contagemDiaYmd,
        conferente_id: conferenteId,
        status: 'aberta',
        listMode: listModeEfetivo,
        context: sessionMode,
        items,
        ...(inventario ? { inventario_numero_contagem: 1 as const } : {}),
        updatedAt: new Date().toISOString(),
      }
      setOfflineSession(sess)
      saveOfflineSession(sess, sessionMode)
      setSaveSuccess(
        inventario
          ? `Lista de inventário: ${items.length} linhas (${itemsRaw.length} produtos × 3 contagens)${
              isListModeArmazem(listModeEfetivo)
                ? listModeEfetivo === 'planilha'
                  ? ', formato planilha (CAMARA/RUA, abas por grupo)'
                  : ', ordem armazém (grupos 1ª–4ª contagem)'
                : ''
            }. Preencha as quantidades e finalize.`
          : `Lista carregada: ${items.length} itens. Preencha as quantidades e finalize quando terminar.`,
      )
      setSaveError('')
    } catch (e: any) {
      setChecklistError(e?.message ? String(e.message) : 'Erro ao carregar lista.')
    } finally {
      setChecklistLoading(false)
    }
  }

  function handleDescartarSessaoLocal() {
    if (!offlineSession || offlineSession.status !== 'aberta') {
      clearOfflineSession(sessionMode)
      setOfflineSession(null)
      setChecklistListMode('todos')
      return
    }
    if (!confirm('Limpar a sessão local? As quantidades não finalizadas serão perdidas.')) return
    clearOfflineSession(sessionMode)
    setOfflineSession(null)
    setChecklistError('')
    setChecklistListMode('todos')
  }

  function updateOfflineItemQty(key: string, quantidade: string) {
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, quantidade_contada: quantidade } : it)),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
    flashChecklistRowSaved(key)
  }

  function handleLimparQuantidadeOffline(key: string) {
    updateOfflineItemQty(key, '')
  }

  function updateOfflineItemFields(
    key: string,
    patch: Partial<
      Pick<
        OfflineChecklistItem,
        | 'codigo_interno'
        | 'descricao'
        | 'quantidade_contada'
        | 'up_quantidade'
        | 'lote'
        | 'observacao'
        | 'unidade_medida'
        | 'ean'
        | 'dun'
        | 'data_fabricacao'
        | 'data_validade'
      >
    >,
  ) {
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
    flashChecklistRowSaved(key)
  }

  function setInventarioNumeroContagemRodada(n: 1 | 2 | 3 | 4) {
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        inventario_numero_contagem: n,
        updatedAt: new Date().toISOString(),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
  }

  function handleToggleChecklistCollapse() {
    setChecklistListCollapsed((prev) => {
      const next = !prev
      try {
        const ck = inventario ? 'inventario-checklist-collapsed' : 'contagem-checklist-collapsed'
        sessionStorage.setItem(ck, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (next) {
        setChecklistEditingKey(null)
        setChecklistEditDraft(null)
      }
      return next
    })
  }

  function openChecklistEdit(it: OfflineChecklistItem) {
    if (checklistEditingKey && checklistEditingKey !== it.key) {
      if (!confirm('Há outra linha em edição. Descartar alterações nela e editar esta?')) return
    }
    setChecklistEditingKey(it.key)
    setChecklistEditDraft({
      codigo_interno: it.codigo_interno,
      descricao: it.descricao,
      quantidade_contada: it.quantidade_contada,
    })
  }

  function cancelChecklistEdit() {
    setChecklistEditingKey(null)
    setChecklistEditDraft(null)
  }

  function saveChecklistEdit() {
    if (!checklistEditingKey || !checklistEditDraft || !offlineSession || offlineSession.status !== 'aberta') {
      return
    }
    const cod = checklistEditDraft.codigo_interno.trim()
    const desc = checklistEditDraft.descricao.trim()
    if (!cod) {
      setChecklistError('Na edição da linha, informe o código.')
      return
    }
    if (!desc) {
      setChecklistError('Na edição da linha, informe a descrição.')
      return
    }
    setChecklistError('')
    const p = lookupProductOptionByCodigo(cod, productByCode, productByCodeNoDots)
    updateOfflineItemFields(checklistEditingKey, {
      codigo_interno: cod,
      descricao: desc,
      quantidade_contada: checklistEditDraft.quantidade_contada.trim(),
      ...(p
        ? {
            unidade_medida: p.unidade_medida ?? null,
            ean: p.ean ?? null,
            dun: p.dun ?? null,
            data_fabricacao: p.data_fabricacao ? toDateInputValue(p.data_fabricacao) : '',
            data_validade: p.data_validade ? toDateInputValue(p.data_validade) : '',
          }
        : {}),
    })
    cancelChecklistEdit()
  }

  function aplicarCatalogoPorCodigoPlanilha(
    key: string,
    codigo: string,
    catalogMap?: Map<string, ProductOption>,
  ) {
    const c = codigo.trim()
    if (!c) {
      updateOfflineItemFields(key, {
        codigo_interno: '',
        descricao: '',
        unidade_medida: null,
        ean: null,
        dun: null,
        data_fabricacao: '',
        data_validade: '',
      })
      if (checklistEditingKey === key) {
        setChecklistEditDraft((d) => (d ? { ...d, codigo_interno: '', descricao: '' } : d))
      }
      return
    }
    let p: ProductOption | undefined
    if (catalogMap) {
      p = lookupInCatalogMap(c, catalogMap)
    } else {
      p = lookupProductOptionByCodigo(c, productByCode, productByCodeNoDots)
    }
    if (p) {
      updateOfflineItemFields(key, {
        codigo_interno: p.codigo,
        descricao: p.descricao,
        unidade_medida: p.unidade_medida ?? null,
        ean: p.ean ?? null,
        dun: p.dun ?? null,
        data_fabricacao: p.data_fabricacao ? toDateInputValue(p.data_fabricacao) : '',
        data_validade: p.data_validade ? toDateInputValue(p.data_validade) : '',
      })
      if (checklistEditingKey === key) {
        setChecklistEditDraft((d) =>
          d ? { ...d, codigo_interno: p.codigo, descricao: p.descricao } : d,
        )
      }
    } else {
      updateOfflineItemFields(key, {
        codigo_interno: c,
        descricao: '— código não encontrado no cadastro —',
      })
      if (checklistEditingKey === key) {
        setChecklistEditDraft((d) =>
          d ? { ...d, codigo_interno: c, descricao: '— código não encontrado no cadastro —' } : d,
        )
      }
    }
  }

  async function handleAtualizarCadastroProdutos() {
    setSaveError('')
    const normalized = await loadProductOptions()
    if (!normalized.length) return
    const mapPorCodigoTrim = new Map<string, ProductOption>()
    for (const p of normalized) {
      const k = p.codigo.trim()
      if (!mapPorCodigoTrim.has(k)) mapPorCodigoTrim.set(k, p)
      const nd = normalizeCodigoInternoCompareKey(k)
      if (nd && !mapPorCodigoTrim.has(nd)) mapPorCodigoTrim.set(nd, p)
    }
    if (offlineSession?.status === 'aberta' && offlineSession.listMode === 'planilha') {
      for (const it of offlineSession.items) {
        const c = String(it.codigo_interno ?? '').trim()
        if (c) aplicarCatalogoPorCodigoPlanilha(it.key, c, mapPorCodigoTrim)
      }
    }
    setSaveSuccess('Cadastro de produtos atualizado.')
  }

  async function handleFinalizarContagemDiaria() {
    setSaveError('')
    setSaveSuccess('')
    setChecklistError('')
    setFinalizeProgress('')
    setConfirmFinalizeMissingOpen(false)
    if (!offlineSession || offlineSession.status !== 'aberta') {
      setChecklistError('Não há sessão aberta. Carregue a lista de produtos primeiro.')
      return
    }
    if (!conferenteId || offlineSession.conferente_id !== conferenteId) {
      setChecklistError('Selecione o mesmo conferente da sessão (ou recarregue a lista).')
      return
    }

    const itemsSnapshot = offlineSession.items.map((i) => ({ ...i }))
    const pend = countPendingForSession(offlineSession)
    if (pend > 0) {
      if (!inventario) {
        const nowIso = new Date().toISOString()
        const nextSession: OfflineSession = {
          ...offlineSession,
          updatedAt: nowIso,
          items: offlineSession.items.map((it) => {
            const codigo = String(it.codigo_interno ?? '').trim()
            const qtd = String(it.quantidade_contada ?? '').trim()
            if (!codigo || qtd !== '') return it
            return { ...it, quantidade_contada: '0' }
          }),
        }
        setOfflineSession(nextSession)
        saveOfflineSession(nextSession, sessionMode)
        setSaveSuccess(
          `Contagem diária: ${pend} item(ns) pendente(s) foram preenchidos automaticamente com 0 para finalização.`,
        )
        await finalizeInternal(nextSession)
        return
      }
      const missing = itemsSnapshot.filter((i) => {
        if (offlineSession.listMode === 'planilha') {
          const c = String(i.codigo_interno ?? '').trim()
          if (!c) return false
          return String(i.quantidade_contada ?? '').trim() === ''
        }
        return String(i.quantidade_contada ?? '').trim() === ''
      })
      setMissingItemsForFinalize(missing)
      setConfirmFinalizeMissingOpen(true)
      return
    }

    await finalizeInternal()
  }

  async function finalizeInternal(sessionOverride?: OfflineSession) {
    const session = sessionOverride ?? offlineSession
    if (!session || session.status !== 'aberta') {
      setChecklistError('Sessão inválida ou já finalizada. Carregue a lista de produtos de novo.')
      return
    }
    if (!conferenteId || session.conferente_id !== conferenteId) {
      setChecklistError('Selecione o mesmo conferente da sessão (ou recarregue a lista).')
      return
    }

    setFinalizing(true)
    try {
      const ymd = session.data_contagem_ymd
      let itemsSnapshot = session.items.map((i) => ({ ...i }))

      itemsSnapshot = itemsSnapshot.filter((it) => String(it.codigo_interno ?? '').trim() !== '')
      /** Só grava linhas com quantidade digitada; vazio não vira 0 e não é enviado. */
      itemsSnapshot = itemsSnapshot.filter((it) => String(it.quantidade_contada ?? '').trim() !== '')
      if (itemsSnapshot.length === 0) {
        setChecklistError(
          'Nenhuma linha com código e quantidade preenchidos. Informe a quantidade nos produtos que deseja gravar (campos vazios permanecem de fora do banco).',
        )
        return
      }

      const dataHoraIso = toISOStringFromDatetimeLocal(dataHoraContagem)
      const rows: Record<string, unknown>[] = []
      /** Metadados paralelos a `rows` para gravar `inventario_planilha_linhas` após obter os ids de `contagens_estoque`. */
      const finalizeMeta: Array<{
        it: OfflineChecklistItem
        q: number
        up_adicional: number | null
        dfRaw: string
        dvRaw: string
        produtoId: string | null
      }> = []
      for (const it of itemsSnapshot) {
        const q = Number(String(it.quantidade_contada).replace(',', '.'))
        if (!Number.isFinite(q) || q < 0) {
          setChecklistError(
            `Quantidade inválida para ${it.codigo_interno}${it.inventario_repeticao ? ` (${it.inventario_repeticao}ª contagem)` : ''}.`,
          )
          return
        }
        const dfRaw = String(it.data_fabricacao ?? '').trim()
        const dvRaw = String(it.data_validade ?? '').trim()
        if (isVencimentoAntesFabricacao(dfRaw, dvRaw)) {
          setChecklistError(
            `Datas inválidas para ${it.codigo_interno}${it.inventario_repeticao ? ` (${it.inventario_repeticao}ª contagem)` : ''}: vencimento antes da fabricação.`,
          )
          return
        }
        const upRaw = String(it.up_quantidade ?? '').trim()
        let up_adicional: number | null = null
        if (upRaw !== '') {
          const u = Number(upRaw.replace(',', '.'))
          if (!Number.isFinite(u) || u < 0) {
            setChecklistError(
              `UP inválido para ${it.codigo_interno}${it.inventario_repeticao ? ` (${it.inventario_repeticao}ª contagem)` : ''}.`,
            )
            return
          }
          up_adicional = u
        }
        const catalog = lookupProductOptionByCodigo(
          it.codigo_interno.trim(),
          productByCode,
          productByCodeNoDots,
        )
        const produtoId =
          catalog?.id != null && isUuid(String(catalog.id)) ? String(catalog.id) : null
        const rowPayload: Record<string, unknown> = {
          data_contagem: ymd,
          data_hora_contagem: dataHoraIso,
          conferente_id: session.conferente_id,
          produto_id: produtoId,
          codigo_interno: String(catalog?.codigo ?? it.codigo_interno).trim(),
          descricao: it.descricao.trim(),
          unidade_medida:
            it.unidade_medida != null && String(it.unidade_medida).trim() !== ''
              ? String(it.unidade_medida).trim()
              : null,
          quantidade_up: q,
          up_adicional,
          foto_base64:
            it.foto_base64 !== undefined && String(it.foto_base64 ?? '').trim() !== ''
              ? String(it.foto_base64)
              : null,
          lote: String(it.lote ?? '').trim() || null,
          observacao: String(it.observacao ?? '').trim() || null,
          data_fabricacao: dfRaw === '' ? null : dfRaw,
          data_validade: dvRaw === '' ? null : dvRaw,
          ean: it.ean != null && String(it.ean).trim() !== '' ? String(it.ean).trim() : null,
          dun: it.dun != null && String(it.dun).trim() !== '' ? String(it.dun).trim() : null,
        }
        if (inventario) {
          rowPayload.origem = 'inventario'
          rowPayload.inventario_repeticao = it.inventario_repeticao ?? null
          rowPayload.inventario_numero_contagem = clampInventarioNumeroContagem(
            session.inventario_numero_contagem ?? 1,
          )
        }
        rows.push(rowPayload)
        finalizeMeta.push({ it, q, up_adicional, dfRaw, dvRaw, produtoId })
      }

      /**
       * POS/Nível na planilha seguem a ordem da **lista completa** da aba (todos os itens da sessão no armazém),
       * não só linhas com quantidade. Se usássemos só `itemsSnapshot`, quem preenchesse só algumas linhas
       * gravaria POS/Nível como se fossem as primeiras da aba — divergente da lista.
       */
      const itemsParaLayoutPlanilha =
        inventario && isListModeArmazem(session.listMode)
          ? session.items.map((i) => ({ ...i }))
          : itemsSnapshot

      const planilhaLayout = inventario
        ? buildPlanilhaLayoutPorItens(
            itemsParaLayoutPlanilha,
            getArmazemContagemForItem,
            clampInventarioNumeroContagem(session.inventario_numero_contagem ?? 1),
          )
        : null

      setFinalizeProgress('Conectando ao banco...')
      /** Cada finalização apenas INSERT: não apaga contagens do mesmo dia/lista — evita substituir um lote por outro. */
      let insertWithoutInventarioColumns = false

      const CHUNK = 250
      const insertedContagensIds: string[] = []
      for (let i = 0; i < rows.length; i += CHUNK) {
        setFinalizeProgress(`Salvando: ${Math.min(i + CHUNK, rows.length)}/${rows.length} registros...`)
        const chunk = rows.slice(i, i + CHUNK) as Record<string, unknown>[]
        let attemptPayload: Record<string, unknown>[] = chunk
        let { data: insertedChunk, error: insErr } = await supabase
          .from('contagens_estoque')
          .insert(attemptPayload)
          .select('id')
        if (insErr && inventario && isMissingAnyInventarioContagensColumn(insErr)) {
          insertWithoutInventarioColumns = true
          attemptPayload = chunk.map((r) => stripContagensEstoqueInventarioColumns(r))
          const res = await supabase.from('contagens_estoque').insert(attemptPayload).select('id')
          insertedChunk = res.data
          insErr = res.error
        }
        if (insErr) throw insErr
        if (insertedChunk && insertedChunk.length > 0) {
          for (const r of insertedChunk) {
            if (r && typeof r === 'object' && 'id' in r && (r as { id: unknown }).id != null) {
              insertedContagensIds.push(String((r as { id: string }).id))
            }
          }
        }
      }
      if (insertedContagensIds.length !== rows.length) {
        throw new Error(
          'O banco não devolveu o id de cada linha em contagens_estoque. Verifique a política de SELECT após INSERT.',
        )
      }

      let planilhaGravada = false
      let planilhaAviso: string | null = null
      if (inventario && planilhaLayout) {
        setFinalizeProgress('Gravando tabela inventário (planilha)...')
        const planilhaRows: Record<string, unknown>[] = finalizeMeta.map((meta, idx) => {
          const layout = planilhaLayout.get(meta.it.key)
          if (!layout) {
            throw new Error('Layout da planilha ausente para um item da sessão.')
          }
          return {
            conferente_id: session.conferente_id,
            data_inventario: ymd,
            grupo_armazem: layout.grupo_armazem,
            rua: layout.rua,
            posicao: layout.posicao,
            nivel: layout.nivel,
            numero_contagem: layout.numero_contagem,
            codigo_interno: meta.it.codigo_interno.trim(),
            descricao: meta.it.descricao.trim(),
            inventario_repeticao: meta.it.inventario_repeticao ?? null,
            quantidade: meta.q,
            data_fabricacao: meta.dfRaw === '' ? null : meta.dfRaw,
            data_validade: meta.dvRaw === '' ? null : meta.dvRaw,
            lote: String(meta.it.lote ?? '').trim() || null,
            up_quantidade: meta.up_adicional,
            observacao: String(meta.it.observacao ?? '').trim() || null,
            produto_id: meta.produtoId,
            contagens_estoque_id: insertedContagensIds[idx],
          }
        })
        for (let i = 0; i < planilhaRows.length; i += CHUNK) {
          const chunk = planilhaRows.slice(i, i + CHUNK)
          const { error: plErr } = await supabase.from('inventario_planilha_linhas').insert(chunk)
          if (plErr) {
            if (isMissingInventarioPlanilhaTableError(plErr)) {
              planilhaAviso =
                ' Tabela inventario_planilha_linhas não encontrada no banco — execute supabase/sql/create_inventario_planilha_linhas.sql.'
              break
            }
            throw plErr
          }
        }
        if (!planilhaAviso) planilhaGravada = true
      }

      clearOfflineSession(sessionMode)
      setOfflineSession(null)
      setChecklistListMode('todos')
      const inventarioDbCompatMsg =
        inventario && insertWithoutInventarioColumns
          ? ' Recomendado: execute no Supabase os scripts `alter_contagens_estoque_origem_inventario.sql` e `alter_contagens_estoque_inventario_numero_contagem.sql` para gravar origem e metadados de inventário.'
          : ''
      setSaveSuccess(
        inventario
          ? `Inventário do dia ${ymd} finalizado: ${rows.length} novo(s) registro(s) em contagens_estoque (acumula com contagens anteriores do mesmo dia).${
              planilhaGravada ? ` ${rows.length} linha(s) em inventario_planilha_linhas.` : ''
            }${planilhaAviso ?? ''}${inventarioDbCompatMsg}`
          : `Contagem do dia ${ymd} finalizada: ${rows.length} novo(s) registro(s) no banco (acumula com finalizações anteriores do mesmo dia).`,
      )
      setFinalizeProgress(
        planilhaGravada
          ? 'Concluído: contagens e planilha de inventário gravadas.'
          : 'Concluído: registros salvos com sucesso.',
      )
      setPreviewConsultaDiaYmd(ymd)
      await loadPreview(ymd)
    } catch (e: any) {
      setSaveError(`Erro ao finalizar: ${e?.message ? String(e.message) : 'verifique permissões (RLS) e tabelas.'}`)
    } finally {
      setFinalizing(false)
      setConfirmFinalizeMissingOpen(false)
    }
  }

  const [editingPreviewId, setEditingPreviewId] = useState<string | null>(null)
  const [editingPreviewQuantidade, setEditingPreviewQuantidade] = useState<string>('')
  const [previewRowActionLoading, setPreviewRowActionLoading] = useState(false)
  /** Dia (YYYY-MM-DD) da última prévia carregada com sucesso — alinha exclusão em lote ao mesmo escopo da consulta. */
  const [previewQueryDayYmd, setPreviewQueryDayYmd] = useState<string | null>(null)
  const [previewRowError, setPreviewRowError] = useState('')
  const [previewFilterCodigo, setPreviewFilterCodigo] = useState('')
  const [previewFilterDescricao, setPreviewFilterDescricao] = useState('')
  const [previewFilterConferente, setPreviewFilterConferente] = useState('')
  const [previewFilterData, setPreviewFilterData] = useState('')
  const [previewFilterLote, setPreviewFilterLote] = useState('')
  const [previewFilterObs, setPreviewFilterObs] = useState('')
  /** Inventário: '', '1', '2', '3' ou '4' para filtrar a rodada da contagem. */
  const [previewFilterInventarioNumeroContagem, setPreviewFilterInventarioNumeroContagem] = useState('')
  const [previewPage, setPreviewPage] = useState(1)
  const [previewShowAll, setPreviewShowAll] = useState(false)

  const filteredPreviewRows = useMemo(() => {
    return previewRows.filter((r) => {
      const qCod = previewFilterCodigo.trim().toLowerCase()
      const codigoOk =
        !qCod ||
        r.codigo_interno.toLowerCase().includes(qCod) ||
        normalizeCodigoInternoCompareKey(r.codigo_interno).toLowerCase().includes(
          normalizeCodigoInternoCompareKey(previewFilterCodigo).toLowerCase(),
        )
      const descricaoOk =
        !previewFilterDescricao.trim() ||
        r.descricao.toLowerCase().includes(previewFilterDescricao.trim().toLowerCase())
      const confOk =
        !previewFilterConferente.trim() ||
        r.conferente_nome.toLowerCase().includes(previewFilterConferente.trim().toLowerCase()) ||
        r.conferente_id.toLowerCase().includes(previewFilterConferente.trim().toLowerCase())
      const dataOk =
        !previewFilterData ||
        r.data_contagem === previewFilterData ||
        dataContagemYmdFromIso(String(r.data_hora_contagem)) === previewFilterData
      const loteOk =
        !previewFilterLote.trim() || String(r.lote ?? '').toLowerCase().includes(previewFilterLote.trim().toLowerCase())
      const obsOk =
        !previewFilterObs.trim() || String(r.observacao ?? '').toLowerCase().includes(previewFilterObs.trim().toLowerCase())
      const invNcOk =
        !inventario ||
        !previewFilterInventarioNumeroContagem.trim() ||
        String(r.inventario_numero_contagem ?? '') === previewFilterInventarioNumeroContagem.trim()
      return codigoOk && descricaoOk && confOk && dataOk && loteOk && obsOk && invNcOk
    })
  }, [
    previewRows,
    previewFilterCodigo,
    previewFilterDescricao,
    previewFilterConferente,
    previewFilterData,
    previewFilterLote,
    previewFilterObs,
    inventario,
    previewFilterInventarioNumeroContagem,
  ])

  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / PREVIEW_PAGE_SIZE))
  const previewPageSafe = Math.min(previewPage, previewTotalPages)
  const displayPreviewRows = useMemo(() => {
    if (previewShowAll) return filteredPreviewRows
    const start = (previewPageSafe - 1) * PREVIEW_PAGE_SIZE
    return filteredPreviewRows.slice(start, start + PREVIEW_PAGE_SIZE)
  }, [filteredPreviewRows, previewPageSafe, previewShowAll])

  useEffect(() => {
    setPreviewPage(1)
    setPreviewShowAll(false)
  }, [
    previewRows,
    previewFilterCodigo,
    previewFilterDescricao,
    previewFilterConferente,
    previewFilterData,
    previewFilterLote,
    previewFilterObs,
    previewFilterInventarioNumeroContagem,
    inventario,
  ])

  async function handlePreviewDeleteAll() {
    const dayKey = previewQueryDayYmd
    if (!dayKey || !previewRows.length) return

    const dayLabel = formatDateBRFromYmd(dayKey)
    const modoLabel = inventario
      ? 'inventário (apenas registros com origem = inventário)'
      : 'contagem diária (registros que não são inventário)'

    const senha = window.prompt(
      'Digite a senha para excluir todos os registros deste dia no banco (contagens_estoque):',
    )
    if (senha === null) return
    if (senha.trim() !== SENHA_EXCLUIR_TUDO_BANCO) {
      setPreviewRowError('Senha incorreta. Nenhum registro foi excluído.')
      return
    }

    if (
      !window.confirm(
        `ATENÇÃO\n\nSerão apagados permanentemente do banco todos os registros da tabela contagens_estoque deste tipo:\n• ${modoLabel}\n• Dia da contagem: ${dayLabel}\n\nEsta ação não pode ser desfeita.\n\nDeseja continuar?`,
      )
    ) {
      return
    }

    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      if (inventario) {
        await deleteInventarioPlanilhaLinhasForDay(supabase, dayKey)
      }

      let delQ = supabase.from('contagens_estoque').delete().eq('data_contagem', dayKey)
      if (inventario) {
        delQ = delQ.eq('origem', 'inventario')
      } else {
        delQ = delQ.or('origem.is.null,origem.neq.inventario')
      }
      let { error } = await delQ

      if (error && isMissingDbColumnError(error, 'origem')) {
        if (inventario) {
          /** Sem `origem`: apaga linhas com metadados de inventário (mesma ideia da prévia). */
          const delPorMeta = await supabase
            .from('contagens_estoque')
            .delete()
            .eq('data_contagem', dayKey)
            .or('inventario_repeticao.not.is.null,inventario_numero_contagem.not.is.null')
          if (!delPorMeta.error) {
            error = null
          } else if (isMissingAnyInventarioContagensColumn(delPorMeta.error)) {
            const ids = new Set<string>()
            for (const row of previewRows) {
              for (const sid of row.source_ids?.length ? row.source_ids : [row.id]) ids.add(sid)
            }
            if (ids.size === 0) {
              throw new Error(
                'Sem coluna origem e sem linhas com repetição/nº de contagem. Rode supabase/sql/alter_contagens_estoque_origem_inventario.sql no Supabase e tente de novo.',
              )
            }
            const delPorIds = await supabase.from('contagens_estoque').delete().in('id', Array.from(ids))
            error = delPorIds.error
          } else {
            error = delPorMeta.error
          }
        } else {
          const simple = await supabase.from('contagens_estoque').delete().eq('data_contagem', dayKey)
          error = simple.error
        }
      }

      if (error) throw error

      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      setSaveError('')
      setSaveSuccess(`Todos os registros do dia ${dayLabel} (${inventario ? 'inventário' : 'contagem diária'}) foram excluídos do banco.`)
      await loadPreview(dayKey)
      kickOutboxSyncNowWithRetry()
    } catch (e: any) {
      setPreviewRowError(`Erro ao excluir tudo: ${e?.message ? String(e.message) : 'verifique permissões (RLS).'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function handlePreviewDelete(id: string) {
    if (!confirm('Deseja realmente excluir esta contagem?')) return
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const row = previewRows.find((r) => r.id === id)
      const idsToDelete = row?.source_ids?.length ? row.source_ids : [id]
      if (inventario) {
        await deleteInventarioPlanilhaLinhasForContagensIds(supabase, idsToDelete)
      }
      const { error } = await supabase.from('contagens_estoque').delete().in('id', idsToDelete)
      if (error) throw error

      // Planilha: ao excluir, limpar apenas a quantidade (não remover a linha).
      if (sheetWebhookUrl && enableDirectSheetsWebhook && row) {
        const dataContagem = dataContagemYmdFromIso(String(row.data_hora_contagem))
        void sendToSheetInBackground(sheetWebhookUrl, {
          tipo: 'clear_qty',
          data_hora_contagem: row.data_hora_contagem,
          data_contagem: dataContagem,
          codigo_interno: row.codigo_interno,
          descricao: row.descricao,
          aba: 'CONTAGEM DE ESTOQUE FISICA',
        })
      }

      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      await loadPreview()
      // Opção 2: kick imediato + retries curtos.
      kickOutboxSyncNowWithRetry()
    } catch (e: any) {
      setPreviewRowError(`Erro ao excluir: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function handlePreviewClearPhoto(id: string) {
    const row = previewRows.find((r) => r.id === id)
    if (!row?.foto_base64) return
    if (!confirm('Remover a foto deste registro no banco de dados?')) return
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const idsToUpdate = row.source_ids?.length ? row.source_ids : [id]
      const { error } = await supabase
        .from('contagens_estoque')
        .update({ foto_base64: null })
        .in('id', idsToUpdate)
      if (error) throw error
      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      await loadPreview()
      kickOutboxSyncNowWithRetry()
    } catch (e: any) {
      setPreviewRowError(`Erro ao remover foto: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function handlePreviewSave(id: string) {
    const qtd = Number(editingPreviewQuantidade.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setPreviewRowError('Quantidade inválida para atualização.')
      return
    }
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const row = previewRows.find((r) => r.id === id)
      const sourceIds = row?.source_ids?.length ? row.source_ids : [id]
      const keepId = sourceIds[0]
      const { error } = await supabase.from('contagens_estoque').update({ quantidade_up: qtd }).eq('id', keepId)
      if (error) throw error
      const otherIds = sourceIds.slice(1)
      if (otherIds.length) {
        const { error: delError } = await supabase.from('contagens_estoque').delete().in('id', otherIds)
        if (delError) throw delError
      }
      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')

      // Planilha: ao editar, atualizar a quantidade na linha já existente.
      if (sheetWebhookUrl && enableDirectSheetsWebhook && row) {
        const dataContagem = dataContagemYmdFromIso(String(row.data_hora_contagem))
        void sendToSheetInBackground(sheetWebhookUrl, {
          tipo: 'edit_qty',
          data_hora_contagem: row.data_hora_contagem,
          data_contagem: dataContagem,
          codigo_interno: row.codigo_interno,
          descricao: row.descricao,
          quantidade_contada: qtd,
          quantidade_contada_text: String(qtd),
          aba: 'CONTAGEM DE ESTOQUE FISICA',
        })
      }

      await loadPreview()
      // Opção 2: kick imediato + retries curtos.
      kickOutboxSyncNowWithRetry()
    } catch (e: any) {
      setPreviewRowError(`Erro ao atualizar quantidade: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function sendToSheetInBackground(webhookUrl: string, body: Record<string, any>): Promise<boolean> {
    const json = JSON.stringify(body)
    const plainHeaders = { 'Content-Type': 'text/plain;charset=utf-8' }

    const run = async (): Promise<boolean> => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20000)
        const res = await fetch(webhookUrl.trim(), {
          method: 'POST',
          headers: plainHeaders,
          body: json,
          signal: controller.signal,
          credentials: 'omit',
        })
        clearTimeout(timeout)
        if (import.meta.env.DEV && !res.ok) {
          console.warn('[Sheets webhook]', res.status, res.statusText)
        }
        return !!res.ok
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[Sheets webhook] fetch falhou, tentando no-cors:', err)
        try {
          await fetch(webhookUrl.trim(), {
            method: 'POST',
            mode: 'no-cors',
            body: json,
            credentials: 'omit',
          })
          return true
        } catch {
          return false
        }
      }
    }

    const next = sheetWebhookQueue.then(() => run())
    sheetWebhookQueue = next.catch(() => false)
    return next
  }

  function renderPreviewTable() {
    /** Mesma regra da lista principal (Ocultar/mostrar colunas). */
    const prevCol = (id: string) => checklistVisibleCols[id] !== false
    const previewVisColCount =
      PREVIEW_COLS_PLANILHA_BASE +
      (inventario ? 1 : 0) +
      [
        'codigo',
        'descricao',
        'unidade',
        'quantidade',
        'data_fabricacao',
        'data_validade',
        'lote',
        'up',
        'observacao',
        'ean',
        'dun',
        'foto',
        'acoes',
      ].filter(prevCol).length

    const totalFiltered = filteredPreviewRows.length
    const rangeFrom =
      totalFiltered === 0 ? 0 : previewShowAll ? 1 : (previewPageSafe - 1) * PREVIEW_PAGE_SIZE + 1
    const rangeTo =
      totalFiltered === 0 ? 0 : previewShowAll ? totalFiltered : Math.min(previewPageSafe * PREVIEW_PAGE_SIZE, totalFiltered)

    const previewFiltersBar = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <input
          value={previewFilterConferente}
          onChange={(e) => setPreviewFilterConferente(e.target.value)}
          placeholder="Filtrar conferente"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 180px' }}
        />
        <input
          value={previewFilterCodigo}
          onChange={(e) => setPreviewFilterCodigo(e.target.value)}
          placeholder="Filtrar código"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 160px' }}
        />
        <input
          value={previewFilterDescricao}
          onChange={(e) => setPreviewFilterDescricao(e.target.value)}
          placeholder="Filtrar descrição"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 200px' }}
        />
        <input
          type="date"
          value={previewFilterData}
          onChange={(e) => setPreviewFilterData(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 160px' }}
        />
        {inventario ? (
          <select
            value={previewFilterInventarioNumeroContagem}
            onChange={(e) => setPreviewFilterInventarioNumeroContagem(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 120px' }}
            aria-label="Filtrar por número da contagem"
          >
            <option value="">Todas as contagens</option>
            <option value="1">1ª contagem</option>
            <option value="2">2ª contagem</option>
            <option value="3">3ª contagem</option>
            <option value="4">4ª contagem</option>
          </select>
        ) : null}
        <input
          value={previewFilterLote}
          onChange={(e) => setPreviewFilterLote(e.target.value)}
          placeholder="Filtrar lote"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 140px' }}
        />
        <input
          value={previewFilterObs}
          onChange={(e) => setPreviewFilterObs(e.target.value)}
          placeholder="Filtrar observação"
          style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 140px' }}
        />
      </div>
    )

    const previewNavStyleBtn = (disabled: boolean) => ({
      padding: '6px 12px',
      borderRadius: 6,
      border: '1px solid var(--border, #ccc)',
      background: disabled ? 'rgba(255,255,255,0.08)' : 'var(--surface, #222)',
      color: 'var(--text, #eee)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 13,
      opacity: disabled ? 0.5 : 1,
    })

    const previewPagination = (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginTop: 12,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text, #888)' }}>
          {totalFiltered === 0
            ? 'Nenhum registro com os filtros atuais.'
            : previewShowAll
              ? `Exibindo todos os ${totalFiltered} registros`
              : `${rangeFrom}–${rangeTo} de ${totalFiltered} · Página ${previewPageSafe} de ${previewTotalPages} · ${PREVIEW_PAGE_SIZE} por página`}
        </span>
        <button
          type="button"
          disabled={previewShowAll || previewPageSafe <= 1 || totalFiltered === 0}
          onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
          style={previewNavStyleBtn(previewShowAll || previewPageSafe <= 1 || totalFiltered === 0)}
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={previewShowAll || previewPageSafe >= previewTotalPages || totalFiltered === 0}
          onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
          style={previewNavStyleBtn(previewShowAll || previewPageSafe >= previewTotalPages || totalFiltered === 0)}
        >
          Próxima
        </button>
        {totalFiltered > PREVIEW_PAGE_SIZE ? (
          previewShowAll ? (
            <button
              type="button"
              onClick={() => {
                setPreviewShowAll(false)
                setPreviewPage(1)
              }}
              style={previewNavStyleBtn(false)}
            >
              Paginar ({PREVIEW_PAGE_SIZE} por página)
            </button>
          ) : (
            <button type="button" onClick={() => setPreviewShowAll(true)} style={previewNavStyleBtn(false)}>
              Mostrar tudo
            </button>
          )
        ) : null}
      </div>
    )

    if (isMobile) {
      return (
        <div style={{ overflowX: 'hidden', marginTop: 16 }}>
          {previewRowError ? <div style={{ color: '#b00020', marginBottom: 8 }}>{previewRowError}</div> : null}
          {previewFiltersBar}
          {previewPagination}

          <div
            data-checklist-nav-root
            style={{ display: 'grid', gap: 12, marginTop: 14 }}
            onKeyDown={handleChecklistFieldNavKeyDown}
          >
            {displayPreviewRows.map((r) => {
              const hasPhoto = Boolean(String(r.foto_base64 ?? '').trim())
              const datasOrdemInvalida = isVencimentoAntesFabricacao(r.data_fabricacao, r.data_validade)
              return (
                <div
                  key={r.id}
                  style={{
                    border: datasOrdemInvalida ? '1px solid #c62828' : '1px solid var(--border, #ccc)',
                    borderRadius: 12,
                    padding: 12,
                    background: datasOrdemInvalida ? 'rgba(198, 40, 40, 0.14)' : 'rgba(255, 255, 255, 0.02)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text, #888)' }}>Câmara</div>
                    <div style={{ fontSize: 13 }}>{inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Rua</div>
                    <div style={{ fontSize: 13 }}>
                      {r.planilha_rua != null && String(r.planilha_rua).trim() !== '' ? r.planilha_rua : '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>POS</div>
                    <div style={{ fontSize: 13 }}>
                      {r.planilha_posicao != null && Number.isFinite(Number(r.planilha_posicao))
                        ? r.planilha_posicao
                        : '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Nível</div>
                    <div style={{ fontSize: 13 }}>
                      {r.planilha_nivel != null && Number.isFinite(Number(r.planilha_nivel)) ? r.planilha_nivel : '—'}
                    </div>
                    {inventario ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Contagem</div>
                        <div style={{ fontSize: 13 }}>{formatInventarioRodadaPreviewCell(r.inventario_numero_contagem)}</div>
                      </>
                    ) : null}
                    <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Conferente</div>
                    <div style={{ fontSize: 13 }}>
                      {String(r.conferente_nome ?? '').trim() !== '' ? r.conferente_nome : '—'}
                    </div>
                    {prevCol('codigo') ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>
                          Código do produto
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace' }}>{r.codigo_interno}</div>
                      </>
                    ) : null}

                    {prevCol('descricao') ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Descrição</div>
                        <div style={{ fontSize: 13, color: 'var(--text, #111)' }}>{r.descricao}</div>
                      </>
                    ) : null}

                    {prevCol('unidade') ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Unidade de medida</div>
                        <div style={{ fontSize: 13 }}>{r.unidade_medida ?? '—'}</div>
                      </>
                    ) : null}

                    {prevCol('quantidade') ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text, #555)' }}>
                        Quantidade contada:
                        {editingPreviewId === r.id ? (
                          <input
                            type="number"
                            step="0.001"
                            value={editingPreviewQuantidade}
                            onChange={(e) => setEditingPreviewQuantidade(e.target.value)}
                            style={{
                              marginLeft: 8,
                              padding: '8px 10px',
                              border: '1px solid #ccc',
                              borderRadius: 8,
                              width: 110,
                              boxSizing: 'border-box',
                            }}
                          />
                        ) : (
                          <span style={{ marginLeft: 8 }}>{r.quantidade_up}</span>
                        )}
                      </div>
                    ) : null}

                    {prevCol('data_fabricacao') ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text, #555)' }}>
                        Data de fabricação:{' '}
                        {r.data_fabricacao ? formatDateBRFromYmd(String(r.data_fabricacao).slice(0, 10)) : '—'}
                      </div>
                    ) : null}
                    {prevCol('data_validade') ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text, #555)' }}>
                        Data de vencimento:{' '}
                        {r.data_validade ? formatDateBRFromYmd(String(r.data_validade).slice(0, 10)) : '—'}
                      </div>
                    ) : null}

                    {prevCol('lote') ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text, #555)' }}>Lote: {r.lote ?? '—'}</div>
                    ) : null}

                    {prevCol('up') ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text, #555)' }}>
                        UP: {r.quantidade_up_secundaria != null ? r.quantidade_up_secundaria : '—'}
                      </div>
                    ) : null}
                    {prevCol('observacao') ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text, #555)' }}>
                        Observação: {r.observacao ?? '—'}
                      </div>
                    ) : null}
                    {prevCol('ean') ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text, #555)' }}>EAN: {r.ean ?? '—'}</div>
                    ) : null}
                    {prevCol('dun') ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text, #555)' }}>DUN: {r.dun ?? '—'}</div>
                    ) : null}
                    {prevCol('foto') ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text, #555)' }}>
                        Foto: {hasPhoto ? 'Com foto' : 'Sem foto'}
                      </div>
                    ) : null}
                  </div>

                  {prevCol('acoes') ? (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {editingPreviewId === r.id ? (
                      <>
                        <button
                          type="button"
                          style={buttonStyle}
                          onClick={() => handlePreviewSave(r.id)}
                          disabled={previewRowActionLoading}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          style={{ ...buttonStyle, background: '#444' }}
                          onClick={() => {
                            setEditingPreviewId(null)
                            setEditingPreviewQuantidade('')
                            setPreviewRowError('')
                          }}
                          disabled={previewRowActionLoading}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={buttonStyle}
                          onClick={() => {
                            setEditingPreviewId(r.id)
                            setEditingPreviewQuantidade(String(r.quantidade_up))
                            setPreviewRowError('')
                          }}
                          disabled={previewRowActionLoading}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          style={{ ...buttonStyle, background: '#8a0000' }}
                          onClick={() => handlePreviewDelete(r.id)}
                          disabled={previewRowActionLoading}
                        >
                          Excluir
                        </button>
                        {r.foto_base64 ? (
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#a85a00' }}
                            onClick={() => handlePreviewClearPhoto(r.id)}
                            disabled={previewRowActionLoading}
                          >
                            Remover foto
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        {previewRowError ? <div style={{ color: '#b00020', marginBottom: 8 }}>{previewRowError}</div> : null}
        {previewFiltersBar}
        {previewPagination}
        <table
          style={{
            borderCollapse: 'collapse',
            width: 'max-content',
            minWidth: Math.max(360, previewVisColCount * 90),
          }}
        >
          <thead>
            <tr>
              <th style={thStyle}>Câmara</th>
              <th style={thStyle}>Rua</th>
              <th style={thStyle}>POS</th>
              <th style={thStyle}>Nível</th>
              {inventario ? <th style={thStyle}>Contagem</th> : null}
              <th style={thStyle}>Conferente</th>
              {prevCol('codigo') ? <th style={thStyle}>Código do produto</th> : null}
              {prevCol('descricao') ? <th style={thStyle}>Descrição</th> : null}
              {prevCol('unidade') ? <th style={thStyle}>Unidade de medida</th> : null}
              {prevCol('quantidade') ? <th style={thStyle}>Quantidade contada</th> : null}
              {prevCol('data_fabricacao') ? <th style={thStyle}>Data de fabricação</th> : null}
              {prevCol('data_validade') ? <th style={thStyle}>Data de vencimento</th> : null}
              {prevCol('lote') ? <th style={thStyle}>Lote</th> : null}
              {prevCol('up') ? <th style={thStyle}>UP</th> : null}
              {prevCol('observacao') ? <th style={thStyle}>Observação</th> : null}
              {prevCol('ean') ? <th style={thStyle}>EAN</th> : null}
              {prevCol('dun') ? <th style={thStyle}>DUN</th> : null}
              {prevCol('foto') ? <th style={thStyle}>Foto</th> : null}
              {prevCol('acoes') ? <th style={thStyle}>Ações</th> : null}
            </tr>
          </thead>
          <tbody data-checklist-nav-root onKeyDown={handleChecklistFieldNavKeyDown}>
            {displayPreviewRows.map((r) => {
              const hasPhoto = Boolean(String(r.foto_base64 ?? '').trim())
              const datasOrdemInvalida = isVencimentoAntesFabricacao(r.data_fabricacao, r.data_validade)
              return (
                <tr
                  key={r.id}
                  style={
                    datasOrdemInvalida
                      ? { background: 'rgba(198, 40, 40, 0.14)', boxShadow: 'inset 0 0 0 1px rgba(198, 40, 40, 0.55)' }
                      : undefined
                  }
                >
                  <td style={tdStyle}>{inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem)}</td>
                  <td style={tdStyle}>
                    {r.planilha_rua != null && String(r.planilha_rua).trim() !== '' ? r.planilha_rua : '—'}
                  </td>
                  <td style={tdStyle}>
                    {r.planilha_posicao != null && Number.isFinite(Number(r.planilha_posicao))
                      ? r.planilha_posicao
                      : '—'}
                  </td>
                  <td style={tdStyle}>
                    {r.planilha_nivel != null && Number.isFinite(Number(r.planilha_nivel)) ? r.planilha_nivel : '—'}
                  </td>
                  {inventario ? (
                    <td style={tdStyle}>{formatInventarioRodadaPreviewCell(r.inventario_numero_contagem)}</td>
                  ) : null}
                  <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 200 }}>
                    {String(r.conferente_nome ?? '').trim() !== '' ? r.conferente_nome : '—'}
                  </td>
                  {prevCol('codigo') ? <td style={tdStyle}>{r.codigo_interno}</td> : null}
                  {prevCol('descricao') ? (
                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>{r.descricao}</td>
                  ) : null}
                  {prevCol('unidade') ? <td style={tdStyle}>{r.unidade_medida ?? ''}</td> : null}
                  {prevCol('quantidade') ? (
                    <td style={tdStyle}>
                      {editingPreviewId === r.id ? (
                        <input
                          type="number"
                          step="0.001"
                          value={editingPreviewQuantidade}
                          onChange={(e) => setEditingPreviewQuantidade(e.target.value)}
                          style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 8, width: 104 }}
                        />
                      ) : (
                        r.quantidade_up
                      )}
                    </td>
                  ) : null}
                  {prevCol('data_fabricacao') ? (
                    <td style={tdStyle}>
                      {r.data_fabricacao ? formatDateBRFromYmd(String(r.data_fabricacao).slice(0, 10)) : ''}
                    </td>
                  ) : null}
                  {prevCol('data_validade') ? (
                    <td style={tdStyle}>
                      {r.data_validade ? formatDateBRFromYmd(String(r.data_validade).slice(0, 10)) : ''}
                    </td>
                  ) : null}
                  {prevCol('lote') ? <td style={tdStyle}>{r.lote ?? ''}</td> : null}
                  {prevCol('up') ? (
                    <td style={tdStyle}>{r.quantidade_up_secundaria != null ? r.quantidade_up_secundaria : ''}</td>
                  ) : null}
                  {prevCol('observacao') ? <td style={tdStyle}>{r.observacao ?? ''}</td> : null}
                  {prevCol('ean') ? <td style={tdStyle}>{r.ean ?? ''}</td> : null}
                  {prevCol('dun') ? <td style={tdStyle}>{r.dun ?? ''}</td> : null}
                  {prevCol('foto') ? (
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--text, #888)', fontSize: 12 }}>
                        {hasPhoto ? 'Com foto' : 'Sem foto'}
                      </span>
                    </td>
                  ) : null}
                  {prevCol('acoes') ? (
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {editingPreviewId === r.id ? (
                          <>
                            <button
                              type="button"
                              style={buttonStyle}
                              onClick={() => handlePreviewSave(r.id)}
                              disabled={previewRowActionLoading}
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              style={{ ...buttonStyle, background: '#444' }}
                              onClick={() => {
                                setEditingPreviewId(null)
                                setEditingPreviewQuantidade('')
                                setPreviewRowError('')
                              }}
                              disabled={previewRowActionLoading}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              style={buttonStyle}
                              onClick={() => {
                                setEditingPreviewId(r.id)
                                setEditingPreviewQuantidade(String(r.quantidade_up))
                                setPreviewRowError('')
                              }}
                              disabled={previewRowActionLoading}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              style={{ ...buttonStyle, background: '#8a0000' }}
                              onClick={() => handlePreviewDelete(r.id)}
                              disabled={previewRowActionLoading}
                            >
                              Excluir
                            </button>
                            {r.foto_base64 ? (
                              <button
                                type="button"
                                style={{ ...buttonStyle, background: '#a85a00' }}
                                onClick={() => handlePreviewClearPhoto(r.id)}
                                disabled={previewRowActionLoading}
                              >
                                Remover foto
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
        {totalFiltered > 0 ? previewPagination : null}
      </div>
    )
  }

  const checklistPending = useMemo(() => countPendingForSession(offlineSession), [offlineSession])

  const checklistProgressTotal = useMemo(() => {
    if (offlineSession?.status !== 'aberta') return 0
    if (offlineSession.listMode === 'planilha') {
      return offlineSession.items.filter((i) => String(i.codigo_interno ?? '').trim() !== '').length
    }
    return offlineSession.items.length
  }, [offlineSession])

  const checklistCounted = useMemo(() => {
    if (offlineSession?.status !== 'aberta') return 0
    if (offlineSession.listMode === 'planilha') {
      return offlineSession.items.filter((i) => {
        const c = String(i.codigo_interno ?? '').trim()
        if (!c) return false
        return String(i.quantidade_contada ?? '').trim() !== ''
      }).length
    }
    return offlineSession.items.length - checklistPending
  }, [offlineSession, checklistPending])

  const filteredChecklistItems =
    offlineSession?.status === 'aberta'
      ? offlineSession.items.filter((it) => {
          const codOk =
            !checklistFilterCodigo.trim() ||
            it.codigo_interno.toLowerCase().includes(checklistFilterCodigo.trim().toLowerCase()) ||
            normalizeCodigoInternoCompareKey(it.codigo_interno)
              .toLowerCase()
              .includes(normalizeCodigoInternoCompareKey(checklistFilterCodigo).toLowerCase())
          const descOk =
            !checklistFilterDescricao.trim() ||
            it.descricao.toLowerCase().includes(checklistFilterDescricao.trim().toLowerCase())
          const pend =
            offlineSession.listMode === 'planilha'
              ? String(it.codigo_interno ?? '').trim() !== '' &&
                String(it.quantidade_contada ?? '').trim() === ''
              : String(it.quantidade_contada ?? '').trim() === ''
          const pendOk = !checklistFilterPendentes || pend
          return codOk && descOk && pendOk
        })
      : []

  type ChecklistDisplayHeader = {
    kind: 'header'
    key: string
    contagem: number | null
  }
  type ChecklistDisplayItem = ChecklistDisplayHeader | OfflineChecklistItem

  const armazemModoIncompleto =
    offlineSession?.status === 'aberta' && isListModeArmazem(offlineSession.listMode)
      ? offlineSession.items.some((it) => getArmazemContagemForItem(it) === null)
      : false

  const checklistDisplayItems: ChecklistDisplayItem[] =
    offlineSession?.status === 'aberta' && isListModeArmazem(offlineSession.listMode) && !armazemModoIncompleto
      ? (() => {
          const out: ChecklistDisplayItem[] = []
          let lastContagem: number | null = null
          let hdrSeq = 0
          for (const it of filteredChecklistItems) {
            const contagem = getArmazemContagemForItem(it)
            if (contagem === null) continue // deveria não acontecer (validação na carga)
            if (contagem !== lastContagem) {
              out.push({
                kind: 'header',
                key: `hdr-${contagem}-${hdrSeq++}`,
                contagem,
              })
              lastContagem = contagem
            }
            out.push(it)
          }
          return out
        })()
      : armazemModoIncompleto
        ? []
        : filteredChecklistItems

  const isArmazemPaginado =
    offlineSession?.status === 'aberta' &&
    isListModeArmazem(offlineSession.listMode) &&
    !armazemModoIncompleto

  const armazemGrupos = isArmazemPaginado
    ? [...INVENTARIO_ARMAZEM_GRUPO_IDS]
        .map((contagem) => ({
          contagem,
          items: filteredChecklistItems.filter((it) => getArmazemContagemForItem(it) === contagem),
        }))
        .filter((g) => g.items.length > 0)
    : []

  const checklistProductTotal = checklistDisplayItems.reduce((acc, item) => {
    const isHeader = 'kind' in item && item.kind === 'header'
    return acc + (isHeader ? 0 : 1)
  }, 0)
  const checklistTotalPages = Math.max(
    1,
    isArmazemPaginado && !checklistShowAll
      ? armazemGrupos.length
      : Math.ceil(checklistProductTotal / CHECKLIST_PAGE_SIZE),
  )
  const checklistPageSafe = Math.min(checklistPage, checklistTotalPages)
  const checklistRangeFrom =
    isArmazemPaginado
      ? checklistProductTotal === 0
        ? 0
        : checklistShowAll
          ? 1
          : armazemGrupos.slice(0, checklistPageSafe - 1).reduce((acc, g) => acc + g.items.length, 0) + 1
      : checklistProductTotal === 0
      ? 0
      : checklistShowAll
        ? 1
        : (checklistPageSafe - 1) * CHECKLIST_PAGE_SIZE + 1
  const checklistRangeTo =
    isArmazemPaginado
      ? checklistProductTotal === 0
        ? 0
        : checklistShowAll
          ? checklistProductTotal
          : armazemGrupos.slice(0, checklistPageSafe).reduce((acc, g) => acc + g.items.length, 0)
      : checklistProductTotal === 0
      ? 0
      : checklistShowAll
        ? checklistProductTotal
        : Math.min(checklistPageSafe * CHECKLIST_PAGE_SIZE, checklistProductTotal)

  const checklistDisplayPageItems: ChecklistDisplayItem[] =
    checklistShowAll
      ? checklistDisplayItems
      : isArmazemPaginado
        ? (() => {
            const group = armazemGrupos[checklistPageSafe - 1]
            if (!group) return []
            const header: ChecklistDisplayHeader = {
              kind: 'header',
              key: `hdr-page-${group.contagem}`,
              contagem: group.contagem,
            }
            return [header, ...group.items]
          })()
      : (() => {
          const out: ChecklistDisplayItem[] = []
          const start = (checklistPageSafe - 1) * CHECKLIST_PAGE_SIZE
          const end = start + CHECKLIST_PAGE_SIZE
          let index = 0
          let pendingHeader: ChecklistDisplayHeader | null = null
          for (const item of checklistDisplayItems) {
            const isHeader = 'kind' in item && item.kind === 'header'
            if (isHeader) {
              pendingHeader = item as ChecklistDisplayHeader
              continue
            }
            if (index >= start && index < end) {
              if (pendingHeader) {
                out.push(pendingHeader)
                pendingHeader = null
              }
              out.push(item)
            }
            index++
            if (index >= end) break
          }
          return out
        })()

  const inventarioPlanilhaArmazem = inventario && isArmazemPaginado && !checklistShowAll

  /** Modo planilha: troca de RUA/CAMARA só pelas abas — não usar Anterior/Próxima como “página da tabela”. */
  const isPlanilhaInventarioNav =
    Boolean(inventario && offlineSession?.status === 'aberta' && offlineSession.listMode === 'planilha')

  const armazemGrupoAtual = isArmazemPaginado ? armazemGrupos[checklistPageSafe - 1] : null

  const armazemItemsSorted = useMemo(() => {
    if (!offlineSession || offlineSession.status !== 'aberta' || armazemGrupoAtual?.contagem == null) {
      return [] as OfflineChecklistItem[]
    }
    /** Lista **completa** do grupo (ignora filtros da checklist). Índice POS/Nível = mesmo de `buildPlanilhaLayoutPorItens` ao finalizar. */
    const full = offlineSession.items.filter((it) => getArmazemContagemForItem(it) === armazemGrupoAtual.contagem)
    return [...full].sort(compareInventarioPlanilhaItens)
  }, [offlineSession?.items, offlineSession?.status, armazemGrupoAtual?.contagem])

  const inventarioNumeroContagemRodada = clampInventarioNumeroContagem(
    offlineSession?.inventario_numero_contagem ?? 1,
  )

  const planilhaQtdContagemHeader =
    inventario && isArmazemPaginado
      ? formatContagemLabel(inventarioNumeroContagemRodada)
      : armazemGrupoAtual
        ? formatContagemLabel(armazemGrupoAtual.contagem)
        : 'CONTAGEM'

  /**
   * Todas as linhas da aba atual na ordem da planilha (POS/NIVEL). A tabela mostra só uma fatia por página.
   */
  const linhasTabelaPlanilhaInventario = useMemo((): OfflineChecklistItem[] => {
    if (!inventarioPlanilhaArmazem) return []
    return armazemItemsSorted
  }, [inventarioPlanilhaArmazem, armazemItemsSorted])

  const planilhaTabelaTotalPages = Math.max(
    1,
    Math.ceil(linhasTabelaPlanilhaInventario.length / PLANILHA_TABELA_PAGE_SIZE) || 1,
  )
  const planilhaTabelaPageSafe = Math.min(Math.max(1, planilhaTabelaPage), planilhaTabelaTotalPages)
  const itemsPlanilhaTabelaPagina = useMemo(() => {
    const start = (planilhaTabelaPageSafe - 1) * PLANILHA_TABELA_PAGE_SIZE
    return linhasTabelaPlanilhaInventario.slice(start, start + PLANILHA_TABELA_PAGE_SIZE)
  }, [linhasTabelaPlanilhaInventario, planilhaTabelaPageSafe])
  const planilhaTabelaRangeFrom =
    linhasTabelaPlanilhaInventario.length === 0
      ? 0
      : (planilhaTabelaPageSafe - 1) * PLANILHA_TABELA_PAGE_SIZE + 1
  const planilhaTabelaRangeTo = Math.min(
    planilhaTabelaPageSafe * PLANILHA_TABELA_PAGE_SIZE,
    linhasTabelaPlanilhaInventario.length,
  )

  const checklistColumns = useMemo(() => {
    const cols = [
      { id: 'conferente', label: 'Conferente' },
      { id: 'codigo', label: 'Código do produto' },
      { id: 'descricao', label: 'Descrição' },
      { id: 'unidade', label: 'Unidade de medida' },
      { id: 'quantidade', label: 'Quantidade contada' },
      { id: 'data_fabricacao', label: 'Data de fabricação' },
      { id: 'data_validade', label: 'Data de vencimento' },
      { id: 'lote', label: 'Lote' },
      { id: 'up', label: 'UP' },
      { id: 'observacao', label: 'Observação' },
      { id: 'ean', label: 'EAN' },
      { id: 'dun', label: 'DUN' },
      { id: 'foto', label: 'Foto' },
      { id: 'acoes', label: 'Ações' },
    ] as Array<{ id: string; label: string }>
    return cols
  }, [])

  const visibleChecklistColumns = checklistColumns.filter((c) => checklistVisibleCols[c.id] !== false)
  const visibleChecklistColCount = Math.max(1, visibleChecklistColumns.length)
  const showChecklistColumn = (id: string) => checklistVisibleCols[id] !== false

  // "Armazém" foi descontinuado no seletor; mantém compatibilidade com estado salvo antigo.
  const checklistListModeUi: ChecklistListMode =
    checklistListMode === 'armazem' ? 'todos' : checklistListMode

  const carregarListaDisabled = checklistLoading || finalizing || !conferenteId
  const finalizarListaDisabled =
    finalizing ||
    !offlineSession ||
    offlineSession.status !== 'aberta' ||
    offlineSession.items.length === 0

  return (
    <div
      style={{
        padding: isMobile ? 10 : 16,
        maxWidth: 1200,
        margin: '0 auto',
        textAlign: 'left',
        color: '#ffd95c',
      }}
    >
      <h2>{inventario ? 'Inventário físico' : 'Contagem de Estoque'}</h2>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: '1px solid var(--border, #ccc)',
          borderRadius: 10,
          background: 'var(--panel-bg, rgba(0,0,0,.04))',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 18 }}>
          {inventario ? 'Inventário (offline → banco)' : 'Contagem diária (offline → banco)'}
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'inherit', opacity: 0.95 }}>
          {inventario ? (
            <>
              <strong>Inventário:</strong> cada produto aparece <strong>três vezes</strong> na lista (1ª, 2ª e 3ª contagem).
              Você pode usar o mesmo <strong>tipo de lista</strong> da contagem diária: ordem do cadastro ou{' '}
              <strong>Armazém</strong> (dividida em grupos 1ª–4ª contagem). Carregue a lista a partir de{' '}
              <strong>Todos os Produtos</strong>, preencha as quantidades e use <strong>Finalizar inventário</strong> para gravar
              em <code style={{ fontSize: 12 }}>contagens_estoque</code> (campos{' '}
              <code style={{ fontSize: 12 }}>origem=inventario</code> e repetição) e uma linha correspondente em{' '}
              <code style={{ fontSize: 12 }}>inventario_planilha_linhas</code> (formato planilha: RUA, POS, NIVEL, etc.). SQL:{' '}
              <code style={{ fontSize: 12 }}>alter_contagens_estoque_origem_inventario.sql</code> e{' '}
              <code style={{ fontSize: 12 }}>create_inventario_planilha_linhas.sql</code>.
            </>
          ) : (
            <>
              Carregue a lista a partir da tabela <strong>public.&quot;Todos os Produtos&quot;</strong> (codigo_interno + descricao), preencha as quantidades no app
              (salvo no navegador) e clique em <strong>Finalizar contagem diária</strong> para gravar em{' '}
              <strong>contagens_estoque</strong>.
            </>
          )}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)',
            gap: 12,
            alignItems: 'end',
            marginBottom: 4,
          }}
        >
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 6' }}>
            Conferente
            <select
              value={conferenteId}
              onChange={(e) => setConferenteId(e.target.value)}
              style={inputStyle}
              disabled={conferentesLoading || (!!offlineSession && offlineSession.status === 'aberta')}
            >
              <option value="">Selecione...</option>
              {conferentes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 6', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={() => setShowAddConferente((v) => !v)}
              disabled={addingConferente || (!!offlineSession && offlineSession.status === 'aberta')}
              style={buttonStyle}
            >
              {showAddConferente ? 'Cancelar' : 'Cadastrar conferente'}
            </button>

            {showAddConferente ? (
              offlineSession?.status === 'aberta' ? (
                <div style={{ fontSize: 12, color: 'var(--text, #888)' }}>
                  Finalize ou descarte a sessão da checklist para cadastrar um novo conferente.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
                    gap: 8,
                    alignItems: 'end',
                  }}
                >
                  <div style={labelStyle}>
                    Nome do conferente
                    <input
                      value={newConferenteNome}
                      onChange={(e) => setNewConferenteNome(e.target.value)}
                      style={inputStyle}
                      placeholder="Ex: João Silva"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nome = newConferenteNome.trim()
                      if (!nome) return
                      setAddingConferente(true)
                      setSaveError('')

                      const { data, error } = await supabase
                        .from('conferentes')
                        .insert({ nome })
                        .select('id,nome')
                        .maybeSingle()

                      if (error) {
                        if (error.code === '42501' || String(error.message).toLowerCase().includes('row-level security')) {
                          setSaveError(
                            'Sem permissão para cadastrar conferente no banco. Rode o SQL de policy (RLS) no Supabase para liberar insert em conferentes.',
                          )
                        } else {
                          setSaveError(`Erro ao cadastrar conferente: ${error.message}`)
                        }
                      } else if (data?.id) {
                        setConferenteId(data.id)
                        setNewConferenteNome('')
                        setShowAddConferente(false)
                        const { data: list } = await supabase.from('conferentes').select('id,nome').order('nome')
                        setConferentes(list ?? [])
                      }

                      setAddingConferente(false)
                    }}
                    disabled={addingConferente}
                    style={buttonStyle}
                  >
                    {addingConferente ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              )
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 3' }}>
            Data e hora do registro
            <input
              type="datetime-local"
              value={dataHoraContagem}
              onChange={(e) => {
                const dt = new Date(e.target.value)
                if (!Number.isNaN(dt.getTime())) {
                  setClockBaseMs(dt.getTime())
                  setClockRealStartMs(Date.now())
                }
              }}
              disabled={!!offlineSession && offlineSession.status === 'aberta'}
              style={inputStyle}
            />
          </label>
          <div style={{ gridColumn: isMobile ? 'auto' : 'span 9', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, minWidth: 260 }}>
              Tipo de lista
              <select
                value={checklistListModeUi}
                onChange={(e) => setChecklistListMode(e.target.value as ChecklistListMode)}
                style={inputStyle}
                disabled={!!offlineSession && offlineSession.status === 'aberta'}
              >
                <option value="todos">Todos os Produtos (cadastro)</option>
                {inventario ? (
                  <option value="planilha">Inventário — formato planilha (CAMARA/RUA, abas)</option>
                ) : null}
              </select>
            </label>
            <button
              type="button"
              style={{
                ...buttonStyle,
                ...checklistActionBtnCarregar,
                ...(carregarListaDisabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
              }}
              disabled={carregarListaDisabled}
              onClick={() => void handleCarregarListaPlanilha()}
            >
              <span className="app-nav-icon app-nav-icon--bounce" aria-hidden>
                📥
              </span>
              {checklistLoading ? 'Carregando lista…' : 'Carregar lista de produtos'}
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, ...checklistActionBtnAtualizar }}
              disabled={productOptionsLoading || finalizing}
              title="Recarrega a tabela Todos os Produtos e reaplica descrição/unidade nas linhas da planilha já preenchidas"
              onClick={() => void handleAtualizarCadastroProdutos()}
            >
              <span className="app-nav-icon app-nav-icon--pulse" aria-hidden>
                🔄
              </span>
              {productOptionsLoading ? 'Atualizando cadastro…' : 'Atualizar cadastro'}
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, ...checklistActionBtnLimpar }}
              disabled={finalizing}
              onClick={() => handleDescartarSessaoLocal()}
            >
              <span className="app-nav-icon app-nav-icon--float" aria-hidden>
                🧹
              </span>
              Limpar sessão local
            </button>
            <button
              type="button"
              style={{
                ...buttonStyle,
                ...checklistActionBtnFinalizar(finalizarListaDisabled, checklistPending),
              }}
              disabled={finalizarListaDisabled}
              onClick={() => void handleFinalizarContagemDiaria()}
            >
              <span className="app-nav-icon app-nav-icon--glow" aria-hidden>
                {finalizarListaDisabled ? '🔒' : checklistPending > 0 ? '⏳' : '✅'}
              </span>
              {finalizing ? 'Finalizando…' : inventario ? 'Finalizar inventário' : 'Finalizar contagem diária'}
            </button>
          </div>
        </div>

        {finalizeProgress ? (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text, #555)' }}>{finalizeProgress}</div>
        ) : null}

        {checklistError ? <div style={{ color: '#b00020', marginTop: 10 }}>{checklistError}</div> : null}
        {!productOptionsLoading && productOptions.length === 0 && produtoError ? (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #c62828',
              background: 'rgba(198, 40, 40, 0.08)',
              color: '#b00020',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <strong>Catálogo de produtos:</strong> {produtoError}
          </div>
        ) : null}
        {startFreshNotice ? (
          <div style={{ color: '#0a0', marginTop: 8, fontSize: 13, textAlign: 'left' }}>
            {startFreshNotice}
          </div>
        ) : null}
        {!conferenteId ? (
          <div style={{ color: 'var(--text, #888)', marginTop: 8, fontSize: 13 }}>
            Selecione um <strong>conferente</strong> acima para habilitar &quot;Carregar lista de produtos&quot;.
          </div>
        ) : null}

        {offlineSession && offlineSession.status === 'aberta' ? (
          <>
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 14 }}>
                Progresso: <strong>{checklistCounted}</strong> contados / <strong>{checklistProgressTotal}</strong> total
                {checklistPending > 0 ? (
                  <span style={{ color: '#a60', marginLeft: 8 }}>({checklistPending} pendente(s))</span>
                ) : (
                  <span style={{ color: '#0a0', marginLeft: 8 }}>Todos preenchidos — pode finalizar.</span>
                )}
                {isListModeArmazem(offlineSession.listMode) && armazemModoIncompleto ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#b00020' }}>
                    Erro: modo armazém incompleto (faltam mapeamentos). Atualize o app para cobrir todos os códigos da tabela
                    <span style={{ fontFamily: 'monospace' }}> Todos os Produtos</span>.
                  </div>
                ) : null}
                {checklistListCollapsed ? (
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text, #888)' }}>
                    Lista minimizada — use o botão ao lado para ver filtros e quantidades.
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                style={{ ...buttonStyle, background: '#444', fontSize: 13 }}
                onClick={() => handleToggleChecklistCollapse()}
              >
                {checklistListCollapsed ? 'Expandir lista' : 'Minimizar lista'}
              </button>
            </div>
            {!checklistListCollapsed ? (
              <>
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text, #888)' }}>
                  Informe a <strong>quantidade</strong> diretamente na coluna Quantidade contada — cada alteração é{' '}
                  <strong>gravada na hora</strong> no navegador (sessão local). Use <strong>Editar</strong> para ajustar
                  código, descrição ou quantidade na mesma linha.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
                  <input
                    placeholder="Filtrar código"
                    value={checklistFilterCodigo}
                    onChange={(e) => setChecklistFilterCodigo(e.target.value)}
                    style={{ ...inputStyle, maxWidth: 220 }}
                  />
                  <input
                    placeholder="Filtrar descrição"
                    value={checklistFilterDescricao}
                    onChange={(e) => setChecklistFilterDescricao(e.target.value)}
                    style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checklistFilterPendentes}
                      onChange={(e) => setChecklistFilterPendentes(e.target.checked)}
                    />
                    Só pendentes
                  </label>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    alignItems: 'center',
                    fontSize: 12,
                    color: 'var(--text, #777)',
                  }}
                >
                  <strong style={{ fontSize: 12 }}>Ocultar/mostrar colunas:</strong>
                  {checklistColumns.map((c) => (
                    <label key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={showChecklistColumn(c.id)}
                        onChange={(e) =>
                          setChecklistVisibleCols((prev) => ({
                            ...prev,
                            [c.id]: e.target.checked,
                          }))
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                  <span style={{ width: '100%', fontSize: 11, color: 'var(--text, #888)', marginTop: 2 }}>
                    Suas escolhas ficam salvas neste navegador (contagem e inventário têm preferências separadas).
                  </span>
                </div>
                {inventario && isArmazemPaginado && !checklistShowAll && armazemGrupos.length > 0 ? (
                  <>
                    <div
                      style={{
                        marginTop: 10,
                        marginBottom: 10,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--border, #ccc)',
                        background: 'var(--panel-bg, rgba(0,0,0,.03))',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #111)' }}>
                        Contagem da rodada (mesma em todas as abas)
                      </span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text, #666)' }}>Número</span>
                        <select
                          value={String(inventarioNumeroContagemRodada)}
                          onChange={(e) =>
                            setInventarioNumeroContagemRodada(
                              clampInventarioNumeroContagem(Number(e.target.value)) as 1 | 2 | 3 | 4,
                            )
                          }
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border, #ccc)',
                            fontSize: 14,
                            fontWeight: 700,
                            minWidth: 120,
                          }}
                          aria-label="Número da contagem de 1 a 4"
                        >
                          <option value="1">1ª contagem</option>
                          <option value="2">2ª contagem</option>
                          <option value="3">3ª contagem</option>
                          <option value="4">4ª contagem</option>
                        </select>
                      </label>
                      <span style={{ fontSize: 12, color: 'var(--text, #888)', maxWidth: 420 }}>
                        O cabeçalho da coluna de quantidade acompanha este número. Ao finalizar, o valor é gravado no
                        banco para filtrar no relatório por data e por contagem.
                      </span>
                    </div>
                    <InventarioPlanilhaAbas
                      armazemGrupos={armazemGrupos}
                      checklistPageSafe={checklistPageSafe}
                      setChecklistPage={setChecklistPage}
                    />
                  </>
                ) : null}
                {isMobile ? (
                  <>
                    <div
                      data-checklist-nav-root
                      style={{ marginTop: 8, display: 'grid', gap: 8 }}
                      onKeyDown={handleChecklistFieldNavKeyDown}
                    >
                    {checklistDisplayPageItems.map((item) => {
                      if ('kind' in item && item.kind === 'header') {
                        return (
                          <div
                            key={item.key}
                            style={{
                              padding: '8px 8px',
                              fontWeight: 800,
                              fontSize: 11,
                              border: '1px solid #444',
                              borderRadius: 8,
                              background: 'rgba(255, 255, 255, .04)',
                              color: 'var(--text, #111)',
                            }}
                          >
                            {inventario ? inventarioAbaTitulo(item.contagem) : formatArmazemGroupLabel(item.contagem)}
                          </div>
                        )
                      }

                      const it = item as OfflineChecklistItem
                      const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
                      const pend = String(it.quantidade_contada ?? '').trim() === ''
                      const isEditing = checklistEditingKey === it.key && checklistEditDraft
                      const datasOrdemInvalida = isVencimentoAntesFabricacao(it.data_fabricacao, it.data_validade)

                      return (
                        <div
                          key={it.key}
                          style={{
                            border: datasOrdemInvalida ? '1px solid #c62828' : '1px solid var(--border, #ccc)',
                            borderRadius: 10,
                            padding: 8,
                            background: datasOrdemInvalida ? 'rgba(198, 40, 40, 0.12)' : undefined,
                          }}
                        >
                          {isEditing && checklistEditDraft ? (
                            <>
                              <div style={{ display: 'grid', gap: 8 }}>
                                <label style={{ ...labelStyle }}>
                                  Código do produto
                                  <input
                                    value={checklistEditDraft.codigo_interno}
                                    onChange={(e) =>
                                      setChecklistEditDraft((d) =>
                                        d ? { ...d, codigo_interno: e.target.value } : d,
                                      )
                                    }
                                    style={{ ...inputStyle, minWidth: 0, padding: '8px 10px', fontSize: 13 }}
                                  />
                                </label>
                                <label style={{ ...labelStyle }}>
                                  Descrição
                                  <textarea
                                    value={checklistEditDraft.descricao}
                                    onChange={(e) =>
                                      setChecklistEditDraft((d) =>
                                        d ? { ...d, descricao: e.target.value } : d,
                                      )
                                    }
                                    rows={2}
                                    style={{ ...inputStyle, resize: 'vertical', minHeight: 42, padding: '8px 10px', fontSize: 13 }}
                                  />
                                </label>
                                <label style={{ ...labelStyle }}>
                                  Quantidade contada
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={checklistEditDraft.quantidade_contada}
                                    onChange={(e) =>
                                      setChecklistEditDraft((d) =>
                                        d ? { ...d, quantidade_contada: e.target.value } : d,
                                      )
                                    }
                                    style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                    placeholder="—"
                                  />
                                </label>
                              </div>
                              <div style={{ marginTop: 8, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#0b5', fontSize: 12, padding: '8px 10px' }}
                                  onClick={() => saveChecklistEdit()}
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '8px 10px' }}
                                  onClick={() => cancelChecklistEdit()}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              {showChecklistColumn('conferente') ? (
                                <div style={{ fontSize: 11, color: 'var(--text, #666)', marginBottom: 6 }}>
                                  Conferente: <strong style={{ fontWeight: 600 }}>{conferenteNomeSelecionado}</strong>
                                </div>
                              ) : null}
                              <div style={{ fontSize: 11, color: 'var(--text, #666)', marginBottom: 4 }}>
                                Status: <strong style={{ color: pend ? '#a60' : '#0a0' }}>{pend ? 'Pendente' : 'Contado'}</strong>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
                                {it.codigo_interno}
                                {it.inventario_repeticao ? (
                                  <span style={{ marginLeft: 8, fontSize: 11, color: '#0a7', fontWeight: 700 }}>
                                    ({it.inventario_repeticao}ª contagem)
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: 12, whiteSpace: 'normal', color: 'var(--text, #111)', marginTop: 2 }}>{it.descricao}</div>
                              {showChecklistColumn('ean') || showChecklistColumn('dun') ? (
                                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text, #666)', display: 'grid', gap: 2 }}>
                                  {showChecklistColumn('ean') ? <div>EAN: {it.ean ?? '—'}</div> : null}
                                  {showChecklistColumn('dun') ? <div>DUN: {it.dun ?? '—'}</div> : null}
                                </div>
                              ) : null}
                              {showChecklistColumn('foto') ? (
                                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text, #666)' }}>
                                  Foto: {hasPhoto ? 'Com foto' : 'Sem foto'}
                                </div>
                              ) : null}

                              <label style={{ ...labelStyle, marginTop: 8, gap: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span>Quantidade contada</span>
                                  {checklistSavedFlashKey === it.key ? (
                                    <span style={{ fontSize: 11, color: '#0a0', fontWeight: 700 }}>Salvo na sessão</span>
                                  ) : null}
                                </div>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={it.quantidade_contada}
                                  onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                  style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                  placeholder="—"
                                />
                              </label>

                              {showChecklistColumn('unidade') ||
                              showChecklistColumn('data_fabricacao') ||
                              showChecklistColumn('data_validade') ||
                              showChecklistColumn('lote') ||
                              showChecklistColumn('up') ||
                              showChecklistColumn('observacao') ? (
                                <div
                                  style={{
                                    marginTop: 8,
                                    display: 'grid',
                                    gap: 8,
                                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                  }}
                                >
                                  {showChecklistColumn('unidade') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Unidade de medida</span>
                                      <input
                                        type="text"
                                        value={it.unidade_medida ?? ''}
                                        onChange={(e) =>
                                          updateOfflineItemFields(it.key, {
                                            unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                                          })
                                        }
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                  {showChecklistColumn('data_fabricacao') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Data de fabricação</span>
                                      <input
                                        type="date"
                                        value={it.data_fabricacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })}
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                      />
                                    </label>
                                  ) : null}
                                  {showChecklistColumn('data_validade') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Data de vencimento</span>
                                      <input
                                        type="date"
                                        value={it.data_validade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_validade: e.target.value })}
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                      />
                                    </label>
                                  ) : null}
                                  {showChecklistColumn('lote') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Lote</span>
                                      <input
                                        type="text"
                                        value={it.lote ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                  {showChecklistColumn('up') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>UP</span>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={it.up_quantidade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { up_quantidade: e.target.value })}
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                  {showChecklistColumn('observacao') ? (
                                    <label style={{ ...labelStyle, gap: 4, gridColumn: '1 / -1' }}>
                                      <span>Observação</span>
                                      <input
                                        type="text"
                                        value={it.observacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { observacao: e.target.value })}
                                        style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              ) : null}

                              <div style={{ marginTop: 8, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 12, padding: '8px 8px' }}
                                  onClick={() => openChecklistEdit(it)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '8px 8px' }}
                                  onClick={() => handleLimparQuantidadeOffline(it.key)}
                                >
                                  Limpar
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...buttonStyle,
                                    background: hasPhoto ? '#0b5' : '#444',
                                    fontSize: 12,
                                    padding: '8px 8px',
                                  }}
                                  onClick={() => openPhotoModalForCodigo(it.codigo_interno)}
                                  title={hasPhoto ? 'Ver/atualizar foto' : 'Anexar foto'}
                                >
                                  {hasPhoto ? 'Foto (ok)' : 'Sem foto'}
                                </button>
                              </div>
                              {hasPhoto ? (
                                <button
                                  type="button"
                                  style={{
                                    ...buttonStyle,
                                    background: '#a85a00',
                                    fontSize: 12,
                                    padding: '8px 10px',
                                    width: '100%',
                                    marginTop: 8,
                                    boxSizing: 'border-box',
                                  }}
                                  onClick={() => removePhotoFromChecklistItem(it)}
                                >
                                  Remover foto
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      )
                    })}
                    </div>
                  </>
                ) : inventarioPlanilhaArmazem ? (
                  <section
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      border: '1px solid rgba(255, 235, 59, 0.35)',
                      background: 'rgba(35, 35, 12, 0.55)',
                      color: '#fff59d',
                    }}
                    aria-label="Inventário no formato da planilha"
                  >
                    <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: '#fff59d' }}>
                      Inventário — tabela no formato da planilha
                    </h4>
                    <InventarioPlanilhaTabela
                      items={itemsPlanilhaTabelaPagina}
                      armazemItemsSorted={armazemItemsSorted}
                      armazemContagem={armazemGrupoAtual?.contagem ?? null}
                      planilhaQtdContagemHeader={planilhaQtdContagemHeader}
                      conferenteLabel={conferenteNomeSelecionado}
                      showChecklistColumn={showChecklistColumn}
                      thStyle={thStyle}
                      tdStyle={tdStyle}
                      buttonStyle={buttonStyle}
                      checklistQtdInputStyle={checklistQtdInputStyle}
                      checklistEditingKey={checklistEditingKey}
                      checklistEditDraft={checklistEditDraft}
                      setChecklistEditDraft={setChecklistEditDraft}
                      checklistSavedFlashKey={checklistSavedFlashKey}
                      saveChecklistEdit={saveChecklistEdit}
                      cancelChecklistEdit={cancelChecklistEdit}
                      openChecklistEdit={openChecklistEdit}
                      updateOfflineItemFields={updateOfflineItemFields}
                      updateOfflineItemQty={updateOfflineItemQty}
                      handleLimparQuantidadeOffline={handleLimparQuantidadeOffline}
                      openPhotoModalForCodigo={openPhotoModalForCodigo}
                      removePhotoFromChecklistItem={removePhotoFromChecklistItem}
                      onPlanilhaCodigoBlur={
                        offlineSession?.listMode === 'planilha' ? aplicarCatalogoPorCodigoPlanilha : undefined
                      }
                    />
                    {linhasTabelaPlanilhaInventario.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 10,
                          marginTop: 12,
                          fontSize: 13,
                          color: '#fff59d',
                        }}
                      >
                        <span>
                          Linhas {planilhaTabelaRangeFrom}–{planilhaTabelaRangeTo} de {linhasTabelaPlanilhaInventario.length}{' '}
                          · Página da tabela {planilhaTabelaPageSafe} de {planilhaTabelaTotalPages} ·{' '}
                          {PLANILHA_TABELA_PAGE_SIZE} linhas por página
                        </span>
                        <button
                          type="button"
                          disabled={planilhaTabelaPageSafe <= 1}
                          onClick={() => setPlanilhaTabelaPage((p) => Math.max(1, p - 1))}
                          style={{
                            ...buttonStyle,
                            background: '#444',
                            fontSize: 12,
                            opacity: planilhaTabelaPageSafe <= 1 ? 0.5 : 1,
                            cursor: planilhaTabelaPageSafe <= 1 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={planilhaTabelaPageSafe >= planilhaTabelaTotalPages}
                          onClick={() =>
                            setPlanilhaTabelaPage((p) => Math.min(planilhaTabelaTotalPages, p + 1))
                          }
                          style={{
                            ...buttonStyle,
                            background: '#444',
                            fontSize: 12,
                            opacity: planilhaTabelaPageSafe >= planilhaTabelaTotalPages ? 0.5 : 1,
                            cursor:
                              planilhaTabelaPageSafe >= planilhaTabelaTotalPages ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Próxima
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table
                      style={{
                        borderCollapse: 'collapse',
                        width: 'max-content',
                        minWidth: Math.max(360, visibleChecklistColCount * 90),
                      }}
                    >
                      <thead>
                        <tr>
                          {showChecklistColumn('conferente') ? <th style={thStyle}>Conferente</th> : null}
                          {showChecklistColumn('codigo') ? <th style={thStyle}>Código do produto</th> : null}
                          {showChecklistColumn('descricao') ? <th style={thStyle}>Descrição</th> : null}
                          {showChecklistColumn('unidade') ? <th style={thStyle}>Unidade de medida</th> : null}
                          {showChecklistColumn('quantidade') ? <th style={thStyle}>Quantidade contada</th> : null}
                          {showChecklistColumn('data_fabricacao') ? <th style={thStyle}>Data de fabricação</th> : null}
                          {showChecklistColumn('data_validade') ? <th style={thStyle}>Data de vencimento</th> : null}
                          {showChecklistColumn('lote') ? <th style={thStyle}>Lote</th> : null}
                          {showChecklistColumn('up') ? <th style={thStyle}>UP</th> : null}
                          {showChecklistColumn('observacao') ? <th style={thStyle}>Observação</th> : null}
                          {showChecklistColumn('ean') ? <th style={thStyle}>EAN</th> : null}
                          {showChecklistColumn('dun') ? <th style={thStyle}>DUN</th> : null}
                          {showChecklistColumn('foto') ? <th style={thStyle}>Foto</th> : null}
                          {showChecklistColumn('acoes') ? <th style={thStyle}>Ações</th> : null}
                        </tr>
                      </thead>
                      <tbody data-checklist-nav-root onKeyDown={handleChecklistFieldNavKeyDown}>
                        {checklistDisplayPageItems.map((item) => {
                          if ('kind' in item && item.kind === 'header') {
                            return (
                              <tr key={item.key}>
                                <td
                                  colSpan={visibleChecklistColCount}
                                  style={{
                                    padding: '10px 8px',
                                    fontWeight: 800,
                                    fontSize: 12,
                                    borderBottom: '1px solid #444',
                                    background: 'rgba(255, 255, 255, .04)',
                                    color: 'var(--text, #111)',
                                  }}
                                >
                                  {inventario ? inventarioAbaTitulo(item.contagem) : formatArmazemGroupLabel(item.contagem)}
                                </td>
                              </tr>
                            )
                          }
                          const it = item as OfflineChecklistItem
                          const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
                          const pend = String(it.quantidade_contada ?? '').trim() === ''
                          const isEditing = checklistEditingKey === it.key && checklistEditDraft
                          const datasOrdemInvalida = isVencimentoAntesFabricacao(it.data_fabricacao, it.data_validade)
                          return (
                            <tr
                              key={it.key}
                              style={
                                datasOrdemInvalida
                                  ? {
                                      background: 'rgba(198, 40, 40, 0.12)',
                                      boxShadow: 'inset 0 0 0 1px rgba(198, 40, 40, 0.45)',
                                    }
                                  : undefined
                              }
                            >
                              {isEditing && checklistEditDraft ? (
                                <>
                                  {showChecklistColumn('conferente') ? (
                                    <td
                                      style={{ ...tdStyle, color: 'var(--text-muted, #888)', maxWidth: 160 }}
                                      title="Conferente selecionado acima (sessão)"
                                    >
                                      {conferenteNomeSelecionado}
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('codigo') ? (
                                    <td style={tdStyle}>
                                      <input
                                        value={checklistEditDraft.codigo_interno}
                                        onChange={(e) =>
                                          setChecklistEditDraft((d) =>
                                            d ? { ...d, codigo_interno: e.target.value } : d,
                                          )
                                        }
                                        style={{ ...checklistQtdInputStyle, width: '100%', minWidth: 100 }}
                                        aria-label="Código do produto"
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('descricao') ? (
                                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>
                                      <textarea
                                        value={checklistEditDraft.descricao}
                                        onChange={(e) =>
                                          setChecklistEditDraft((d) =>
                                            d ? { ...d, descricao: e.target.value } : d,
                                          )
                                        }
                                        rows={2}
                                        style={{
                                          ...checklistQtdInputStyle,
                                          width: '100%',
                                          minWidth: 160,
                                          resize: 'vertical',
                                          fontFamily: 'inherit',
                                        }}
                                        aria-label="Descrição"
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('unidade') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.unidade_medida ?? ''}
                                        onChange={(e) =>
                                          updateOfflineItemFields(it.key, {
                                            unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                                          })
                                        }
                                        style={{ ...checklistQtdInputStyle, width: 100 }}
                                        placeholder="—"
                                        aria-label={`Unidade de medida ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('quantidade') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={checklistEditDraft.quantidade_contada}
                                        onChange={(e) =>
                                          setChecklistEditDraft((d) =>
                                            d ? { ...d, quantidade_contada: e.target.value } : d,
                                          )
                                        }
                                        style={checklistQtdInputStyle}
                                        placeholder="—"
                                        aria-label="Quantidade"
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('data_fabricacao') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={it.data_fabricacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 145 }}
                                        aria-label={`Data de fabricação ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('data_validade') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={it.data_validade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_validade: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 145 }}
                                        aria-label={`Data de vencimento ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('lote') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.lote ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 130 }}
                                        placeholder="—"
                                        aria-label={`Lote ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('up') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={it.up_quantidade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { up_quantidade: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 110 }}
                                        placeholder="—"
                                        aria-label={`UP ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('observacao') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.observacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { observacao: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 180 }}
                                        placeholder="—"
                                        aria-label={`Observação ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('ean') ? <td style={tdStyle}>{it.ean ?? ''}</td> : null}
                                  {showChecklistColumn('dun') ? <td style={tdStyle}>{it.dun ?? ''}</td> : null}
                                  {showChecklistColumn('foto') ? <td style={tdStyle}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td> : null}
                                  {showChecklistColumn('acoes') ? (
                                    <td style={{ ...tdStyle, whiteSpace: 'normal' }}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, background: '#0b5', fontSize: 12, padding: '6px 10px' }}
                                          onClick={() => saveChecklistEdit()}
                                        >
                                          Salvar
                                        </button>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                                          onClick={() => cancelChecklistEdit()}
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    </td>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  {showChecklistColumn('conferente') ? (
                                    <td
                                      style={{ ...tdStyle, color: 'var(--text-muted, #888)', maxWidth: 160 }}
                                      title="Conferente selecionado acima (sessão)"
                                    >
                                      {conferenteNomeSelecionado}
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('codigo') ? (
                                    <td style={tdStyle}>
                                      {it.codigo_interno}
                                      {it.inventario_repeticao ? (
                                        <span style={{ marginLeft: 6, fontSize: 11, color: '#0a7', fontWeight: 700 }}>
                                          ({it.inventario_repeticao}ª)
                                        </span>
                                      ) : null}
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('descricao') ? (
                                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>{it.descricao}</td>
                                  ) : null}
                                  {showChecklistColumn('unidade') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.unidade_medida ?? ''}
                                        onChange={(e) =>
                                          updateOfflineItemFields(it.key, {
                                            unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                                          })
                                        }
                                        style={{ ...checklistQtdInputStyle, width: 100 }}
                                        placeholder="—"
                                        aria-label={`Unidade de medida ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('quantidade') ? (
                                    <td style={tdStyle}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={it.quantidade_contada}
                                          onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                          style={checklistQtdInputStyle}
                                          placeholder="—"
                                          aria-label={`Quantidade ${it.codigo_interno}${it.inventario_repeticao ? ` ${it.inventario_repeticao}ª` : ''}`}
                                        />
                                        {checklistSavedFlashKey === it.key ? (
                                          <span style={{ fontSize: 11, color: '#0a0', fontWeight: 700 }}>Salvo</span>
                                        ) : null}
                                      </div>
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('data_fabricacao') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={it.data_fabricacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 145 }}
                                        aria-label={`Data de fabricação ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('data_validade') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={it.data_validade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_validade: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 145 }}
                                        aria-label={`Data de vencimento ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('lote') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.lote ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 130 }}
                                        placeholder="—"
                                        aria-label={`Lote ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('up') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={it.up_quantidade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { up_quantidade: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 110 }}
                                        placeholder="—"
                                        aria-label={`UP ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('observacao') ? (
                                    <td style={tdStyle}>
                                      <input
                                        type="text"
                                        value={it.observacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { observacao: e.target.value })}
                                        style={{ ...checklistQtdInputStyle, width: 180 }}
                                        placeholder="—"
                                        aria-label={`Observação ${it.codigo_interno}`}
                                      />
                                    </td>
                                  ) : null}
                                  {showChecklistColumn('ean') ? <td style={tdStyle}>{it.ean ?? ''}</td> : null}
                                  {showChecklistColumn('dun') ? <td style={tdStyle}>{it.dun ?? ''}</td> : null}
                                  {showChecklistColumn('foto') ? <td style={tdStyle}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td> : null}
                                  {showChecklistColumn('acoes') ? (
                                    <td style={{ ...tdStyle, whiteSpace: 'normal' }}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 12, padding: '6px 10px' }}
                                          onClick={() => openChecklistEdit(it)}
                                        >
                                          Editar
                                        </button>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                                          onClick={() => handleLimparQuantidadeOffline(it.key)}
                                        >
                                          Limpar
                                        </button>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, background: hasPhoto ? '#0b5' : '#444', fontSize: 12, padding: '6px 10px' }}
                                          onClick={() => openPhotoModalForCodigo(it.codigo_interno)}
                                          title={hasPhoto ? 'Ver/atualizar foto' : 'Anexar foto'}
                                        >
                                          {hasPhoto ? 'Foto (ok)' : 'Sem foto'}
                                        </button>
                                        {hasPhoto ? (
                                          <button
                                            type="button"
                                            style={{ ...buttonStyle, background: '#a85a00', fontSize: 12, padding: '6px 10px' }}
                                            onClick={() => removePhotoFromChecklistItem(it)}
                                            title="Remover foto anexada"
                                          >
                                            Remover foto
                                          </button>
                                        ) : null}
                                      </div>
                                    </td>
                                  ) : null}
                                </>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {checklistProductTotal > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--text, #888)' }}>
                      {checklistShowAll
                        ? `Exibindo todos os ${checklistProductTotal} registros`
                        : isArmazemPaginado
                          ? isPlanilhaInventarioNav
                            ? `${checklistRangeFrom}–${checklistRangeTo} de ${checklistProductTotal} · Aba ${checklistPageSafe} de ${checklistTotalPages} · ${inventarioAbaTitulo(armazemGrupos[checklistPageSafe - 1]?.contagem ?? null)} · ${formatContagemLabel(inventarioNumeroContagemRodada)} · ${INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA} linhas nesta RUA`
                            : `${checklistRangeFrom}–${checklistRangeTo} de ${checklistProductTotal} · Página ${checklistPageSafe} de ${checklistTotalPages} · ${inventario ? `${inventarioAbaTitulo(armazemGrupos[checklistPageSafe - 1]?.contagem ?? null)} · ${formatContagemLabel(inventarioNumeroContagemRodada)}` : formatContagemLabel(armazemGrupos[checklistPageSafe - 1]?.contagem ?? checklistPageSafe)}`
                          : `${checklistRangeFrom}–${checklistRangeTo} de ${checklistProductTotal} · Página ${checklistPageSafe} de ${checklistTotalPages} · ${CHECKLIST_PAGE_SIZE} por página`}
                    </span>
                    {isPlanilhaInventarioNav ? (
                      <span style={{ fontSize: 12, color: 'var(--text, #888)', maxWidth: 420 }}>
                        Troque de <strong>CAMARA/RUA</strong> apenas pelas <strong>abas</strong> acima — a tabela desta aba
                        mostra as 15 posições inteiras ({INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA} linhas).
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={checklistShowAll || checklistPageSafe <= 1}
                          onClick={() => setChecklistPage((p) => Math.max(1, p - 1))}
                          style={{
                            ...buttonStyle,
                            background: '#444',
                            fontSize: 12,
                            opacity: checklistShowAll || checklistPageSafe <= 1 ? 0.5 : 1,
                            cursor: checklistShowAll || checklistPageSafe <= 1 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={checklistShowAll || checklistPageSafe >= checklistTotalPages}
                          onClick={() => setChecklistPage((p) => Math.min(checklistTotalPages, p + 1))}
                          style={{
                            ...buttonStyle,
                            background: '#444',
                            fontSize: 12,
                            opacity: checklistShowAll || checklistPageSafe >= checklistTotalPages ? 0.5 : 1,
                            cursor:
                              checklistShowAll || checklistPageSafe >= checklistTotalPages ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Próxima
                        </button>
                        {checklistProductTotal > CHECKLIST_PAGE_SIZE ? (
                          checklistShowAll ? (
                            <button
                              type="button"
                              onClick={() => {
                                setChecklistShowAll(false)
                                setChecklistPage(1)
                              }}
                              style={{ ...buttonStyle, background: '#444', fontSize: 12 }}
                            >
                              Paginar ({CHECKLIST_PAGE_SIZE} por página)
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setChecklistShowAll(true)}
                              style={{ ...buttonStyle, background: '#444', fontSize: 12 }}
                            >
                              Mostrar tudo
                            </button>
                          )
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text, #666)' }}>
            Nenhuma sessão aberta. Acima, selecione o conferente e a data; depois clique em <strong>Carregar lista de produtos</strong>.
          </div>
        )}

        {confirmFinalizeMissingOpen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.55)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
              zIndex: 9999,
            }}
          >
            <div
              style={{
                width: 'min(920px, 100%)',
                background: 'var(--panel-bg, #fff)',
                color: 'var(--text, #111)',
                border: '1px solid var(--border, #ccc)',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <h3 style={{ margin: '0 0 8px' }}>Aviso — produtos sem preencher (quantidade)</h3>
              {finalizing ? (
                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text, #444)' }}>
                  {finalizeProgress || 'Processando...'}
                </div>
              ) : null}
              <div style={{ fontSize: 13, color: 'var(--text, #444)', lineHeight: 1.45 }}>
                Há <strong>{missingItemsForFinalize.length}</strong> produto(s) com <strong>quantidade em branco</strong>.
                Esses <strong>não serão gravados</strong> no Supabase até você preencher a quantidade (nada é convertido
                para 0). Lote, observação, UP, datas, EAN/DUN e foto podem ficar em branco nos itens que tiverem
                quantidade informada.
                <br />
                <br />
                Você pode voltar para preencher ou finalizar agora: serão salvos <strong>somente</strong> os produtos que
                já têm quantidade digitada.
              </div>

              <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd', fontSize: 12 }}>
                        Código do produto
                      </th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd', fontSize: 12 }}>Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingItemsForFinalize.slice(0, 200).map((it) => (
                      <tr key={it.key}>
                        <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {it.codigo_interno}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>{it.descricao}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missingItemsForFinalize.length > 200 ? (
                  <div style={{ fontSize: 12, color: 'var(--text, #666)', marginTop: 8 }}>
                    Mostrando apenas os primeiros 200 itens.
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#666' }}
                  onClick={() => {
                    setConfirmFinalizeMissingOpen(false)
                    setMissingItemsForFinalize([])
                  }}
                  disabled={finalizing}
                >
                  Voltar para preencher
                </button>
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#0b5' }}
                  onClick={() => void finalizeInternal()}
                  disabled={finalizing}
                >
                  Finalizar e gravar só os preenchidos
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text, #666)' }}>
          Conferente da contagem: use o seletor na seção <strong>Contagem diária</strong> acima.
        </p>
        {/* Não usar <label> envolvendo input+botões: em mobile o toque pode ir para o input em vez do botão. */}
        <div style={labelStyle}>
          <label htmlFor="barcode-leitura-input" style={{ display: 'block' }}>
            Leitura de código de barras (DUN/EAN)
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              id="barcode-leitura-input"
              value={barcodeLeitura}
              onChange={(e) => setBarcodeLeitura(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  // Usa o valor atual do input no momento do Enter (bipador),
                  // evitando pegar estado atrasado e perder o último dígito.
                  const scanned = e.currentTarget.value
                  setBarcodeLeitura(scanned)
                  applyProductByBarcode(scanned)
                }
              }}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Bipe aqui (DUN/caixa ou EAN/pacote-unidade)"
              inputMode="numeric"
              disabled={productOptionsLoading}
            />
            <button
              type="button"
              style={{ ...buttonStyle, background: '#555', fontSize: 13, whiteSpace: 'nowrap', touchAction: 'manipulation' }}
              onClick={() => {
                setBarcodeLeitura('')
                setBarcodeTipoLeitura(null)
                setProdutoError('')
              }}
              disabled={productOptionsLoading || (!barcodeLeitura.trim() && !barcodeTipoLeitura)}
              title="Limpar leitura de código de barras"
              aria-label="Limpar leitura de código de barras"
            >
              Limpar
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#444', fontSize: 13, whiteSpace: 'nowrap', touchAction: 'manipulation' }}
              onClick={() => {
                setBarcodeFotoHint('')
                setBarcodeCameraOpen(true)
              }}
              disabled={productOptionsLoading}
              title="Ler código de barras pela câmera (quando suportado)"
              aria-label="Ler código de barras (câmera/scan)"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M4 6H6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M4 10H6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M4 14H6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M4 18H6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M8 6H10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M8 10H10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M8 14H10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M8 18H10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 6H16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 10H16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 14H16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 18H16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M18 6H20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M18 10H20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M18 14H20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M18 18H20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </span>
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#444', fontSize: 13, whiteSpace: 'nowrap', touchAction: 'manipulation' }}
              onClick={() => {
                if (productOptionsLoading) return
                if (!codigoInterno.trim()) {
                  setBarcodeFotoHint('Informe o código do produto antes de tirar foto.')
                  return
                }
                setBarcodeFotoHint('')
                openPhotoModalForCodigo(codigoInterno)
              }}
              disabled={productOptionsLoading}
              title="Registrar foto do produto"
              aria-label="Registrar foto (câmera)"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M9 7H7.5C6.12 7 5 8.12 5 9.5V16.5C5 17.88 6.12 19 7.5 19H16.5C17.88 19 19 17.88 19 16.5V9.5C19 8.12 17.88 7 16.5 7H15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M9 7L10.2 5.8C10.6 5.4 11.13 5.2 11.67 5.2H12.33C12.87 5.2 13.4 5.4 13.8 5.8L15 7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </span>
            </button>
          </div>
          {barcodeTipoLeitura ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text, #555)' }}>
              Detetado: <strong>{barcodeTipoLeitura === 'DUN' ? 'CAIXA (DUN)' : 'PACOTE/UNIDADE (EAN)'}</strong>
            </div>
          ) : null}
          {barcodeCameraError ? <div style={{ marginTop: 6, fontSize: 12, color: '#b00020' }}>{barcodeCameraError}</div> : null}
          {barcodeFotoHint ? <div style={{ marginTop: 6, fontSize: 12, color: '#b00020' }}>{barcodeFotoHint}</div> : null}
        </div>

        <label style={labelStyle}>
          Código do produto
          <div ref={codigoWrapRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
              <input
                value={codigoInterno}
                onChange={(e) => {
                  const v = e.target.value
                  setCodigoInterno(v)
                  const matched = applyProductByCode(v.trim())
                  if (!matched && produto && !codigoInternoIguais(produto.codigo_interno, v)) {
                    setProduto(null)
                  }
                }}
                onBlur={() => {
                  const code = codigoInterno.trim()
                  const matched = applyProductByCode(code)
                  if (!matched && !descricaoInput.trim()) {
                    setProduto(null)
                  }
                }}
                onFocus={() => setCodigoListOpen(true)}
                style={{
                  ...inputStyle,
                  flex: 1,
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  borderRight: 'none',
                }}
                disabled={productOptionsLoading}
                placeholder={productOptionsLoading ? 'Carregando códigos...' : 'Digite o código...'}
              />
              <button
                type="button"
                aria-label="Abrir lista de códigos"
                aria-expanded={codigoListOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCodigoListOpen((o) => !o)}
                disabled={productOptionsLoading}
                style={{
                  padding: '0 12px',
                  border: '1px solid var(--border, #ccc)',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  borderTopRightRadius: 8,
                  borderBottomRightRadius: 8,
                  background: 'var(--code-bg, #f4f3ec)',
                  color: 'var(--text-h, #111)',
                  cursor: productOptionsLoading ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ▼
              </button>
            </div>
            {codigoListOpen ? (
              <ul
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 4px)',
                  margin: 0,
                  width: '100%',
                  padding: 4,
                  listStyle: 'none',
                  maxHeight: 260,
                  overflowY: 'auto',
                  background: 'var(--code-bg, #fff)',
                  border: '1px solid var(--border, #ccc)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow, 0 4px 12px rgba(0,0,0,.12))',
                  zIndex: 9999,
                }}
              >
                {productOptionsLoading ? (
                  <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>Carregando...</li>
                ) : codigoSuggestions.length === 0 ? (
                  <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>
                    {productOptions.length === 0
                      ? 'Nenhum produto carregado (confira a tabela e RLS no Supabase).'
                      : 'Nenhum código encontrado para o que você digitou.'}
                  </li>
                ) : (
                  codigoSuggestions.map((p) => (
                    <li
                      key={p.codigo}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCodigoInterno(p.codigo)
                        applyProductByCode(p.codigo)
                        setCodigoListOpen(false)
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        color: 'var(--text-h, #111)',
                        fontSize: 14,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--accent-bg, rgba(170,59,255,.1))'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <strong>{p.codigo}</strong>
                      <span style={{ color: 'var(--text, #666)', marginLeft: 8, fontWeight: 400 }}>
                        {p.descricao}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: isMobile ? 'auto' : 'span 4' }}>
            <label style={labelStyle}>
              Descrição
              <div ref={descricaoWrapRef} style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
                  <input
                    value={descricaoInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setDescricaoInput(v)
                      const match = productByDescricao.get(v.trim().toLowerCase())
                      if (match) {
                        setCodigoInterno(match.codigo)
                        applyProductByCode(match.codigo)
                      }
                    }}
                    onBlur={() => {
                      const match = productByDescricao.get(descricaoInput.trim().toLowerCase())
                      if (match) {
                        setCodigoInterno(match.codigo)
                        applyProductByCode(match.codigo)
                      }
                    }}
                    onFocus={() => setDescricaoListOpen(true)}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderRight: 'none',
                    }}
                    disabled={productOptionsLoading}
                    placeholder={productOptionsLoading ? 'Carregando descrições...' : 'Digite a descrição...'}
                  />
                  <button
                    type="button"
                    aria-label="Abrir lista de descrições"
                    aria-expanded={descricaoListOpen}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setDescricaoListOpen((o) => !o)}
                    disabled={productOptionsLoading}
                    style={{
                      padding: '0 12px',
                      border: '1px solid var(--border, #ccc)',
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      borderTopRightRadius: 8,
                      borderBottomRightRadius: 8,
                      background: 'var(--code-bg, #f4f3ec)',
                      color: 'var(--text-h, #111)',
                      cursor: productOptionsLoading ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ▼
                  </button>
                </div>
                {descricaoListOpen ? (
                  <ul
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 'calc(100% + 4px)',
                      margin: 0,
                      width: '100%',
                      padding: 4,
                      listStyle: 'none',
                      maxHeight: 260,
                      overflowY: 'auto',
                      background: 'var(--code-bg, #fff)',
                      border: '1px solid var(--border, #ccc)',
                      borderRadius: 8,
                      boxShadow: 'var(--shadow, 0 4px 12px rgba(0,0,0,.12))',
                      zIndex: 9999,
                    }}
                  >
                    {productOptionsLoading ? (
                      <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>Carregando...</li>
                    ) : descricaoSuggestions.length === 0 ? (
                      <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>
                        {productOptions.length === 0
                          ? 'Nenhum produto carregado (confira a tabela e RLS no Supabase).'
                          : 'Nenhuma descrição encontrada para o que você digitou.'}
                      </li>
                    ) : (
                      descricaoSuggestions.map((p) => (
                        <li
                          key={`sug-desc-${p.codigo}`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setDescricaoInput(p.descricao)
                            setCodigoInterno(p.codigo)
                            applyProductByCode(p.codigo)
                            setDescricaoListOpen(false)
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            color: 'var(--text-h, #111)',
                            fontSize: 14,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent-bg, rgba(170,59,255,.1))'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <span style={{ color: 'var(--text, #666)', marginRight: 8, fontWeight: 600 }}>
                            {p.codigo}
                          </span>
                          {p.descricao}
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
            </label>
            {produtoError && (productOptions.length > 0 || productOptionsLoading) ? (
              <div style={{ color: '#b00020', fontSize: 13, marginTop: 6 }}>{produtoError}</div>
            ) : null}
            {produtoLoading ? (
              <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>Buscando descrição...</div>
            ) : null}
          </div>

          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 2' }}>
            Quantidade contada
            <input
              type="number"
              step="0.001"
              value={quantidadeContada}
              onChange={(e) => setQuantidadeContada(e.target.value)}
              style={inputStyle}
              placeholder="Digite a quantidade"
            />
          </label>

          <div
            style={{
              gridColumn: isMobile ? 'auto' : 'span 6',
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              gap: 12,
              ...(isVencimentoAntesFabricacao(dataFabricacao, dataVencimento)
                ? {
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #c62828',
                    background: 'rgba(198, 40, 40, 0.1)',
                    boxSizing: 'border-box',
                  }
                : {}),
            }}
          >
            <label style={labelStyle}>
              Data de fabricação
              <input
                type="date"
                value={dataFabricacao}
                onChange={(e) => setDataFabricacao(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Data de vencimento
              <input
                type="date"
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 3' }}>
            UP
            <input
              type="number"
              step="0.001"
              value={quantidadeUp}
              onChange={(e) => setQuantidadeUp(e.target.value)}
              style={inputStyle}
              placeholder="Digite o UP"
            />
          </label>

          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 6' }}>
            Lote
            <input value={lote} onChange={(e) => setLote(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 8' }}>
            Observação
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} style={inputStyle} />
          </label>
        </div>

        {offlineSession?.status === 'aberta' ? (
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 13,
              color: 'var(--text, #666)',
              maxWidth: 900,
              lineHeight: 1.45,
            }}
          >
            <strong>Lista acima:</strong> cada quantidade na coluna <strong>Qtd</strong> já é gravada na sessão local ao
            digitar. Você também pode clicar em <strong>Salvar na lista</strong> com a lista preenchida (sem usar o
            formulário) para confirmar tudo no armazenamento local. Com código ou descrição abaixo, o mesmo botão grava
            também lote, UP e observação na linha escolhida. Para enviar ao Supabase, use{' '}
            <strong>{inventario ? 'Finalizar inventário' : 'Finalizar contagem diária'}</strong>.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={saving || !canPressSalvarLista}
            title={
              saving || canPressSalvarLista
                ? undefined
                : offlineSession?.status === 'aberta'
                  ? 'Preencha ao menos uma quantidade na lista acima ou código e descrição neste bloco.'
                  : 'Carregue a lista de produtos primeiro.'
            }
            style={{
              ...buttonStyle,
              ...(saving || !canPressSalvarLista ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
          >
            {saving ? 'Gravando…' : 'Salvar na lista (offline)'}
          </button>
          {!canPressSalvarLista && !saving ? (
            <div style={{ fontSize: 12, color: '#ffcc80', maxWidth: 560 }}>
              Para salvar, selecione um <strong>conferente</strong> e clique em{' '}
              <strong>Carregar lista de produtos</strong>.
            </div>
          ) : null}
          {saveError ? <div style={{ color: '#b00020', maxWidth: 640 }}>{saveError}</div> : null}
          {saveSuccess ? <div style={{ color: '#0f7a0f' }}>{saveSuccess}</div> : null}
        </div>
      </form>

      <div ref={previewSectionRef} style={{ marginTop: 26, scrollMarginTop: 12 }}>
        <h3>{inventario ? 'Prévia do inventário (Supabase)' : 'Prévia — o que já está no banco (Supabase)'}</h3>
        <div style={{ color: 'var(--text, #555)', fontSize: 13, marginTop: 6, maxWidth: 720 }}>
          {inventario ? (
            <>
              Registros com <code style={{ fontSize: 12 }}>origem=inventario</code> no dia consultado. Três linhas por
              produto quando as três contagens foram gravadas. A tabela da prévia usa as <strong>mesmas colunas</strong>{' '}
              que a lista acima (controle em <strong>Ocultar/mostrar colunas</strong>).
            </>
          ) : (
            <>
              A lista da contagem diária fica <strong>só no navegador</strong> até você clicar em{' '}
              <strong>Finalizar contagem diária</strong> — aí os registros são enviados para a tabela{' '}
              <code style={{ fontSize: 12 }}>contagens_estoque</code>. Esta prévia mostra exatamente o que já foi gravado
              no banco (por dia civil). Colunas iguais à lista acima (<strong>Ocultar/mostrar colunas</strong>). Após
              finalizar, a prévia é atualizada automaticamente; use <strong>Atualizar prévia</strong> para buscar de novo
              (por exemplo, outro dia ou depois de editar no banco).
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ ...labelStyle, marginBottom: 0, fontSize: 13 }}>
            Dia no banco
            <input
              type="date"
              value={previewConsultaDiaYmd}
              onChange={(e) => setPreviewConsultaDiaYmd(e.target.value)}
              disabled={previewLoading}
              style={{ ...inputStyle, marginTop: 4, maxWidth: 200 }}
              title="Filtra contagens_estoque por data_contagem (mesmo dia de data_inventario na planilha)"
            />
          </label>
          <button
            type="button"
            onClick={() => loadPreview()}
            disabled={previewLoading}
            style={buttonStyle}
          >
            {previewLoading ? 'Atualizando...' : 'Atualizar prévia'}
          </button>
          <button
            type="button"
            onClick={() => void handlePreviewDeleteAll()}
            disabled={
              previewLoading ||
              previewRowActionLoading ||
              !previewQueryDayYmd ||
              previewRows.length === 0
            }
            title={
              !previewQueryDayYmd || previewRows.length === 0
                ? 'Carregue a prévia com registros antes de excluir'
                : 'Abre o campo de senha na hora; depois confirme o aviso para apagar o dia no banco.'
            }
            style={{
              ...buttonStyle,
              background: '#8b1538',
              borderColor: '#6d102b',
              opacity:
                previewLoading ||
                previewRowActionLoading ||
                !previewQueryDayYmd ||
                previewRows.length === 0
                  ? 0.5
                  : 1,
              cursor:
                previewLoading ||
                previewRowActionLoading ||
                !previewQueryDayYmd ||
                previewRows.length === 0
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            Excluir tudo (banco)
          </button>
        </div>
        {previewRows.length ? (
          renderPreviewTable()
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text, #888)' }}>
            Nenhum registro em <code style={{ fontSize: 12 }}>contagens_estoque</code> para o dia em{' '}
            <strong>Dia no banco</strong> (deve ser o mesmo <code style={{ fontSize: 12 }}>data_contagem</code> /
            <code style={{ fontSize: 12 }}> data_inventario</code>). Ajuste a data e clique em{' '}
            <strong>Atualizar prévia</strong>.
          </div>
        )}
      </div>

      {barcodeCameraOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: isMobile ? 'flex-start' : 'center',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            boxSizing: 'border-box',
            padding: isMobile ? 'max(10px, env(safe-area-inset-top)) 12px 12px' : 16,
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 'min(980px, calc(100vw - 24px))',
              minWidth: 0,
              boxSizing: 'border-box',
              background: 'var(--panel-bg, #fff)',
              border: '1px solid var(--border, #ccc)',
              borderRadius: 12,
              padding: isMobile ? 12 : 16,
              color: 'var(--text, #111)',
              margin: isMobile ? '0 auto 12px' : undefined,
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: isMobile ? 17 : undefined }}>Leitor de código de barras</h3>
            {barcodeCameraError ? <div style={{ color: '#b00020', fontSize: 13, marginBottom: 10 }}>{barcodeCameraError}</div> : null}
            <video
              ref={barcodeVideoRef}
              style={{
                width: '100%',
                maxWidth: '100%',
                display: 'block',
                maxHeight: isMobile ? 320 : 420,
                height: 'auto',
                objectFit: 'contain',
                background: '#000',
              }}
              playsInline
              muted
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...buttonStyle, background: '#666' }}
                onClick={() => {
                  setBarcodeCameraOpen(false)
                  setBarcodeCameraError('')
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {photoCameraOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: isMobile ? 'flex-start' : 'center',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            boxSizing: 'border-box',
            padding: isMobile ? 'max(10px, env(safe-area-inset-top)) 12px 12px' : 16,
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 'min(980px, calc(100vw - 24px))',
              minWidth: 0,
              boxSizing: 'border-box',
              background: 'var(--panel-bg, #fff)',
              border: '1px solid var(--border, #ccc)',
              borderRadius: 12,
              padding: isMobile ? 12 : 16,
              color: 'var(--text, #111)',
              margin: isMobile ? '0 auto 12px' : undefined,
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: isMobile ? 17 : undefined }}>Foto do produto</h3>
            <div style={{ fontSize: 13, color: 'var(--text, #555)', marginBottom: 10, wordBreak: 'break-word' }}>
              Código: <span style={{ fontFamily: 'monospace' }}>{photoTargetCodigo || '—'}</span>
            </div>
            {photoUiError ? <div style={{ color: '#b00020', fontSize: 13, marginBottom: 10 }}>{photoUiError}</div> : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 280px)',
                gap: 12,
                alignItems: 'start',
                width: '100%',
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, maxWidth: '100%' }}>
                <video
                  ref={photoVideoRef}
                  style={{
                    width: '100%',
                    maxWidth: '100%',
                    display: 'block',
                    maxHeight: isMobile ? 320 : 420,
                    height: 'auto',
                    objectFit: 'contain',
                    background: '#000',
                  }}
                  playsInline
                  muted
                />
                <canvas ref={photoCanvasRef} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={{ ...buttonStyle, background: '#2a4d7a' }}
                    onClick={() => capturePhotoToBase64()}
                    disabled={photoSaving}
                  >
                    Tirar foto
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: '1px solid var(--border, #ccc)',
                  borderRadius: 12,
                  padding: 10,
                  minWidth: 0,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text, #666)', marginBottom: 8 }}>Prévia</div>
                {photoPreviewBase64 ? (
                  <img
                    src={`data:image/jpeg;base64,${photoPreviewBase64}`}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      height: 'auto',
                      display: 'block',
                      borderRadius: 10,
                      border: '1px solid #eee',
                      background: '#fafafa',
                      objectFit: 'contain',
                    }}
                    alt="Prévia foto"
                  />
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text, #888)',
                      minHeight: isMobile ? 80 : undefined,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    Sem foto anexada
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...buttonStyle, background: '#666' }}
                onClick={() => {
                  setPhotoCameraOpen(false)
                  setPhotoTargetCodigo('')
                  setPhotoUiError('')
                  setPhotoSaving(false)
                }}
                disabled={photoSaving}
              >
                Cancelar
              </button>
              {offlineSession?.status === 'aberta' &&
              photoTargetCodigo.trim() &&
              (Boolean(
                String(
                  offlineSession.items.find((it) => codigoInternoIguais(it.codigo_interno, photoTargetCodigo))?.foto_base64 ??
                    '',
                ).trim(),
              ) ||
                Boolean(photoPreviewBase64.trim())) ? (
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#a85a00' }}
                  onClick={() => removePhotoFromPhotoModal()}
                  disabled={photoSaving}
                >
                  Remover foto
                </button>
              ) : null}
              <button
                type="button"
                style={{ ...buttonStyle, background: '#0b5' }}
                onClick={() => void savePhotoToDb()}
                disabled={photoSaving}
              >
                {photoSaving ? 'Salvando...' : 'Salvar foto'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
}

const inputStyle: React.CSSProperties = {
  padding: '10px 10px',
  border: '1px solid #ccc',
  borderRadius: 8,
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #222',
  background: '#111',
  color: 'white',
  cursor: 'pointer',
}

/** Carregar / Atualizar / Limpar / Finalizar — Contagem diária e Inventário (mesmo `ContagemEstoque`). */
const checklistBtnRowBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const checklistActionBtnCarregar: React.CSSProperties = {
  ...checklistBtnRowBase,
  background: 'linear-gradient(180deg, #4f8eff 0%, #2f6fdf 100%)',
  border: '1px solid #7fb0ff',
  color: '#f4f9ff',
  fontWeight: 700,
}

const checklistActionBtnAtualizar: React.CSSProperties = {
  ...checklistBtnRowBase,
  background: 'linear-gradient(180deg, #26c6da 0%, #00838f 100%)',
  border: '1px solid #80deea',
  color: '#001819',
  fontWeight: 700,
}

const checklistActionBtnLimpar: React.CSSProperties = {
  ...checklistBtnRowBase,
  background: 'linear-gradient(180deg, #ffb74d 0%, #ef6c00 100%)',
  border: '1px solid #ffcc80',
  color: '#1f1200',
  fontWeight: 700,
}

function checklistActionBtnFinalizar(disabled: boolean, pending: number): React.CSSProperties {
  const base: React.CSSProperties = { ...checklistBtnRowBase }
  if (disabled) {
    return {
      ...base,
      background: 'linear-gradient(180deg, #2f4a32 0%, #1e2b20 100%)',
      border: '1px solid #4caf50',
      color: '#c8e6c9',
      fontWeight: 700,
      opacity: 0.92,
      cursor: 'not-allowed',
    }
  }
  if (pending > 0) {
    return {
      ...base,
      background: 'linear-gradient(180deg, #ffcc80 0%, #fb8c00 100%)',
      border: '1px solid #ffe0b2',
      color: '#3e2723',
      fontWeight: 700,
    }
  }
  return {
    ...base,
    background: 'linear-gradient(180deg, #66bb6a 0%, #2e7d32 100%)',
    border: '1px solid #a5d6a7',
    color: '#fff',
    fontWeight: 700,
  }
}

const thStyle: React.CSSProperties = {
  borderBottom: '1px solid #ddd',
  textAlign: 'left',
  padding: '6px 8px',
  fontWeight: 700,
  fontSize: 12,
  background: '#fafafa',
  whiteSpace: 'nowrap',
  lineHeight: 1.25,
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: '6px 8px',
  fontSize: 12,
  whiteSpace: 'nowrap',
  lineHeight: 1.25,
}

const checklistQtdInputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border, #ccc)',
  borderRadius: 8,
  width: 'min(100%, 140px)',
  boxSizing: 'border-box',
  background: 'var(--input-bg, #fff)',
  color: 'var(--text, #111)',
}

