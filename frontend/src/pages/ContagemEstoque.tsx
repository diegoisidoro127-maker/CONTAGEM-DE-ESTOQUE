import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  getInventarioRuaArmazem,
  inventarioArmazemPosNivel,
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
import {
  CHECKLIST_QTY_NAV_ATTR,
  handleChecklistFieldNavKeyDown,
} from '../lib/checklistFieldNavigation'
import {
  deleteInventarioPlanilhaLinhasForContagensIds,
  deleteInventarioPlanilhaLinhasForDay,
} from '../lib/inventarioPlanilhaLinhasDelete'
import {
  CHECKLIST_VISIBLE_COLS_STORAGE,
  loadChecklistVisibleColsFromStorage,
} from '../lib/checklistVisibleCols'
import { fetchConferentesNomesPorIds } from '../lib/conferentesNomesBatch'
import {
  fetchContagemDiariaPresencaDia,
  fetchResumoFinalizadosContagemDiariaDia,
  formatPresencaRelativo,
  isPresencaAtiva,
  PRESENCA_PING_INTERVAL_MS,
  PRESENCA_POLL_INTERVAL_MS,
  upsertContagemDiariaPresenca,
} from '../lib/contagemDiariaPresenca'
import {
  prepararContagemDiariaOficialListaUnicaPorProduto,
} from '../lib/contagemListagemCompat'
import { mergeContagensDiariasDoDiaParaItems } from '../lib/mergeContagemDiariaDoBanco'
import { subscribeContagensEstoqueDia } from '../lib/subscribeContagensEstoqueRealtime'

/** Se o Realtime falhar, ainda sincroniza a checklist a cada 2 min. */
const CONTAGEM_BANCO_MERGE_FALLBACK_MS = 120_000

const PREVIEW_PAGE_SIZE = 15
/** Colunas fixas na prévia com dados de planilha (Câmara / Rua / POS / Nível + Conferente). Só no inventário. */
/** Na contagem diária a prévia não mostra Câmara–Nível; só 1 coluna fixa (Conferente) + opcionais. */
const PREVIEW_COLS_PLANILHA_BASE = 5
const CHECKLIST_PAGE_SIZE = 15
/** Linhas por página na tabela “Inventário — formato planilha” (cada aba pode ter centenas de linhas). */
const PLANILHA_TABELA_PAGE_SIZE = 30
/** Código(s) removidos apenas da 3ª repetição da lista de inventário. */
const INVENTARIO_EXCLUIR_DA_3A_CONTAGEM = new Set([
  normalizeCodigoInternoCompareKey('01.04.0028'),
  normalizeCodigoInternoCompareKey('02.02.0031'),
])
/** Código(s) removidos da lista de contagem diária. */
const CONTAGEM_DIARIA_EXCLUIR_DA_LISTA = new Set([
  normalizeCodigoInternoCompareKey('01.04.0028'),
  normalizeCodigoInternoCompareKey('02.02.0031'),
])

/** Senha exigida em "Excluir dia no banco" na prévia (proteção contra exclusão acidental). */
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
  /** Lote da finalização (contagem diária); separa várias finalizações no mesmo dia/conferente. */
  finalizacao_sessao_id?: string | null
  /** Rascunho em tempo real; oficiais (finalizados) aparecem em linhas separadas por conferente. */
  contagem_rascunho?: boolean | null
  /** `inventario_planilha_linhas` por `contagens_estoque_id`. */
  planilha_grupo_armazem?: number | null
  planilha_rua?: string | null
  planilha_posicao?: number | null
  planilha_nivel?: number | null
  /**
   * Contagem diária com linha agrupada (mesmo código/descrição/dia, vários conferentes):
   * quantidade por conferente e ids para filtrar ações na prévia.
   */
  preview_conferentes_detalhe?: Array<{
    conferente_id: string
    conferente_nome: string
    quantidade_up: number
    source_ids: string[]
  }>
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

/** Quantidade exibida/gravada na planilha de inventário: vazio = número da rodada (1–4). */
function quantidadePlanilhaInventarioEfetiva(
  it: OfflineChecklistItem,
  inventarioNumeroContagem: 1 | 2 | 3 | 4,
): string {
  const t = String(it.quantidade_contada ?? '').trim()
  return t === '' ? String(inventarioNumeroContagem) : t
}

function countPendingForSession(session: OfflineSession | null): number {
  if (!session || session.status !== 'aberta') return 0
  /** Quantidade vazia na planilha usa o número da rodada (1–4), então não há pendência por “quantidade em branco”. */
  if (session.listMode === 'planilha') {
    return 0
  }
  return countPendingItems(session.items)
}

/** Resumo para o painel de presença: outros veem X/Y sem ver códigos (finalização continua separada por sessão). */
function progressoPresencaContagemDiaria(session: OfflineSession): { linhasComQtd: number; linhasTotal: number } {
  if (session.status !== 'aberta') return { linhasComQtd: 0, linhasTotal: 0 }
  if (session.listMode === 'planilha') {
    const items = session.items.filter((i) => String(i.codigo_interno ?? '').trim() !== '')
    const com = items.filter((i) => String(i.quantidade_contada ?? '').trim() !== '').length
    return { linhasComQtd: com, linhasTotal: items.length }
  }
  const total = session.items.length
  const pend = countPendingItems(session.items)
  return { linhasComQtd: Math.max(0, total - pend), linhasTotal: total }
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

/**
 * Dia civil local (navegador) a partir de um ISO — alinhar filtros e prévia ao mesmo dia civil.
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

function stripContagensEstoqueFinalizacaoSessaoColumn(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.finalizacao_sessao_id
  return r
}

function stripContagensEstoqueContagemRascunhoColumn(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.contagem_rascunho
  return r
}

/** Valor de `contagem_rascunho` vindo do PostgREST (boolean; em raros casos string). */
function isContagemRascunhoValorDb(v: unknown): boolean {
  if (v === true) return true
  if (v === false || v === null || v === undefined) return false
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    return t === 'true' || t === 't' || t === '1'
  }
  return false
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
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)
  const [showAddConferente, setShowAddConferente] = useState(false)
  const [newConferenteNome, setNewConferenteNome] = useState('')
  const [addingConferente, setAddingConferente] = useState(false)

  // Relógio de contagem: usuário informa o início e o campo segue atualizando automaticamente.
  const [clockBaseMs, setClockBaseMs] = useState(() => Date.now())
  const [clockRealStartMs, setClockRealStartMs] = useState(() => Date.now())
  const [clockTick, setClockTick] = useState(0)
  /** Largura típica de celular/tablet estreito; evita tabela larga com scroll horizontal. */
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900)
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
  /** Contagem diária: conferente na prévia — `null` = padrão (conferente da sessão nos dados do dia), `total` = soma, ou id. */
  const [previewConferenteModoGlobal, setPreviewConferenteModoGlobal] = useState<'total' | string | null>(null)
  /** Dia consultado em `contagens_estoque.data_contagem` (alinha sessão / planilha; não só “hoje”). */
  const [previewConsultaDiaYmd, setPreviewConsultaDiaYmd] = useState<string>(() => toISODateLocal(new Date()))

  /** Dia civil da contagem diária (lista + finalize usam este YMD). */
  const [contagemDiaYmd, setContagemDiaYmd] = useState(() => toISODateLocal(new Date()))
  const [offlineSession, setOfflineSession] = useState<OfflineSession | null>(null)
  const offlineSessionRef = useRef<OfflineSession | null>(null)
  const loadPreviewRef = useRef<(dayOverride?: string, opts?: { silent?: boolean }) => Promise<void>>(async () => {})
  useEffect(() => {
    offlineSessionRef.current = offlineSession
  }, [offlineSession])
  /** Linhas editadas localmente: não sobrescrever no refresh do banco até a quantidade ser limpa. */
  const checklistContagemBancoDirtyKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    checklistContagemBancoDirtyKeysRef.current.clear()
  }, [offlineSession?.sessionId])
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [checklistError, setChecklistError] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeProgress, setFinalizeProgress] = useState('')
  const [startFreshNotice, setStartFreshNotice] = useState<string>('')
  const [checklistFilterCodigo, setChecklistFilterCodigo] = useState('')
  const [checklistFilterDescricao, setChecklistFilterDescricao] = useState('')
  const [checklistFilterPendentes, setChecklistFilterPendentes] = useState(false)
  const [checklistListCollapsed, setChecklistListCollapsed] = useState(false)
  const [checklistColsPanelOpen, setChecklistColsPanelOpen] = useState(true)
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
  const [, setArmazemMissingCodes] = useState<string[]>([])
  const [confirmFinalizeMissingOpen, setConfirmFinalizeMissingOpen] = useState(false)
  const [missingItemsForFinalize, setMissingItemsForFinalize] = useState<OfflineChecklistItem[]>([])
  /** Contagem diária: ao finalizar com sucesso, abre modal com resumo (ref: itens preenchidos com 0 antes do envio). */
  const [savedCountModal, setSavedCountModal] = useState<{
    ymd: string
    registros: number
    pendAutoZero?: number
    conferenteNome?: string
  } | null>(null)
  const finalizePendAutoZeroRef = useRef<number | null>(null)
  const [checklistPage, setChecklistPage] = useState(1)
  /** Página dentro da tabela planilha da aba atual (independe das abas CAMARA/RUA). */
  const [planilhaTabelaPage, setPlanilhaTabelaPage] = useState(1)
  const [checklistShowAll, setChecklistShowAll] = useState(false)
  /** Feedback visual: linha da checklist acabou de ser gravada no `localStorage`. */
  const [checklistSavedFlashKey, setChecklistSavedFlashKey] = useState<string | null>(null)
  /** "Só pendentes": mantém item visível por alguns segundos após preencher quantidade. */
  const [checklistPendentesGraceUntil, setChecklistPendentesGraceUntil] = useState<Record<string, number>>({})
  const checklistPendentesGraceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const checklistSavedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Quem tem checklist aberta neste dia (heartbeat em `contagem_diaria_presenca`). */
  const [presencaContagemHoje, setPresencaContagemHoje] = useState<
    Array<{
      conferente_id: string
      nome: string
      atualizado_em: string
      linhasComQtd?: number | null
      linhasTotal?: number | null
      linhasGravadas: number
      ultimaGravacao: string | null
      checklistAtiva: boolean
    }>
  >([])
  /** Contagem diária bloqueada para edição quando já há 2+ conferentes finalizados no dia. */
  const [contagemDiariaBloqueadaEdicao, setContagemDiariaBloqueadaEdicao] = useState(false)
  /** Após bloqueio (2 conferentes finalizados), permite editar se o usuário escolher essa opção no aviso. */
  const [permitirEdicaoAposBloqueio, setPermitirEdicaoAposBloqueio] = useState(false)
  /** Modal customizado no lugar de `confirm` quando a contagem diária está bloqueada (2 finalizações). */
  const [bloqueioContagemDiariaModalOpen, setBloqueioContagemDiariaModalOpen] = useState(false)
  const bloqueioResolverRef = useRef<null | ((v: 'editar' | 'zero' | 'fechar') => void)>(null)
  const bloqueioPendingActionRef = useRef<(() => void) | null>(null)
  /** Ancora scroll após “Atualizar prévia” para a seção ficar visível (página longa no mobile). */
  const previewSectionRef = useRef<HTMLDivElement | null>(null)
  const checklistSectionRef = useRef<HTMLDivElement | null>(null)

  function flashChecklistRowSaved(key: string) {
    setChecklistSavedFlashKey(key)
    if (checklistSavedFlashTimerRef.current) window.clearTimeout(checklistSavedFlashTimerRef.current)
    checklistSavedFlashTimerRef.current = window.setTimeout(() => {
      setChecklistSavedFlashKey(null)
      checklistSavedFlashTimerRef.current = null
    }, 1800)
  }

  function schedulePendentesGrace(key: string, quantidade: string) {
    const filled = String(quantidade ?? '').trim() !== ''
    const prevTimer = checklistPendentesGraceTimersRef.current[key]
    if (prevTimer) {
      clearTimeout(prevTimer)
      delete checklistPendentesGraceTimersRef.current[key]
    }
    if (!filled) {
      setChecklistPendentesGraceUntil((prev) => {
        if (!(key in prev)) return prev
        const { [key]: _drop, ...rest } = prev
        return rest
      })
      return
    }
    const until = Date.now() + 3000
    setChecklistPendentesGraceUntil((prev) => ({ ...prev, [key]: until }))
    checklistPendentesGraceTimersRef.current[key] = setTimeout(() => {
      setChecklistPendentesGraceUntil((prev) => {
        if (!(key in prev)) return prev
        const { [key]: _drop, ...rest } = prev
        return rest
      })
      delete checklistPendentesGraceTimersRef.current[key]
    }, 3000)
  }

  const conferentesPreviaOpcoes = useMemo(() => {
    if (inventario) return [] as Array<{ id: string; nome: string }>
    const map = new Map<string, string>()
    for (const r of previewRows) {
      const det = r.preview_conferentes_detalhe
      if (!det?.length) continue
      for (const d of det) {
        if (d.conferente_id) map.set(d.conferente_id, String(d.conferente_nome ?? '').trim() || d.conferente_id)
      }
    }
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [previewRows, inventario])

  /** Modo efetivo na prévia: com `previewConferenteModoGlobal === null`, prioriza o conferente selecionado na sessão. */
  const previewConferenteModoEffective = useMemo(() => {
    if (inventario) return 'total'
    const manual = previewConferenteModoGlobal
    if (manual !== null) return manual
    const cid = String(conferenteId ?? '').trim()
    if (cid && conferentesPreviaOpcoes.some((o) => o.id === cid)) return cid
    return 'total'
  }, [inventario, previewConferenteModoGlobal, conferenteId, conferentesPreviaOpcoes])

  const previewQuantidadeExibidaPrevia = useCallback(
    (r: ContagemPreviewRow) => {
      if (inventario || !r.preview_conferentes_detalhe || r.preview_conferentes_detalhe.length <= 1) {
        return r.quantidade_up
      }
      const modo = previewConferenteModoEffective
      if (modo === 'total') return r.quantidade_up
      const part = r.preview_conferentes_detalhe.find((d) => d.conferente_id === modo)
      return part ? part.quantidade_up : r.quantidade_up
    },
    [inventario, previewConferenteModoEffective],
  )

  const previewSourceIdsParaAcaoPrevia = useCallback(
    (r: ContagemPreviewRow) => {
      const ids = r.source_ids?.length ? r.source_ids : [r.id]
      if (inventario || !r.preview_conferentes_detalhe || r.preview_conferentes_detalhe.length <= 1) {
        return ids
      }
      const modo = previewConferenteModoEffective
      if (modo === 'total') return ids
      const part = r.preview_conferentes_detalhe.find((d) => d.conferente_id === modo)
      return part?.source_ids?.length ? part.source_ids : ids
    },
    [inventario, previewConferenteModoEffective],
  )

  /** Com vários conferentes na mesma linha agrupada, edição de quantidade só faz sentido por conferente (não na soma). */
  const previewPodeEditarQuantidadePrevia = useCallback(
    (r: ContagemPreviewRow) => {
      if (inventario) return true
      const det = r.preview_conferentes_detalhe
      if (!det || det.length <= 1) return true
      return previewConferenteModoEffective !== 'total'
    },
    [inventario, previewConferenteModoEffective],
  )

  const dataHoraContagem = useMemo(() => {
    const elapsed = Date.now() - clockRealStartMs
    return toDatetimeLocalValue(new Date(clockBaseMs + elapsed))
  }, [clockBaseMs, clockRealStartMs, clockTick])

  const dataHoraContagemRef = useRef(dataHoraContagem)
  useEffect(() => {
    dataHoraContagemRef.current = dataHoraContagem
  }, [dataHoraContagem])

  const contagemDiariaPersistTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

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
    if (!savedCountModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSavedCountModal(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [savedCountModal])

  useEffect(() => {
    if (codigoInterno.trim()) setBarcodeFotoHint('')
  }, [codigoInterno])

  useEffect(() => {
    return () => {
      for (const id of Object.keys(checklistPendentesGraceTimersRef.current)) {
        clearTimeout(checklistPendentesGraceTimersRef.current[id])
      }
      checklistPendentesGraceTimersRef.current = {}
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const id of Object.keys(contagemDiariaPersistTimersRef.current)) {
        clearTimeout(contagemDiariaPersistTimersRef.current[id])
      }
      contagemDiariaPersistTimersRef.current = {}
    }
  }, [])

  // Restaura sessão offline aberta (persistência no navegador).
  useEffect(() => {
    const s = loadOfflineSession(sessionMode)
    if (s && s.status === 'aberta') {
      setOfflineSession(s)
      if (s.conferente_id) setConferenteId(s.conferente_id)
      if (s.data_contagem_ymd && /^\d{4}-\d{2}-\d{2}$/.test(s.data_contagem_ymd)) {
        setContagemDiaYmd(s.data_contagem_ymd)
      }
      if (s.listMode) setChecklistListMode(s.listMode)
      setStartFreshNotice('')
    }
  }, [sessionMode])

  /** Sessões antigas sem UUID de rascunho: gera um para permitir sync em tempo real no Supabase. */
  useEffect(() => {
    if (inventario) return
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      if (prev.contagem_diaria_rascunho_sessao_id && isUuid(prev.contagem_diaria_rascunho_sessao_id)) return prev
      const next = {
        ...prev,
        contagem_diaria_rascunho_sessao_id: newSessionId(),
        updatedAt: new Date().toISOString(),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
  }, [inventario, offlineSession?.sessionId, offlineSession?.status, sessionMode])

  useEffect(() => {
    setChecklistPage(1)
    setChecklistShowAll(false)
    setPlanilhaTabelaPage(1)
  }, [checklistListMode, checklistFilterCodigo, checklistFilterDescricao, offlineSession?.status])

  /** Lista quem está com sessão de contagem diária aberta no mesmo dia civil (heartbeat no Supabase). */
  useEffect(() => {
    if (inventario) {
      setPresencaContagemHoje([])
      setContagemDiariaBloqueadaEdicao(false)
      setPermitirEdicaoAposBloqueio(false)
      return
    }
    const ymd =
      offlineSession?.status === 'aberta' && offlineSession.data_contagem_ymd
        ? offlineSession.data_contagem_ymd
        : contagemDiaYmd
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return

    let cancelled = false
    const load = async () => {
      const [raw, finalMap] = await Promise.all([
        fetchContagemDiariaPresencaDia(ymd),
        fetchResumoFinalizadosContagemDiariaDia(ymd),
      ])
      if (!cancelled) setContagemDiariaBloqueadaEdicao(finalMap.size >= 2)
      const ativos = raw.filter((r) => isPresencaAtiva(r.atualizado_em))
      const presMap = new Map(ativos.map((p) => [p.conferente_id, p]))
      const allIds = new Set<string>()
      for (const p of ativos) allIds.add(p.conferente_id)
      for (const id of finalMap.keys()) allIds.add(id)
      const ids = [...allIds]
      const nomes = await fetchConferentesNomesPorIds(ids)
      const merged = ids
        .map((id) => {
          const pres = presMap.get(id)
          const fin = finalMap.get(id)
          const checklistAtiva = pres != null && isPresencaAtiva(pres.atualizado_em)
          const linhasGravadas = fin?.count ?? 0
          const ultimaGravacao = fin?.ultima ?? null
          const atualizado_em =
            pres?.atualizado_em ??
            ultimaGravacao ??
            new Date(0).toISOString()
          return {
            conferente_id: id,
            nome: nomes.get(id)?.trim() || id,
            atualizado_em,
            linhasComQtd:
              pres?.linhas_com_qtd != null && Number.isFinite(Number(pres.linhas_com_qtd))
                ? Number(pres.linhas_com_qtd)
                : null,
            linhasTotal:
              pres?.linhas_total != null && Number.isFinite(Number(pres.linhas_total))
                ? Number(pres.linhas_total)
                : null,
            linhasGravadas,
            ultimaGravacao,
            checklistAtiva,
          }
        })
        .filter((row) => row.checklistAtiva || row.linhasGravadas > 0)
        .sort((a, b) => {
          if (a.checklistAtiva !== b.checklistAtiva) return a.checklistAtiva ? -1 : 1
          return a.nome.localeCompare(b.nome, 'pt-BR')
        })
      if (!cancelled) setPresencaContagemHoje(merged)
    }

    void load()
    const id = window.setInterval(() => void load(), PRESENCA_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [inventario, contagemDiaYmd, offlineSession?.status, offlineSession?.data_contagem_ymd])

  useEffect(() => {
    setPermitirEdicaoAposBloqueio(false)
  }, [contagemDiaYmd])

  /** Contagem diária: atualiza quantidades/nomes a partir do banco (todos os conferentes), em tempo real + fallback lento. */
  useEffect(() => {
    if (inventario) return
    if (!offlineSession || offlineSession.status !== 'aberta') return
    const ymd = offlineSession.data_contagem_ymd
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return

    let cancelled = false
    const tick = async () => {
      const s = offlineSessionRef.current
      if (!s || s.status !== 'aberta' || cancelled) return
      if (s.items.length === 0) return
      const skip = checklistContagemBancoDirtyKeysRef.current
      try {
        const { items: merged } = await mergeContagensDiariasDoDiaParaItems(ymd, s.items, { skipKeys: skip })
        if (cancelled) return
        setOfflineSession((prev) => {
          if (!prev || prev.status !== 'aberta') return prev
          if (prev.sessionId !== s.sessionId) return prev
          return { ...prev, items: merged, updatedAt: new Date().toISOString() }
        })
      } catch {
        /* rede / RLS */
      }
    }
    void tick()
    const unsubRealtime = subscribeContagensEstoqueDia(ymd, () => void tick())
    const id = window.setInterval(() => void tick(), CONTAGEM_BANCO_MERGE_FALLBACK_MS)
    return () => {
      cancelled = true
      unsubRealtime()
      window.clearInterval(id)
    }
  }, [inventario, offlineSession?.status, offlineSession?.sessionId, offlineSession?.data_contagem_ymd])

  /** Prévia do banco: atualiza quando qualquer conferente grava no mesmo dia (Realtime). */
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)) return
    const ymd = previewConsultaDiaYmd
    const unsub = subscribeContagensEstoqueDia(ymd, () => {
      void loadPreviewRef.current(ymd, { silent: true })
    })
    return () => unsub()
  }, [previewConsultaDiaYmd, inventario])

  /** Enquanto a checklist estiver aberta, renova presença para o dia da sessão. */
  useEffect(() => {
    if (inventario) return
    if (!offlineSession || offlineSession.status !== 'aberta') return
    const ymd = offlineSession.data_contagem_ymd
    const cid = String(offlineSession.conferente_id ?? '').trim()
    if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return

    const tick = () => {
      const s = offlineSessionRef.current
      if (!s || s.status !== 'aberta') return
      const prog = progressoPresencaContagemDiaria(s)
      void upsertContagemDiariaPresenca(cid, ymd, prog)
    }
    tick()
    const id = window.setInterval(tick, PRESENCA_PING_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [inventario, offlineSession?.status, offlineSession?.sessionId, offlineSession?.conferente_id, offlineSession?.data_contagem_ymd])

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

  // Prévia do banco: sempre usa a data atual do dispositivo.
  useEffect(() => {
    const sync = () => {
      const todayYmd = toISODateLocal(new Date())
      setPreviewConsultaDiaYmd((prev) => (prev === todayYmd ? prev : todayYmd))
    }
    sync()
    const id = window.setInterval(sync, 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

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
    const onResize = () => setIsMobile(window.innerWidth <= 900)
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

  const productByCodeRef = useRef(productByCode)
  const productByCodeNoDotsRef = useRef(productByCodeNoDots)
  useEffect(() => {
    productByCodeRef.current = productByCode
    productByCodeNoDotsRef.current = productByCodeNoDots
  }, [productByCode, productByCodeNoDots])

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
      setSaveError('Data de validade não pode ser menor que a data de fabricação.')
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

  async function loadPreview(dayOverride?: string, opts?: { silent?: boolean }) {
    const silent = !!opts?.silent
    if (!silent) setPreviewLoading(true)
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

    const previewSelectFullLegacy =
      'id,data_hora_contagem,data_contagem,conferente_id,conferentes(nome),codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao,inventario_numero_contagem'
    const previewSelectFullBase = `${previewSelectFullLegacy},finalizacao_sessao_id`
    const previewSelectFull = `${previewSelectFullBase},contagem_rascunho`
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
    const previewSelectFlatFullLegacy =
      'id,data_hora_contagem,data_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,foto_base64,origem,inventario_repeticao,inventario_numero_contagem'
    const previewSelectFlatFullBase = `${previewSelectFlatFullLegacy},finalizacao_sessao_id`
    const previewSelectFlatFull = `${previewSelectFlatFullBase},contagem_rascunho`
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

    if (error && isMissingDbColumnError(error, 'finalizacao_sessao_id')) {
      const rSess = await queryPreview(previewSelectFullLegacy)
      data = rSess.data
      error = rSess.error
    }

    if (error && isMissingDbColumnError(error, 'contagem_rascunho')) {
      const rR = await queryPreview(previewSelectFullBase)
      data = rR.data
      error = rR.error
    }

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
      let rFlat = await queryPreview(previewSelectFlatFull)
      if (rFlat.error && isMissingDbColumnError(rFlat.error, 'finalizacao_sessao_id')) {
        rFlat = await queryPreview(previewSelectFlatFullLegacy)
      } else if (rFlat.error && isMissingDbColumnError(rFlat.error, 'contagem_rascunho')) {
        rFlat = await queryPreview(previewSelectFlatFullBase)
      }
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
          finalizacao_sessao_id:
            r.finalizacao_sessao_id != null && String(r.finalizacao_sessao_id).trim() !== ''
              ? String(r.finalizacao_sessao_id)
              : null,
          contagem_rascunho: isContagemRascunhoValorDb(r.contagem_rascunho),
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

      // Contagem diária: uma linha por produto — sempre o lançamento com maior data_hora_contagem (rascunho ou oficial).
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
        const sortPreviaContagemDiaria = (a: ContagemPreviewRow, b: ContagemPreviewRow) => {
          const c = a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
          if (c !== 0) return c
          return a.descricao.localeCompare(b.descricao, 'pt-BR')
        }
        previewList = prepararContagemDiariaOficialListaUnicaPorProduto(
          rawPreviewLinhas,
        ).sort(sortPreviaContagemDiaria) as ContagemPreviewRow[]
      }

      setPreviewQueryDayYmd(dayKey)
      setPreviewRows(previewList)
      setPreviewConferenteModoGlobal(null)
      if (!silent) {
        window.setTimeout(() => {
          previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 0)
      }
    }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!silent) setSaveError(`Erro ao carregar prévia: ${msg}`)
    } finally {
      if (!silent) setPreviewLoading(false)
    }
  }
  loadPreviewRef.current = loadPreview

  async function fetchListaChecklistFromDb(): Promise<Array<{ codigo_interno: string; descricao: string }>> {
    const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').limit(15000)
    if (error) {
      throw new Error(`Erro ao carregar "${TABELA_PRODUTOS}": ${error.message}`)
    }
    const opts = (data ?? [])
      .map((row: Record<string, unknown>) => mapRowToProductOption(row as Record<string, any>))
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

  async function handleCarregarListaPlanilha(opts?: { forceZero?: boolean }) {
    let forceZero = Boolean(opts?.forceZero)
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
      if (!inventario) {
        const finalizadosHoje = await fetchResumoFinalizadosContagemDiariaDia(contagemDiaYmd)
        if (finalizadosHoje.size >= 2 && !forceZero) {
          const choice = await new Promise<'editar' | 'zero' | 'fechar'>((resolve) => {
            bloqueioPendingActionRef.current = null
            setBloqueioContagemDiariaModalOpen(true)
            bloqueioResolverRef.current = resolve
          })
          if (choice === 'fechar') {
            setChecklistLoading(false)
            return
          }
          if (choice === 'editar') {
            setPermitirEdicaoAposBloqueio(true)
          } else {
            forceZero = true
            setPermitirEdicaoAposBloqueio(false)
          }
        }
      }

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

      if (!inventario) {
        itemsRaw = itemsRaw.filter(
          (row) => !CONTAGEM_DIARIA_EXCLUIR_DA_LISTA.has(normalizeCodigoInternoCompareKey(row.codigo_interno)),
        )
      }

      let items: OfflineChecklistItem[] = []
      itemsRaw.forEach((row, index) => {
        const p = lookupProductOptionByCodigo(row.codigo_interno.trim(), productByCode, productByCodeNoDots)
        const repeticoes = inventario ? ([1, 2, 3] as const) : ([1] as const)
        const codigoNorm = normalizeCodigoInternoCompareKey(row.codigo_interno)
        repeticoes.forEach((rep) => {
          if (inventario && rep === 3 && INVENTARIO_EXCLUIR_DA_3A_CONTAGEM.has(codigoNorm)) return
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
      let preenchidosDoBanco = 0
      if (!inventario && !forceZero) {
        const merged = await mergeContagensDiariasDoDiaParaItems(contagemDiaYmd, items)
        items = merged.items
        preenchidosDoBanco = merged.preenchidos
      }
      const sess: OfflineSession = {
        sessionId: newSessionId(),
        data_contagem_ymd: contagemDiaYmd,
        conferente_id: conferenteId,
        status: 'aberta',
        listMode: listModeEfetivo,
        context: sessionMode,
        items,
        ...(inventario ? { inventario_numero_contagem: 1 as const } : { contagem_diaria_rascunho_sessao_id: newSessionId() }),
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
          : `Lista carregada: ${items.length} itens.${
              preenchidosDoBanco > 0
                ? ` ${preenchidosDoBanco} linha(s) já preenchida(s) com o que está no banco hoje (última gravação por código, todos os conferentes).`
                : ''
            } Preencha as quantidades e finalize quando terminar.`,
      )
      if (!inventario && forceZero) {
        setStartFreshNotice(
          `Nova contagem iniciada do zero para ${formatDateBRFromYmd(contagemDiaYmd)}. A lista foi aberta em branco.`,
        )
      } else {
        setStartFreshNotice('')
      }
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
    void apagarRascunhoSupabaseParaSessao(offlineSession)
    clearOfflineSession(sessionMode)
    setOfflineSession(null)
    setChecklistError('')
    setChecklistListMode('todos')
  }

  function handleIniciarContagemDiaDoZero() {
    if (inventario) return
    if (!conferenteId) {
      setChecklistError('Selecione um conferente antes de iniciar a contagem do zero.')
      return
    }
    const ok = window.confirm(
      `Iniciar nova contagem do zero para ${formatDateBRFromYmd(contagemDiaYmd)}?\n\n` +
        'A lista será aberta em branco (sem copiar quantidades do banco).',
    )
    if (!ok) return
    void handleCarregarListaPlanilha({ forceZero: true })
  }

  async function apagarRascunhoSupabaseParaSessao(s: OfflineSession) {
    if (inventario) return
    const dr = s.contagem_diaria_rascunho_sessao_id
    const cid = String(s.conferente_id ?? '').trim()
    const ymd = s.data_contagem_ymd
    if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
    if (dr && isUuid(dr)) {
      const { error } = await supabase
        .from('contagens_estoque')
        .delete()
        .eq('conferente_id', cid)
        .eq('finalizacao_sessao_id', dr)
      if (!error) return
      if (!isMissingDbColumnError(error, 'finalizacao_sessao_id') && import.meta.env.DEV) {
        console.warn('[contagem rascunho] delete por sessão', error)
      }
    }
    const { error: e2 } = await supabase
      .from('contagens_estoque')
      .delete()
      .eq('conferente_id', cid)
      .eq('data_contagem', ymd)
      .eq('contagem_rascunho', true)
    if (e2 && import.meta.env.DEV && !isMissingDbColumnError(e2, 'contagem_rascunho')) {
      console.warn('[contagem rascunho] delete fallback', e2)
    }
  }

  function scheduleContagemDiariaRascunhoPersist(itemKey: string) {
    if (inventario || finalizing) return
    const s = offlineSessionRef.current
    if (!s || s.status !== 'aberta') return
    if (!s.contagem_diaria_rascunho_sessao_id || !isUuid(s.contagem_diaria_rascunho_sessao_id)) return
    const prevT = contagemDiariaPersistTimersRef.current[itemKey]
    if (prevT) clearTimeout(prevT)
    contagemDiariaPersistTimersRef.current[itemKey] = setTimeout(() => {
      delete contagemDiariaPersistTimersRef.current[itemKey]
      void flushPersistContagemDiariaRascunho(itemKey)
    }, 700)
  }

  async function flushPersistContagemDiariaRascunho(itemKey: string) {
    if (inventario || finalizing) return
    const s = offlineSessionRef.current
    if (!s || s.status !== 'aberta') return
    const draftId = s.contagem_diaria_rascunho_sessao_id
    if (!draftId || !isUuid(draftId)) return
    const cid = String(s.conferente_id ?? '').trim()
    if (!cid) return
    const ymd = s.data_contagem_ymd
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
    const it = s.items.find((i) => i.key === itemKey)
    if (!it) return
    const codRaw = String(it.codigo_interno ?? '').trim()
    if (!codRaw) return
    const catalog = lookupProductOptionByCodigo(codRaw, productByCodeRef.current, productByCodeNoDotsRef.current)
    const codigoDb = String(catalog?.codigo ?? it.codigo_interno).trim()
    const qStr = String(it.quantidade_contada ?? '').trim()

    const delLinha = async () => {
      const { error } = await supabase
        .from('contagens_estoque')
        .delete()
        .eq('data_contagem', ymd)
        .eq('conferente_id', cid)
        .eq('finalizacao_sessao_id', draftId)
        .eq('codigo_interno', codigoDb)
      if (!error) return
      if (isMissingDbColumnError(error, 'finalizacao_sessao_id')) {
        const r2 = await supabase
          .from('contagens_estoque')
          .delete()
          .eq('data_contagem', ymd)
          .eq('conferente_id', cid)
          .eq('codigo_interno', codigoDb)
          .eq('contagem_rascunho', true)
        if (r2.error && import.meta.env.DEV) console.warn('[contagem rascunho] delete qty vazia', r2.error)
        return
      }
      if (import.meta.env.DEV) console.warn('[contagem rascunho] delete qty vazia', error)
    }

    if (qStr === '') {
      await delLinha()
      checklistContagemBancoDirtyKeysRef.current.delete(itemKey)
      return
    }
    const q = Number(qStr.replace(',', '.'))
    if (!Number.isFinite(q) || q < 0) return
    const dfRaw = String(it.data_fabricacao ?? '').trim()
    const dvRaw = String(it.data_validade ?? '').trim()
    if (isVencimentoAntesFabricacao(dfRaw, dvRaw)) return
    const upRaw = String(it.up_quantidade ?? '').trim()
    let up_adicional: number | null = null
    if (upRaw !== '') {
      const u = Number(upRaw.replace(',', '.'))
      if (!Number.isFinite(u) || u < 0) return
      up_adicional = u
    }
    const produtoId = catalog?.id != null && isUuid(String(catalog.id)) ? String(catalog.id) : null
    const dataHoraIso = toISOStringFromDatetimeLocal(dataHoraContagemRef.current)

    let rowPayload: Record<string, unknown> = {
      data_contagem: ymd,
      data_hora_contagem: dataHoraIso,
      conferente_id: cid,
      produto_id: produtoId,
      codigo_interno: codigoDb,
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
      finalizacao_sessao_id: draftId,
      contagem_rascunho: true,
    }

    {
      const { error: delErr } = await supabase
        .from('contagens_estoque')
        .delete()
        .eq('data_contagem', ymd)
        .eq('conferente_id', cid)
        .eq('finalizacao_sessao_id', draftId)
        .eq('codigo_interno', codigoDb)
      if (delErr && !isMissingDbColumnError(delErr, 'finalizacao_sessao_id') && import.meta.env.DEV) {
        console.warn('[contagem rascunho] delete antes do insert', delErr)
      }
      if (delErr && isMissingDbColumnError(delErr, 'finalizacao_sessao_id')) {
        const r2 = await supabase
          .from('contagens_estoque')
          .delete()
          .eq('data_contagem', ymd)
          .eq('conferente_id', cid)
          .eq('codigo_interno', codigoDb)
          .eq('contagem_rascunho', true)
        if (r2.error && import.meta.env.DEV) console.warn('[contagem rascunho] delete antes insert fallback', r2.error)
      }
    }

    let ins = await supabase.from('contagens_estoque').insert(rowPayload).select('id').limit(1)
    if (ins.error && isMissingDbColumnError(ins.error, 'contagem_rascunho')) {
      rowPayload = stripContagensEstoqueContagemRascunhoColumn(rowPayload)
      ins = await supabase.from('contagens_estoque').insert(rowPayload).select('id').limit(1)
    }
    if (ins.error && isMissingDbColumnError(ins.error, 'finalizacao_sessao_id')) {
      rowPayload = stripContagensEstoqueFinalizacaoSessaoColumn(rowPayload)
      ins = await supabase.from('contagens_estoque').insert(rowPayload).select('id').limit(1)
    }
    if (ins.error) {
      if (import.meta.env.DEV) console.warn('[contagem rascunho] insert', ins.error)
      return
    }
    checklistContagemBancoDirtyKeysRef.current.delete(itemKey)
  }

  function updateOfflineItemQty(key: string, quantidade: string, opts?: { skipBloqueioGuard?: boolean }) {
    if (!opts?.skipBloqueioGuard && checklistEdicaoBloqueada) {
      setBloqueioContagemDiariaModalOpen(true)
      bloqueioResolverRef.current = null
      bloqueioPendingActionRef.current = () => updateOfflineItemQty(key, quantidade, { skipBloqueioGuard: true })
      return
    }
    if (!inventario) {
      const trimmed = String(quantidade ?? '').trim()
      if (trimmed === '') checklistContagemBancoDirtyKeysRef.current.delete(key)
      else checklistContagemBancoDirtyKeysRef.current.add(key)
    }
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, quantidade_contada: quantidade } : it)),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
    schedulePendentesGrace(key, quantidade)
    flashChecklistRowSaved(key)
    if (!inventario) scheduleContagemDiariaRascunhoPersist(key)
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
    opts?: { skipBloqueioGuard?: boolean },
  ) {
    if (!opts?.skipBloqueioGuard && checklistEdicaoBloqueada) {
      setBloqueioContagemDiariaModalOpen(true)
      bloqueioResolverRef.current = null
      bloqueioPendingActionRef.current = () => updateOfflineItemFields(key, patch, { skipBloqueioGuard: true })
      return
    }
    if (!inventario && 'quantidade_contada' in patch) {
      const trimmed = String(patch.quantidade_contada ?? '').trim()
      if (trimmed === '') checklistContagemBancoDirtyKeysRef.current.delete(key)
      else checklistContagemBancoDirtyKeysRef.current.add(key)
    }
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
    if ('quantidade_contada' in patch) {
      schedulePendentesGrace(key, String(patch.quantidade_contada ?? ''))
    }
    flashChecklistRowSaved(key)
    if (!inventario) {
      const syncKeys: (keyof OfflineChecklistItem)[] = [
        'quantidade_contada',
        'up_quantidade',
        'lote',
        'observacao',
        'data_fabricacao',
        'data_validade',
        'ean',
        'dun',
      ]
      if (syncKeys.some((k) => k in patch)) scheduleContagemDiariaRascunhoPersist(key)
    }
  }

  function setInventarioNumeroContagemRodada(n: 1 | 2 | 3 | 4) {
    const nStr = String(n)
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      const next = {
        ...prev,
        inventario_numero_contagem: n,
        updatedAt: new Date().toISOString(),
        ...(prev.listMode === 'planilha'
          ? {
              items: prev.items.map((it) =>
                String(it.quantidade_contada ?? '').trim() === ''
                  ? { ...it, quantidade_contada: nStr }
                  : it,
              ),
            }
          : {}),
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

  function scrollToChecklistTitle() {
    window.setTimeout(() => {
      checklistSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  function openChecklistEdit(it: OfflineChecklistItem, opts?: { skipBloqueioGuard?: boolean }) {
    if (!opts?.skipBloqueioGuard && checklistEdicaoBloqueada) {
      setBloqueioContagemDiariaModalOpen(true)
      bloqueioResolverRef.current = null
      bloqueioPendingActionRef.current = () => openChecklistEdit(it, { skipBloqueioGuard: true })
      return
    }
    if (checklistEditingKey && checklistEditingKey !== it.key) {
      if (!confirm('Há outra linha em edição. Descartar alterações nela e editar esta?')) return
    }
    setChecklistEditingKey(it.key)
    const rodada = clampInventarioNumeroContagem(offlineSession?.inventario_numero_contagem ?? 1)
    const qtdDraft =
      inventario && offlineSession?.listMode === 'planilha'
        ? quantidadePlanilhaInventarioEfetiva(it, rodada)
        : it.quantidade_contada
    setChecklistEditDraft({
      codigo_interno: it.codigo_interno,
      descricao: it.descricao,
      quantidade_contada: qtdDraft,
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
    setSavedCountModal(null)
    setChecklistError('')
    setFinalizeProgress('')
    setConfirmFinalizeMissingOpen(false)
    finalizePendAutoZeroRef.current = null
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
      const rodadaPend = clampInventarioNumeroContagem(offlineSession.inventario_numero_contagem ?? 1)
      const missing = itemsSnapshot.filter((i) => {
        if (offlineSession.listMode === 'planilha') {
          const c = String(i.codigo_interno ?? '').trim()
          if (!c) return false
          return quantidadePlanilhaInventarioEfetiva(i, rodadaPend) === ''
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
      finalizePendAutoZeroRef.current = null
      setChecklistError('Sessão inválida ou já finalizada. Carregue a lista de produtos de novo.')
      return
    }
    /**
     * A sessão já guarda o conferente válido; se o seletor da tela estiver vazio/desalinhado
     * (ex.: retorno de outra aba), sincronizamos e seguimos com o conferente da sessão.
     */
    const effectiveConferenteId = String(conferenteId || session.conferente_id || '').trim()
    if (!effectiveConferenteId) {
      finalizePendAutoZeroRef.current = null
      setChecklistError('Selecione um conferente para finalizar a sessão.')
      return
    }
    if (session.conferente_id !== effectiveConferenteId) {
      setConferenteId(session.conferente_id)
    }

    setFinalizing(true)
    try {
      for (const k of Object.keys(contagemDiariaPersistTimersRef.current)) {
        clearTimeout(contagemDiariaPersistTimersRef.current[k])
      }
      contagemDiariaPersistTimersRef.current = {}

      const pendAutoZeroSnapshot = finalizePendAutoZeroRef.current
      finalizePendAutoZeroRef.current = null

      const ymd = session.data_contagem_ymd
      let itemsSnapshot = session.items.map((i) => ({ ...i }))

      itemsSnapshot = itemsSnapshot.filter((it) => String(it.codigo_interno ?? '').trim() !== '')
      /** Só grava linhas com quantidade digitada; vazio não vira 0 e não é enviado. Na planilha de inventário, vazio usa o número da rodada (1–4). */
      const rodadaFin = clampInventarioNumeroContagem(session.inventario_numero_contagem ?? 1)
      itemsSnapshot = itemsSnapshot.filter((it) => {
        if (session.listMode === 'planilha') {
          return quantidadePlanilhaInventarioEfetiva(it, rodadaFin) !== ''
        }
        return String(it.quantidade_contada ?? '').trim() !== ''
      })
      if (itemsSnapshot.length === 0) {
        setChecklistError(
          'Nenhuma linha com código e quantidade preenchidos. Informe a quantidade nos produtos que deseja gravar (campos vazios permanecem de fora do banco).',
        )
        return
      }

      if (!inventario) {
        await apagarRascunhoSupabaseParaSessao(session)
      }

      const dataHoraIso = toISOStringFromDatetimeLocal(dataHoraContagem)
      const finalizacaoSessaoId = !inventario ? newSessionId() : null
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
        const qStr =
          session.listMode === 'planilha'
            ? quantidadePlanilhaInventarioEfetiva(it, rodadaFin)
            : String(it.quantidade_contada ?? '').trim()
        const q = Number(String(qStr).replace(',', '.'))
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
            `Datas inválidas para ${it.codigo_interno}${it.inventario_repeticao ? ` (${it.inventario_repeticao}ª contagem)` : ''}: validade antes da fabricação.`,
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
        } else {
          if (finalizacaoSessaoId) rowPayload.finalizacao_sessao_id = finalizacaoSessaoId
          /** Linha definitiva — separa da prévia colaborativa (`contagem_rascunho = true`). */
          rowPayload.contagem_rascunho = false
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
        if (insErr && isMissingDbColumnError(insErr, 'finalizacao_sessao_id')) {
          attemptPayload = attemptPayload.map((r) => stripContagensEstoqueFinalizacaoSessaoColumn(r))
          const res = await supabase.from('contagens_estoque').insert(attemptPayload).select('id')
          insertedChunk = res.data
          insErr = res.error
        }
        if (insErr && isMissingDbColumnError(insErr, 'contagem_rascunho')) {
          attemptPayload = attemptPayload.map((r) => stripContagensEstoqueContagemRascunhoColumn(r))
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
      setPreviewConsultaDiaYmd(ymd)
      await loadPreview(ymd)

      if (inventario) {
        setSaveSuccess(
          `Inventário do dia ${ymd} finalizado: ${rows.length} novo(s) registro(s) em contagens_estoque (acumula com contagens anteriores do mesmo dia).${
            planilhaGravada ? ` ${rows.length} linha(s) em inventario_planilha_linhas.` : ''
          }${planilhaAviso ?? ''}${inventarioDbCompatMsg}`,
        )
      } else {
        const confRow = conferentes.find((x) => x.id === session.conferente_id)
        const nomeConf =
          confRow?.nome != null && String(confRow.nome).trim() !== '' ? String(confRow.nome).trim() : undefined
        setSavedCountModal({
          ymd,
          registros: rows.length,
          pendAutoZero:
            pendAutoZeroSnapshot != null && pendAutoZeroSnapshot > 0 ? pendAutoZeroSnapshot : undefined,
          conferenteNome: nomeConf,
        })
        setSaveSuccess('Contagem salva no Supabase.')
      }
      setFinalizeProgress(
        planilhaGravada
          ? 'Concluído: contagens e planilha de inventário gravadas.'
          : 'Concluído: registros salvos com sucesso.',
      )
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
      const qConf = previewFilterConferente.trim().toLowerCase()
      const confOk =
        !qConf ||
        r.conferente_nome.toLowerCase().includes(qConf) ||
        r.conferente_id.toLowerCase().includes(qConf) ||
        (r.preview_conferentes_detalhe?.some((d) => d.conferente_nome.toLowerCase().includes(qConf)) ?? false)
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

  useEffect(() => {
    if (previewConferenteModoGlobal === null || previewConferenteModoGlobal === 'total') return
    if (!conferentesPreviaOpcoes.some((o) => o.id === previewConferenteModoGlobal)) {
      setPreviewConferenteModoGlobal(null)
    }
  }, [conferentesPreviaOpcoes, previewConferenteModoGlobal])

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
    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd) ? previewConsultaDiaYmd : null
    if (!dayKey) {
      setPreviewRowError('Selecione uma data válida em “Dia no banco”.')
      return
    }

    const dayLabel = formatDateBRFromYmd(dayKey)
    const modoLabel = inventario
      ? 'inventário (apenas registros com origem = inventário)'
      : 'contagem diária (registros que não são inventário)'
    const avisoDiaPreview =
      previewQueryDayYmd && previewQueryDayYmd !== dayKey
        ? `\n\nObs.: a tabela abaixo está carregada para ${formatDateBRFromYmd(previewQueryDayYmd)}. A exclusão será somente do dia ${dayLabel} (data do campo “Dia no banco”).`
        : ''

    const senha = window.prompt(
      `Digite a senha para excluir do banco os registros de contagens_estoque APENAS do dia ${dayLabel} (data selecionada em “Dia no banco”), conforme o modo atual (${inventario ? 'inventário' : 'contagem diária'}):`,
    )
    if (senha === null) return
    if (senha.trim() !== SENHA_EXCLUIR_TUDO_BANCO) {
      setPreviewRowError('Senha incorreta. Nenhum registro foi excluído.')
      return
    }

    if (
      !window.confirm(
        `ATENÇÃO\n\nSerão apagados permanentemente do banco somente os registros da tabela contagens_estoque que tenham:\n• ${modoLabel}\n• data_contagem = ${dayLabel}${avisoDiaPreview}\n\nNão serão apagados registros de outros dias.\n\nEsta ação não pode ser desfeita.\n\nDeseja continuar?`,
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
            /** Mesmo escopo do delete por metadados, sem depender da prévia na tela (evita outro dia se o seletor mudou). */
            const rFetch = await supabase
              .from('contagens_estoque')
              .select('id')
              .eq('data_contagem', dayKey)
              .or('inventario_repeticao.not.is.null,inventario_numero_contagem.not.is.null')
              .limit(5000)
            const idList = (rFetch.data ?? [])
              .map((row: { id?: string }) => String(row.id ?? ''))
              .filter(Boolean)
            if (idList.length === 0) {
              throw new Error(
                'Sem coluna origem e nenhum registro de inventário encontrado para este dia. Rode supabase/sql/alter_contagens_estoque_origem_inventario.sql no Supabase se necessário.',
              )
            }
            const delPorIds = await supabase.from('contagens_estoque').delete().in('id', idList)
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
      const idsToDelete = row ? previewSourceIdsParaAcaoPrevia(row) : [id]
      if (inventario) {
        await deleteInventarioPlanilhaLinhasForContagensIds(supabase, idsToDelete)
      }
      const { error } = await supabase.from('contagens_estoque').delete().in('id', idsToDelete)
      if (error) throw error

      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      await loadPreview()
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
      const idsToUpdate = previewSourceIdsParaAcaoPrevia(row)
      const { error } = await supabase
        .from('contagens_estoque')
        .update({ foto_base64: null })
        .in('id', idsToUpdate)
      if (error) throw error
      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      await loadPreview()
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
      if (!row) {
        setPreviewRowError('Linha não encontrada na prévia.')
        return
      }
      if (!previewPodeEditarQuantidadePrevia(row)) {
        setPreviewRowError(
          'Selecione um conferente específico no seletor “Conferente na prévia” acima para editar a quantidade; não é possível editar a soma de todos.',
        )
        return
      }
      const sourceIds = previewSourceIdsParaAcaoPrevia(row)
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

      await loadPreview()
    } catch (e: any) {
      setPreviewRowError(`Erro ao atualizar quantidade: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  function renderPreviewTable() {
    /** Mesma regra da lista principal (Ocultar/mostrar colunas). */
    const prevCol = (id: string) => checklistVisibleCols[id] !== false
    const previewVisColCount =
      (inventario ? PREVIEW_COLS_PLANILHA_BASE + 1 : 1) +
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

    const previewConferenteGlobalBar =
      !inventario && conferentesPreviaOpcoes.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            marginTop: 0,
            marginBottom: 8,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border, #555)',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <label
            htmlFor="preview-conferente-global"
            style={{ fontSize: 13, color: 'var(--text, #ccc)', fontWeight: 600 }}
          >
            Conferente na prévia (todas as linhas)
          </label>
          <select
            id="preview-conferente-global"
            value={previewConferenteModoEffective}
            onChange={(e) => {
              const v = e.target.value
              setPreviewConferenteModoGlobal(v === 'total' ? 'total' : v)
            }}
            style={{
              padding: '8px 10px',
              border: '1px solid #ccc',
              borderRadius: 8,
              minWidth: 220,
              flex: '1 1 200px',
              maxWidth: '100%',
            }}
            aria-label="Conferente na prévia para todas as linhas"
          >
            <option value="total">Soma (todos os conferentes)</option>
            {conferentesPreviaOpcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
      ) : null

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
          {previewConferenteGlobalBar}
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
                    {inventario ? (
                      <>
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
                      </>
                    ) : null}
                    {inventario ? (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Contagem</div>
                        <div style={{ fontSize: 13 }}>{formatInventarioRodadaPreviewCell(r.inventario_numero_contagem)}</div>
                      </>
                    ) : null}
                    <div style={{ fontSize: 12, color: 'var(--text, #888)', marginTop: 8 }}>Conferente</div>
                    <div style={{ fontSize: 13 }}>
                      {!inventario && r.preview_conferentes_detalhe && r.preview_conferentes_detalhe.length > 1 ? (
                        previewConferenteModoEffective === 'total' ? (
                          r.conferente_nome
                        ) : (
                          r.preview_conferentes_detalhe.find((d) => d.conferente_id === previewConferenteModoEffective)
                            ?.conferente_nome ?? '—'
                        )
                      ) : String(r.conferente_nome ?? '').trim() !== '' ? (
                        r.conferente_nome
                      ) : (
                        '—'
                      )}
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
                            {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
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
                          <span style={{ marginLeft: 8 }}>{previewQuantidadeExibidaPrevia(r)}</span>
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
                        Data de validade:{' '}
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
                          title={
                            !previewPodeEditarQuantidadePrevia(r)
                              ? 'Selecione um conferente no seletor “Conferente na prévia” acima para editar a quantidade'
                              : undefined
                          }
                          onClick={() => {
                            setEditingPreviewId(r.id)
                            setEditingPreviewQuantidade(String(previewQuantidadeExibidaPrevia(r)))
                            setPreviewRowError('')
                          }}
                          disabled={previewRowActionLoading || !previewPodeEditarQuantidadePrevia(r)}
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
        {previewConferenteGlobalBar}
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
              {inventario ? (
                <>
                  <th style={thStyle}>Câmara</th>
                  <th style={thStyle}>Rua</th>
                  <th style={thStyle}>POS</th>
                  <th style={thStyle}>Nível</th>
                  <th style={thStyle}>Contagem</th>
                </>
              ) : null}
              <th style={thStyle}>Conferente</th>
              {prevCol('codigo') ? <th style={thStyle}>Código do produto</th> : null}
              {prevCol('descricao') ? <th style={thStyle}>Descrição</th> : null}
              {prevCol('unidade') ? <th style={thStyle}>Unidade de medida</th> : null}
              {prevCol('quantidade') ? <th style={thStyle}>Quantidade contada</th> : null}
              {prevCol('data_fabricacao') ? <th style={thStyle}>Data de fabricação</th> : null}
              {prevCol('data_validade') ? <th style={thStyle}>Data de validade</th> : null}
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
                  {inventario ? (
                    <>
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
                      <td style={tdStyle}>{formatInventarioRodadaPreviewCell(r.inventario_numero_contagem)}</td>
                    </>
                  ) : null}
                  <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 240 }}>
                    {!inventario && r.preview_conferentes_detalhe && r.preview_conferentes_detalhe.length > 1 ? (
                      previewConferenteModoEffective === 'total' ? (
                        r.conferente_nome
                      ) : (
                        r.preview_conferentes_detalhe.find((d) => d.conferente_id === previewConferenteModoEffective)
                          ?.conferente_nome ?? '—'
                      )
                    ) : String(r.conferente_nome ?? '').trim() !== '' ? (
                      r.conferente_nome
                    ) : (
                      '—'
                    )}
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
                          {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                          style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 8, width: 104 }}
                        />
                      ) : (
                        previewQuantidadeExibidaPrevia(r)
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
                              title={
                                !previewPodeEditarQuantidadePrevia(r)
                                  ? 'Selecione um conferente no seletor “Conferente na prévia” acima para editar a quantidade'
                                  : undefined
                              }
                              onClick={() => {
                                setEditingPreviewId(r.id)
                                setEditingPreviewQuantidade(String(previewQuantidadeExibidaPrevia(r)))
                                setPreviewRowError('')
                              }}
                              disabled={previewRowActionLoading || !previewPodeEditarQuantidadePrevia(r)}
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
          const graceActive =
            checklistFilterPendentes &&
            !pend &&
            (checklistPendentesGraceUntil[it.key] ?? 0) > Date.now()
          const pendOk = !checklistFilterPendentes || pend || graceActive
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

  /** Planilha inventário: linhas novas com quantidade vazia recebem o número da rodada (1–4) no estado. */
  const planilhaItensLen = offlineSession?.items?.length ?? 0
  const planilhaItensComQtdVazia = useMemo(() => {
    if (!offlineSession?.items) return 0
    return offlineSession.items.filter((it) => String(it.quantidade_contada ?? '').trim() === '').length
  }, [offlineSession?.items])

  useEffect(() => {
    if (!inventario || !offlineSession || offlineSession.status !== 'aberta') return
    if (offlineSession.listMode !== 'planilha') return
    if (planilhaItensComQtdVazia === 0) return
    const nStr = String(inventarioNumeroContagemRodada)
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta' || prev.listMode !== 'planilha') return prev
      if (!prev.items.some((it) => String(it.quantidade_contada ?? '').trim() === '')) return prev
      const next = {
        ...prev,
        items: prev.items.map((it) =>
          String(it.quantidade_contada ?? '').trim() === '' ? { ...it, quantidade_contada: nStr } : it,
        ),
        updatedAt: new Date().toISOString(),
      }
      saveOfflineSession(next, sessionMode)
      return next
    })
  }, [
    inventario,
    offlineSession?.sessionId,
    offlineSession?.status,
    offlineSession?.listMode,
    planilhaItensLen,
    planilhaItensComQtdVazia,
    inventarioNumeroContagemRodada,
    sessionMode,
  ])

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
      { id: 'data_validade', label: 'Data de validade' },
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
  const checklistEdicaoBloqueada = !inventario && contagemDiariaBloqueadaEdicao && !permitirEdicaoAposBloqueio
  const checklistEdicaoBloqueadaMsg =
    'A contagem diária deste dia já foi finalizada por 2 conferentes.'

  function handleBloqueioModalFazerAlteracao() {
    setChecklistError('')
    const r = bloqueioResolverRef.current
    bloqueioResolverRef.current = null
    const p = bloqueioPendingActionRef.current
    bloqueioPendingActionRef.current = null
    setBloqueioContagemDiariaModalOpen(false)
    if (r) {
      r('editar')
      return
    }
    setPermitirEdicaoAposBloqueio(true)
    if (p) p()
  }

  function handleBloqueioModalIniciarZero() {
    const r = bloqueioResolverRef.current
    bloqueioResolverRef.current = null
    bloqueioPendingActionRef.current = null
    setBloqueioContagemDiariaModalOpen(false)
    if (r) {
      r('zero')
      return
    }
    setPermitirEdicaoAposBloqueio(false)
    void handleCarregarListaPlanilha({ forceZero: true })
  }

  function handleBloqueioModalFechar() {
    const r = bloqueioResolverRef.current
    bloqueioResolverRef.current = null
    bloqueioPendingActionRef.current = null
    setBloqueioContagemDiariaModalOpen(false)
    if (r) r('fechar')
  }

  const carregarListaDisabled = checklistLoading || finalizing || !conferenteId
  const finalizarListaDisabled =
    finalizing ||
    !offlineSession ||
    offlineSession.status !== 'aberta' ||
    offlineSession.items.length === 0

  const checklistPaginationControls =
    checklistProductTotal > 0 ? (
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
            Troque de <strong>CAMARA/RUA</strong> apenas pelas <strong>abas</strong> acima — a tabela desta aba mostra as
            15 posições inteiras ({INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA} linhas).
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={checklistShowAll || checklistPageSafe <= 1}
              onClick={() => {
                setChecklistPage((p) => Math.max(1, p - 1))
                scrollToChecklistTitle()
              }}
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
              onClick={() => {
                setChecklistPage((p) => Math.min(checklistTotalPages, p + 1))
                scrollToChecklistTitle()
              }}
              style={{
                ...buttonStyle,
                background: '#444',
                fontSize: 12,
                opacity: checklistShowAll || checklistPageSafe >= checklistTotalPages ? 0.5 : 1,
                cursor: checklistShowAll || checklistPageSafe >= checklistTotalPages ? 'not-allowed' : 'pointer',
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
                    scrollToChecklistTitle()
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
    ) : null

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

      {!inventario && presencaContagemHoje.length > 0 ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            border: '1px solid var(--border, #555)',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          <strong style={{ color: '#ffd95c' }}>Contagem neste dia</strong>
          <span style={{ color: 'var(--text-muted, #aaa)', marginLeft: 8 }}>
            (checklist aberta · linhas já gravadas no banco · cada um finaliza separado)
          </span>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {presencaContagemHoje.map((p) => (
              <li key={p.conferente_id}>
                {p.nome}
                {((conferenteId && conferenteId === p.conferente_id) ||
                  (offlineSession?.status === 'aberta' && offlineSession.conferente_id === p.conferente_id)) ? (
                  ' (você)'
                ) : (
                  ''
                )}
                {p.checklistAtiva &&
                p.linhasTotal != null &&
                p.linhasTotal > 0 &&
                p.linhasComQtd != null &&
                Number.isFinite(p.linhasComQtd) ? (
                  <>
                    {' · '}
                    <span style={{ opacity: 0.95 }}>
                      {p.linhasComQtd}/{p.linhasTotal} na checklist
                    </span>
                  </>
                ) : null}
                {p.linhasGravadas > 0 ? (
                  <>
                    {' · '}
                    <span style={{ opacity: 0.95 }}>{p.linhasGravadas} linha(s) já gravada(s) no banco</span>
                  </>
                ) : null}
                {p.checklistAtiva ? (
                  <>
                    {' · '}
                    <span style={{ opacity: 0.85 }}>{formatPresencaRelativo(p.atualizado_em)}</span>
                    {' (checklist)'}
                  </>
                ) : p.ultimaGravacao ? (
                  <>
                    {' · '}
                    <span style={{ opacity: 0.85 }}>última gravação {formatPresencaRelativo(p.ultimaGravacao)}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                value={checklistListMode}
                onChange={(e) => setChecklistListMode(e.target.value as ChecklistListMode)}
                style={inputStyle}
                disabled={!!offlineSession && offlineSession.status === 'aberta'}
              >
                <option value="todos">Todos os Produtos (cadastro)</option>
                {!inventario ? (
                  <option value="armazem">Armazém (dividida em grupos 1ª–4ª contagem)</option>
                ) : null}
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
            {!inventario ? (
              <button
                type="button"
                style={{ ...buttonStyle, background: '#7a2', opacity: finalizing ? 0.55 : 1 }}
                disabled={finalizing || checklistLoading}
                onClick={() => handleIniciarContagemDiaDoZero()}
                title="Abre uma nova checklist em branco para contar novamente no mesmo dia"
              >
                <span className="app-nav-icon app-nav-icon--pulse" aria-hidden>
                  ♻️
                </span>
                Iniciar contagem do dia do zero
              </button>
            ) : null}
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
        {checklistEdicaoBloqueada ? (
          <div style={{ color: '#b00020', marginTop: 8, fontSize: 13, textAlign: 'left' }}>{checklistEdicaoBloqueadaMsg}</div>
        ) : null}
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
              ref={checklistSectionRef}
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
                  <button
                    type="button"
                    onClick={() => setChecklistColsPanelOpen((v) => !v)}
                    style={{ ...buttonStyle, background: '#444', fontSize: 12, padding: '4px 10px' }}
                  >
                    {checklistColsPanelOpen ? 'Ocultar opções' : 'Mostrar opções'}
                  </button>
                  {checklistColsPanelOpen ? (
                    <>
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
                    </>
                  ) : null}
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
                    {checklistPaginationControls}
                    <div
                      data-checklist-nav-root
                      style={{ marginTop: 6, display: 'grid', gap: 6 }}
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
                      const pend =
                        inventario && offlineSession?.listMode === 'planilha'
                          ? String(quantidadePlanilhaInventarioEfetiva(it, inventarioNumeroContagemRodada)).trim() ===
                            ''
                          : String(it.quantidade_contada ?? '').trim() === ''
                      const isEditing = checklistEditingKey === it.key && checklistEditDraft
                      const datasOrdemInvalida = isVencimentoAntesFabricacao(it.data_fabricacao, it.data_validade)
                      const itemArmazemContagem = inventario ? getArmazemContagemForItem(it) : null
                      const itemRua = inventario ? getInventarioRuaArmazem(itemArmazemContagem) : null
                      const itemPn = inventario ? inventarioArmazemPosNivel(armazemItemsSorted, it) : null

                      return (
                        <div
                          key={it.key}
                          style={{
                            border: datasOrdemInvalida ? '1px solid #c62828' : '1px solid var(--border, #ccc)',
                            borderRadius: 8,
                            padding: 10,
                            minWidth: 0,
                            maxWidth: '100%',
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
                                    {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
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
                              <div style={{ fontSize: 10, lineHeight: 1.15, color: 'var(--text, #666)', marginBottom: 2 }}>
                                {!inventario &&
                                String(it.contagem_banco_ultimo_conferente_nome ?? '').trim() !== '' ? (
                                  <>
                                    <div>
                                      Última gravação (hoje):{' '}
                                      <strong style={{ fontWeight: 600 }}>
                                        {String(it.contagem_banco_ultimo_conferente_nome ?? '').trim()}
                                      </strong>
                                    </div>
                                    <div style={{ fontSize: 9, marginTop: 2, opacity: 0.9 }}>
                                      Sua sessão: {String(conferenteNomeSelecionado || '').trim() || '—'}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    Conferente:{' '}
                                    <strong style={{ fontWeight: 600 }}>
                                      {String(conferenteNomeSelecionado || '').trim() || '—'}
                                    </strong>
                                  </>
                                )}
                              </div>
                              <div style={{ fontSize: 10, lineHeight: 1.15, color: 'var(--text, #666)', marginBottom: 1 }}>
                                Status: <strong style={{ color: pend ? '#a60' : '#0a0' }}>{pend ? 'Pendente' : 'Contado'}</strong>
                              </div>
                              {inventario ? (
                                <div style={{ fontSize: 10, lineHeight: 1.15, color: 'var(--text, #666)', marginBottom: 1 }}>
                                  RUA: <strong style={{ fontWeight: 700 }}>{itemRua ?? '—'}</strong> · POS:{' '}
                                  <strong style={{ fontWeight: 700 }}>{itemPn?.pos ?? '—'}</strong> · NÍVEL:{' '}
                                  <strong style={{ fontWeight: 700 }}>{itemPn?.nivel ?? '—'}</strong>
                                </div>
                              ) : null}
                              <div style={{ fontSize: 11, lineHeight: 1.1, fontWeight: 800, fontFamily: 'monospace' }}>
                                {String(it.codigo_interno || '').trim() || '—'}
                                {it.inventario_repeticao ? (
                                  <span style={{ marginLeft: 6, fontSize: 10, color: '#0a7', fontWeight: 700 }}>
                                    ({it.inventario_repeticao}ª contagem)
                                  </span>
                                ) : null}
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.4,
                                  whiteSpace: 'normal',
                                  color: 'var(--text, #111)',
                                  marginTop: 0,
                                  wordBreak: 'break-word',
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {String(it.descricao || '').trim() || 'Descrição não informada'}
                              </div>
                              {inventario || showChecklistColumn('ean') || showChecklistColumn('dun') ? (
                                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text, #666)', display: 'grid', gap: 2 }}>
                                  {inventario || showChecklistColumn('ean') ? <div>EAN: {it.ean ?? '—'}</div> : null}
                                  {inventario || showChecklistColumn('dun') ? <div>DUN: {it.dun ?? '—'}</div> : null}
                                </div>
                              ) : null}
                              {inventario || showChecklistColumn('foto') ? (
                                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text, #666)' }}>
                                  Foto: {hasPhoto ? 'Com foto' : 'Sem foto'}
                                </div>
                              ) : null}

                              <div
                                style={{
                                  marginTop: 4,
                                  display: 'grid',
                                  gap: 4,
                                  gridTemplateColumns:
                                    inventario || showChecklistColumn('unidade')
                                      ? 'minmax(0, 1.2fr) minmax(0, 0.8fr)'
                                      : '1fr',
                                }}
                              >
                                <label style={{ ...labelStyle, gap: 2 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', lineHeight: 1.1 }}>
                                    <span>Quantidade</span>
                                    {checklistSavedFlashKey === it.key ? (
                                      <span style={{ fontSize: 10, color: '#0a0', fontWeight: 700 }}>Salvo</span>
                                    ) : null}
                                  </div>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={
                                      inventario && offlineSession?.listMode === 'planilha'
                                        ? quantidadePlanilhaInventarioEfetiva(it, inventarioNumeroContagemRodada)
                                        : it.quantidade_contada
                                    }
                                    onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                    {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                                    style={{ ...inputStyle, padding: '4px 6px', fontSize: 10 }}
                                    placeholder="—"
                                  />
                                </label>
                                {inventario || showChecklistColumn('unidade') ? (
                                  <label style={{ ...labelStyle, gap: 2 }}>
                                    <span>Unidade</span>
                                    <input
                                      type="text"
                                      value={it.unidade_medida ?? ''}
                                      onChange={(e) =>
                                        updateOfflineItemFields(it.key, {
                                          unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                                        })
                                      }
                                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 10 }}
                                      placeholder="—"
                                    />
                                  </label>
                                ) : null}
                              </div>

                              {inventario ||
                              showChecklistColumn('data_fabricacao') ||
                              showChecklistColumn('data_validade') ||
                              showChecklistColumn('lote') ||
                              showChecklistColumn('up') ||
                              showChecklistColumn('observacao') ? (
                                <div
                                  style={{
                                    marginTop: 6,
                                    display: 'grid',
                                    gap: 6,
                                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                  }}
                                >
                                  {inventario || showChecklistColumn('data_fabricacao') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Data de fabricação</span>
                                      <input
                                        type="date"
                                        value={it.data_fabricacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })}
                                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                                      />
                                    </label>
                                  ) : null}
                                  {inventario || showChecklistColumn('data_validade') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Data de validade</span>
                                      <input
                                        type="date"
                                        value={it.data_validade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { data_validade: e.target.value })}
                                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                                      />
                                    </label>
                                  ) : null}
                                  {inventario || showChecklistColumn('lote') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>Lote</span>
                                      <input
                                        type="text"
                                        value={it.lote ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                  {inventario || showChecklistColumn('up') ? (
                                    <label style={{ ...labelStyle, gap: 4 }}>
                                      <span>UP</span>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={it.up_quantidade ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { up_quantidade: e.target.value })}
                                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                  {inventario || showChecklistColumn('observacao') ? (
                                    <label style={{ ...labelStyle, gap: 4, gridColumn: '1 / -1' }}>
                                      <span>Observação</span>
                                      <input
                                        type="text"
                                        value={it.observacao ?? ''}
                                        onChange={(e) => updateOfflineItemFields(it.key, { observacao: e.target.value })}
                                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                                        placeholder="—"
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              ) : null}

                              <div style={{ marginTop: 6, display: 'grid', gap: 6, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 11, padding: '6px 6px' }}
                                  onClick={() => openChecklistEdit(it)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#666', fontSize: 11, padding: '6px 6px' }}
                                  onClick={() => handleLimparQuantidadeOffline(it.key)}
                                >
                                  Limpar
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...buttonStyle,
                                    background: hasPhoto ? '#0b5' : '#444',
                                    fontSize: 11,
                                    padding: '6px 6px',
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
                                    fontSize: 11,
                                    padding: '6px 8px',
                                    width: '100%',
                                    marginTop: 6,
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
                    {checklistPaginationControls}
                    <InventarioPlanilhaTabela
                      items={itemsPlanilhaTabelaPagina}
                      armazemItemsSorted={armazemItemsSorted}
                      armazemContagem={armazemGrupoAtual?.contagem ?? null}
                      planilhaQtdContagemHeader={planilhaQtdContagemHeader}
                      inventarioNumeroContagemRodada={inventarioNumeroContagemRodada}
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
                  <>
                  {checklistPaginationControls}
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
                          {showChecklistColumn('data_validade') ? <th style={thStyle}>Data de validade</th> : null}
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
                                      style={{ ...tdStyle, color: 'var(--text-muted, #888)', maxWidth: 180 }}
                                      title="Última gravação no banco hoje (contagem diária) ou conferente da sessão"
                                    >
                                      {!inventario &&
                                      String(it.contagem_banco_ultimo_conferente_nome ?? '').trim() !== '' ? (
                                        <div>
                                          <div>{String(it.contagem_banco_ultimo_conferente_nome ?? '').trim()}</div>
                                          <div style={{ fontSize: 10, opacity: 0.85 }}>
                                            sessão: {conferenteNomeSelecionado || '—'}
                                          </div>
                                        </div>
                                      ) : (
                                        conferenteNomeSelecionado
                                      )}
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
                                        {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
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
                                        aria-label={`Data de validade ${it.codigo_interno}`}
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
                                      style={{ ...tdStyle, color: 'var(--text-muted, #888)', maxWidth: 180 }}
                                      title="Última gravação no banco hoje (contagem diária) ou conferente da sessão"
                                    >
                                      {!inventario &&
                                      String(it.contagem_banco_ultimo_conferente_nome ?? '').trim() !== '' ? (
                                        <div>
                                          <div>{String(it.contagem_banco_ultimo_conferente_nome ?? '').trim()}</div>
                                          <div style={{ fontSize: 10, opacity: 0.85 }}>
                                            sessão: {conferenteNomeSelecionado || '—'}
                                          </div>
                                        </div>
                                      ) : (
                                        conferenteNomeSelecionado
                                      )}
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
                                          {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
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
                                        aria-label={`Data de validade ${it.codigo_interno}`}
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
                  </>
                )}
                {checklistPaginationControls}
              </>
            ) : null}
          </>
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text, #666)' }}>
            Nenhuma sessão aberta. Acima, selecione o conferente e a data; depois clique em <strong>Carregar lista de produtos</strong>.
          </div>
        )}

        {bloqueioContagemDiariaModalOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bloqueio-contagem-diaria-modal-title"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.55)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
              zIndex: 10001,
            }}
          >
            <div
              style={{
                width: 'min(440px, 100%)',
                background: '#1e1e1e',
                color: '#eee',
                border: '1px solid #444',
                borderRadius: 12,
                padding: 16,
                boxShadow: '0 12px 36px rgba(0,0,0,.45)',
              }}
            >
              <h3 id="bloqueio-contagem-diaria-modal-title" style={{ margin: '0 0 10px', fontSize: 16 }}>
                Contagem diária
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.45, color: '#ddd' }}>
                {checklistEdicaoBloqueadaMsg}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: 'linear-gradient(180deg, #4f8eff 0%, #2f6fdf 100%)',
                    border: '1px solid #7fb0ff',
                    color: '#f4f9ff',
                    fontWeight: 600,
                  }}
                  onClick={handleBloqueioModalFazerAlteracao}
                >
                  Fazer alteração da quantidade contada do dia
                </button>
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: 'linear-gradient(180deg, #43a047 0%, #2e7d32 100%)',
                    border: '1px solid #81c784',
                    color: '#fff',
                    fontWeight: 600,
                  }}
                  onClick={handleBloqueioModalIniciarZero}
                >
                  Iniciar contagem do zero
                </button>
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: '#444',
                    border: '1px solid #666',
                    color: '#eee',
                  }}
                  onClick={handleBloqueioModalFechar}
                >
                  Fechar o aviso
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {confirmFinalizeMissingOpen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.28)',
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
                background: '#fff',
                color: '#111',
                border: '1px solid #d0d0d0',
                borderRadius: 12,
                padding: 16,
                boxShadow: '0 12px 36px rgba(0,0,0,.24)',
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
                {inventario ? (
                  <>
                    {' '}
                    Esses <strong>não serão gravados</strong> no Supabase até você preencher a quantidade (nada é
                    convertido para 0). Lote, observação, UP, datas, EAN/DUN e foto podem ficar em branco nos itens que
                    tiverem quantidade informada.
                  </>
                ) : (
                  <>
                    {' '}
                    Se você escolher <strong>Finalizar em branco</strong>, esses itens ficam sem quantidade e{' '}
                    <strong>não serão gravados</strong> nesta finalização.
                  </>
                )}
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
                  {inventario ? 'Finalizar e gravar só os preenchidos' : 'Finalizar em branco'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {savedCountModal ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-count-modal-title"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.28)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
              zIndex: 10000,
            }}
            onClick={() => setSavedCountModal(null)}
          >
            <div
              style={{
                width: 'min(440px, 100%)',
                background: '#fff',
                color: '#111',
                border: '1px solid #d0d0d0',
                borderRadius: 14,
                padding: 22,
                boxShadow: '0 12px 40px rgba(0,0,0,.26)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'rgba(46, 160, 67, 0.2)',
                  color: '#6f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  marginBottom: 12,
                }}
                aria-hidden
              >
                ✓
              </div>
              <h3 id="saved-count-modal-title" style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700 }}>
                Contagem salva
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 15, color: '#444', lineHeight: 1.5 }}>
                O dia <strong style={{ color: '#111' }}>{formatDateBRFromYmd(savedCountModal.ymd)}</strong>{' '}
                ({savedCountModal.ymd}) foi gravado em <code style={{ fontSize: 12 }}>contagens_estoque</code>.
              </p>
              <div
                style={{
                  background: '#f5f7f7',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 14,
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                <div>
                  <strong style={{ color: '#9f9' }}>{savedCountModal.registros}</strong> novo(s) registro(s) nesta
                  finalização (somam com outras finalizações do mesmo dia).
                </div>
                {savedCountModal.conferenteNome ? (
                  <div style={{ marginTop: 8 }}>
                    Conferente: <strong>{savedCountModal.conferenteNome}</strong>
                  </div>
                ) : null}
                {savedCountModal.pendAutoZero != null && savedCountModal.pendAutoZero > 0 ? (
                  <div style={{ marginTop: 8, fontSize: 13, color: '#555' }}>
                    {savedCountModal.pendAutoZero} item(ns) sem quantidade foram preenchidos com <strong>0</strong> para
                    permitir a gravação.
                  </div>
                ) : null}
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#555', lineHeight: 1.5 }}>
                Os dados ficam apenas no Supabase. Use <strong>Atualizar prévia</strong> para conferir no painel.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#444', color: '#fff' }}
                  onClick={() => {
                    setSavedCountModal(null)
                    window.setTimeout(() => {
                      previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 0)
                  }}
                >
                  Ver prévia no banco
                </button>
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#2a7', color: '#fff' }}
                  onClick={() => setSavedCountModal(null)}
                >
                  Entendi
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
              className="contagem-barcode-icon-btn"
              style={{ ...buttonStyle, background: 'linear-gradient(145deg, #334155 0%, #1e293b 100%)', fontSize: 13, whiteSpace: 'nowrap', touchAction: 'manipulation', boxShadow: '0 2px 8px rgba(56, 189, 248, 0.15)' }}
              onClick={() => {
                setBarcodeFotoHint('')
                setBarcodeCameraOpen(true)
              }}
              disabled={productOptionsLoading}
              title="Ler código de barras pela câmera (quando suportado)"
              aria-label="Ler código de barras (câmera/scan)"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className="contagem-icon-scan"
                >
                  <defs>
                    <linearGradient id="contagemScanStroke" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#38bdf8" />
                      <stop offset="1" stopColor="#818cf8" />
                    </linearGradient>
                    <linearGradient id="contagemLaser" x1="6" y1="10" x2="18" y2="10" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#22d3ee" stopOpacity="0.25" />
                      <stop offset="0.5" stopColor="#a5f3fc" />
                      <stop offset="1" stopColor="#22d3ee" stopOpacity="0.25" />
                    </linearGradient>
                  </defs>
                  <rect
                    className="contagem-icon-scan__frame"
                    x="3.5"
                    y="4"
                    width="17"
                    height="16"
                    rx="2.5"
                    stroke="url(#contagemScanStroke)"
                    strokeWidth="1.6"
                    fill="rgba(15, 23, 42, 0.35)"
                  />
                  <g opacity="0.55">
                    <rect x="7" y="14" width="1.2" height="4" rx="0.4" fill="#94a3b8" />
                    <rect x="9" y="13" width="1.2" height="5" rx="0.4" fill="#94a3b8" />
                    <rect x="11" y="14" width="1.2" height="4" rx="0.4" fill="#94a3b8" />
                    <rect x="13" y="12.5" width="1.2" height="5.5" rx="0.4" fill="#94a3b8" />
                    <rect x="15" y="14" width="1.2" height="4" rx="0.4" fill="#94a3b8" />
                  </g>
                  <g className="contagem-icon-scan__laser">
                    <rect x="6" y="9.25" width="12" height="2" rx="1" fill="url(#contagemLaser)" />
                  </g>
                  <circle className="contagem-icon-scan__sparkle" cx="19" cy="6" r="1.2" fill="#fbbf24" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              className="contagem-barcode-icon-btn"
              style={{
                ...buttonStyle,
                background: 'linear-gradient(145deg, #4c1d95 0%, #312e81 50%, #1e1b4b 100%)',
                fontSize: 13,
                whiteSpace: 'nowrap',
                touchAction: 'manipulation',
                boxShadow: '0 2px 10px rgba(167, 139, 250, 0.25)',
              }}
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
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className="contagem-icon-camera"
                >
                  <defs>
                    <linearGradient id="contagemCamBody" x1="5" y1="6" x2="19" y2="18" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#e879f9" />
                      <stop offset="0.5" stopColor="#a78bfa" />
                      <stop offset="1" stopColor="#6366f1" />
                    </linearGradient>
                    <linearGradient id="contagemCamLens" x1="9" y1="9" x2="15" y2="15" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#1e1b4b" />
                      <stop offset="1" stopColor="#312e81" />
                    </linearGradient>
                  </defs>
                  <path
                    className="contagem-icon-camera__body"
                    d="M9 7.5h-.75C7.5 7.5 6.5 8.5 6.5 9.75v6.5c0 1.25 1 2.25 2.25 2.25h7.5c1.25 0 2.25-1 2.25-2.25v-6.5c0-1.25-1-2.25-2.25-2.25H15l-1.1-1.65c-.2-.3-.55-.5-.9-.5h-1.95c-.35 0-.7.2-.9.5L9 7.5z"
                    fill="url(#contagemCamBody)"
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth="0.6"
                  />
                  <circle cx="12" cy="12.5" r="3.2" fill="url(#contagemCamLens)" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
                  <circle
                    className="contagem-icon-camera__lens-ring"
                    cx="12"
                    cy="12.5"
                    r="4.8"
                    stroke="#fbbf24"
                    strokeWidth="0.9"
                    fill="none"
                    opacity="0.9"
                  />
                  <path
                    className="contagem-icon-camera__flash"
                    d="M17.5 6.5l.6 1.2 1.3.2-1 .9.25 1.35-1.15-.65-1.15.65.25-1.35-1-.9 1.3-.2.6-1.2z"
                    fill="#fef08a"
                  />
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
              Data de validade
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
              finalizar, a prévia é atualizada automaticamente no <strong>dia atual</strong>; use{' '}
              <strong>Atualizar prévia</strong> para buscar de novo depois de editar no banco.
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ ...labelStyle, marginBottom: 0, fontSize: 13 }}>
            Dia no banco
            <input
              type="date"
              value={previewConsultaDiaYmd}
              onChange={() => {
                /* Dia da prévia fixo no dia atual. */
              }}
              disabled
              style={{ ...inputStyle, marginTop: 4, maxWidth: 200 }}
              title="Filtra contagens_estoque sempre pela data atual (data_contagem de hoje)"
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
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--text-muted, #aaa)',
              maxWidth: 440,
              flex: '1 1 200px',
            }}
          >
            <strong style={{ color: 'var(--text, #ffd95c)' }}>Excluir dia:</strong> remove do banco apenas as linhas de{' '}
            <code style={{ fontSize: 11 }}>contagens_estoque</code> com <code style={{ fontSize: 11 }}>data_contagem</code>{' '}
            igual à data escolhida em <strong>Dia no banco</strong> (respeitando o modo atual — inventário ou contagem
            diária). <em>Outros dias não são apagados.</em>
          </span>
          <button
            type="button"
            onClick={() => void handlePreviewDeleteAll()}
            disabled={
              previewLoading ||
              previewRowActionLoading ||
              !/^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)
            }
            title={
              !/^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)
                ? 'Selecione uma data em “Dia no banco”'
                : 'Excluir do banco somente registros (contagens_estoque) com data_contagem igual ao dia selecionado no campo acima — não apaga outros dias.'
            }
            style={{
              ...buttonStyle,
              background: '#8b1538',
              borderColor: '#6d102b',
              opacity:
                previewLoading ||
                previewRowActionLoading ||
                !/^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)
                  ? 0.5
                  : 1,
              cursor:
                previewLoading ||
                previewRowActionLoading ||
                !/^\d{4}-\d{2}-\d{2}$/.test(previewConsultaDiaYmd)
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            Excluir dia no banco
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
  borderBottom: '1px solid #3a3b45',
  textAlign: 'left',
  padding: '6px 8px',
  fontWeight: 700,
  fontSize: 12,
  background: '#1d1e24',
  color: '#fff',
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

