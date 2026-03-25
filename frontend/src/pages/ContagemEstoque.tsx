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
  type ChecklistListMode,
  saveOfflineSession,
  stableItemKey,
} from '../lib/offlineContagemSession'

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
  data_hora_contagem: string
  codigo_interno: string
  descricao: string
  quantidade_up: number
  lote: string | null
  observacao: string | null
  foto_base64?: string | null
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

/** Alguns códigos da tabela não devem entrar na checklist do app. */
const CHECKLIST_EXCLUIR_CODIGOS = new Set<string>([
  // Você pediu para retirar este produto.
  '01.06.0027',
])

/**
 * Ordem do armazém dividida em 4 rotas/contagens.
 * A lista abaixo define SOMENTE a divisão (grupo) e a ordem relativa de exibição.
 * A quantidade no app começa vazia (o usuário preenche).
 */
const ARMAZEM_CONTAGEM_CODES = {
  1: [
    '01.01.0001',
    '01.01.0002',
    '01.02.0001',
    '01.02.0003',
    '01.02.0005',
    '01.02.0007',
    '01.04.0008',
    '01.04.0009',
    '01.04.0019',
    '01.04.0020',
    '01.04.0021',
    '01.04.0022',
    '01.10.0005',
    '01.10.0003',
    '01.10.0004',
    '01.10.0006',
    '01.02.0009',
    '01.02.0011',
    '01.04.0005',
    '01.04.0006',
    '01.03.0019',
    '01.04.0001',
    '01.04.0002',
    '02.04.0001',
    '02.01.0005',
    '02.01.0004',
    '01.10.0013',
    '01.10.0014',
    '01.04.0057',
    '01.04.0066',
  ],
  2: [
    '01.04.0024',
    '01.09.0007',
    '01.09.0008',
    '01.09.0009',
    '01.09.0010',
    '01.09.0011',
    '01.09.0012',
    '01.06.0001',
    '01.06.0002',
    '01.06.0059',
    '02.03.0001',
    '02.02.0028',
    '02.03.0038',
    '02.03.0039',
    '02.03.0042',
    '02.03.0043',
    '02.06.0001',
    '02.06.0002',
    '02.02.0029',
    '02.02.0045',
    '02.06.0003',
    '02.03.0041',
    '02.03.0013',
    '02.01.0006',
    '02.02.0037',
    '02.03.0054',
    '02.02.0038',
  ],
  3: [
    '02.01.0007',
    '02.02.0034',
    '02.02.0033',
    '02.02.0031',
    '02.02.0036',
    '02.02.0035',
    '02.02.0032',
    '01.04.0014',
    '01.04.0025',
    '01.04.0026',
    '01.04.0054',
    '01.04.0055',
    '02.04.0002',
    '02.04.0003',
    '02.04.0004',
    '02.04.0007',
    '02.04.0008',
    '02.04.0012',
    '02.04.0013',
    '02.04.0014',
    '02.04.0018',
    '02.04.0019',
    '02.04.0021',
    '02.04.0023',
    '01.06.0058',
    '01.06.0022',
    '01.06.0024',
    '01.06.0030',
    '02.04.0005',
  ],
  4: [
    '02.03.1003',
    '02.03.1004',
    '02.03.1005',
    '02.03.1006',
    '02.03.1007',
    '02.03.1008',
    '02.03.1009',
    '02.03.1010',
    '02.03.1011',
    '02.03.1012',
    '02.03.1013',
    '02.03.1014',
    '02.03.1015',
    '02.03.1016',
    '02.03.1017',
    '01.04.0058',
    '01.04.0062',
    '01.04.0059',
    '01.04.0060',
    '01.04.0061',
  ],
} as const satisfies Record<number, string[]>

const ARMAZEM_POS_BY_CODIGO = (() => {
  const m = new Map<string, { contagem: number; pos: number }>()
  for (const contagemStr of Object.keys(ARMAZEM_CONTAGEM_CODES)) {
    const contagem = Number(contagemStr)
    const codes = (ARMAZEM_CONTAGEM_CODES as any)[contagemStr] as string[]
    codes.forEach((codigo, pos) => {
      m.set(codigo, { contagem, pos })
    })
  }
  return m
})()

function getArmazemContagem(codigo: string): number | null {
  return ARMAZEM_POS_BY_CODIGO.get(codigo)?.contagem ?? null
}

function getArmazemPos(codigo: string): number {
  return ARMAZEM_POS_BY_CODIGO.get(codigo)?.pos ?? Number.MAX_SAFE_INTEGER
}

function formatContagemLabel(contagem: number) {
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

function mapRowToProductOption(row: Record<string, any>): ProductOption | null {
  const codigo = pickFirstCell(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto'])
  if (!codigo) return null
  const descricao =
    pickFirstCell(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto']) || 'Produto sem descrição'
  return {
    id: String(row.id ?? row.row_index ?? row.dataset_id ?? codigo),
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

function isUuid(value: string | null | undefined) {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function toISODateLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export default function ContagemEstoque() {
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
  const [checklistEditingKey, setChecklistEditingKey] = useState<string | null>(null)
  const [checklistEditDraft, setChecklistEditDraft] = useState<{
    codigo_interno: string
    descricao: string
    quantidade_contada: string
  } | null>(null)
  const [armazemMissingCodes, setArmazemMissingCodes] = useState<string[]>([])
  const [confirmFinalizeMissingOpen, setConfirmFinalizeMissingOpen] = useState(false)
  const [missingItemsForFinalize, setMissingItemsForFinalize] = useState<OfflineChecklistItem[]>([])

  useEffect(() => {
    const id = setInterval(() => setClockTick((v) => v + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    try {
      if (sessionStorage.getItem('contagem-checklist-collapsed') === '1') {
        setChecklistListCollapsed(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Restaura sessão offline aberta (persistência no navegador).
  useEffect(() => {
    const s = loadOfflineSession()
    if (s && s.status === 'aberta') {
      // Painel começa "livre": descartamos a sessão em andamento e voltamos ao início.
      clearOfflineSession()
      setOfflineSession(null)
      setContagemDiaYmd(toISODateLocal(new Date()))
      setChecklistListMode('todos')
      setStartFreshNotice('Sessão anterior descartada ao abrir a tela. Comece do zero.')
    }
  }, [])

  // Persiste alterações da sessão aberta.
  useEffect(() => {
    if (!offlineSession || offlineSession.status !== 'aberta') return
    saveOfflineSession(offlineSession)
  }, [offlineSession])

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

  const dataHoraContagem = useMemo(() => {
    const elapsed = Date.now() - clockRealStartMs
    return toDatetimeLocalValue(new Date(clockBaseMs + elapsed))
  }, [clockBaseMs, clockRealStartMs, clockTick])

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

  useEffect(() => {
    ;(async () => {
      setProductOptionsLoading(true)
      let loaded: ProductOption[] = []
      let lastLoadError: string | null = null

      const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').limit(15000)

      if (error) {
        lastLoadError = error.message ?? 'erro ao carregar produtos'
      } else if (data?.length) {
        loaded = (data as Array<Record<string, any>>)
          .map((row) => mapRowToProductOption(row))
          .filter(Boolean) as ProductOption[]
        loaded.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
      }

      // remove duplicados por código
      const byCode = new Map<string, ProductOption>()
      for (const p of loaded) {
        if (!byCode.has(p.codigo)) byCode.set(p.codigo, p)
      }
      const normalized = Array.from(byCode.values())
      setProductOptions(normalized)
      if (!normalized.length && lastLoadError) {
        setProdutoError(`Erro ao carregar produtos da base: ${lastLoadError}`)
      }
      setProductOptionsLoading(false)
    })()
  }, [])

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) map.set(p.codigo, p)
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
    const list = q
      ? productOptions.filter((p) => p.codigo.toLowerCase().includes(q))
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
    const p = productByCode.get(codigo)
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
      setBarcodeLeitura(codigo)
      setBarcodeTipoLeitura(null)
    }
    return true
  }

  const applyProductByBarcode = useCallback(
    (barcode: string) => {
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
      const pCode = productByCode.get(code)
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
    },
    [productByDun, productByEan, productByCode],
  )

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
  }, [barcodeCameraOpen, applyProductByBarcode])

  function openPhotoModalForCodigo(codigo: string) {
    const code = codigo.trim()
    if (!code) return
    setPhotoTargetCodigo(code)
    setPhotoUiError('')
    setPhotoSaving(false)
    const item = offlineSession?.items.find((it) => it.codigo_interno.trim() === code)
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
        return {
          ...prev,
          items: prev.items.map((it) =>
            it.codigo_interno.trim() === codigo ? { ...it, foto_base64: photoPreviewBase64 } : it,
          ),
        }
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
  }, [codigoInterno, productByCode])

  const canSubmit = useMemo(() => {
    const datasOk = (() => {
      if (!dataFabricacao || !dataVencimento) return true
      // Formato do input é YYYY-MM-DD, então comparação lexicográfica funciona como data.
      return dataVencimento >= dataFabricacao
    })()

    return (
      Boolean(conferenteId) &&
      codigoInterno.trim().length > 0 &&
      (descricaoInput.trim().length > 0 || Boolean(produto?.descricao)) &&
      datasOk &&
      !saving
    )
  }, [conferenteId, codigoInterno, descricaoInput, produto?.descricao, saving, dataFabricacao, dataVencimento])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaveSuccess('')

    if (!conferenteId) {
      setSaveError('Selecione um conferente.')
      return
    }
    if (!codigoInterno.trim()) {
      setSaveError('Informe o código do produto.')
      return
    }
    const descricaoFinal = (descricaoInput.trim() || produto?.descricao || '').trim()
    if (!descricaoFinal) {
      setSaveError('Informe a descrição do produto.')
      return
    }

    const qtd = quantidadeContada.trim() === '' ? 0 : Number(quantidadeContada.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setSaveError('Quantidade contada inválida.')
      return
    }

    if (dataFabricacao && dataVencimento && dataVencimento < dataFabricacao) {
      setSaveError('Data de vencimento não pode ser menor que a data de fabricação.')
      return
    }

    if (!offlineSession || offlineSession.status !== 'aberta') {
      setSaveError('Carregue a lista de produtos (sessão diária) antes de "Salvar na lista".')
      return
    }

    setSaving(true)
    try {
      const code = codigoInterno.trim()
      const descNorm = descricaoFinal.trim().toLowerCase()
      const idx = offlineSession.items.findIndex(
        (it) => it.codigo_interno.trim() === code && it.descricao.trim().toLowerCase() === descNorm,
      )
      if (idx < 0) {
        setSaveError(
          'Produto não está na lista do dia. Use código e descrição iguais aos cadastrados em Todos os Produtos.',
        )
        setSaving(false)
        return
      }

      const qtdStr = String(qtd)
      setOfflineSession((prev) => {
        if (!prev || prev.status !== 'aberta') return prev
        const nextItems = prev.items.map((it, i) => (i === idx ? { ...it, quantidade_contada: qtdStr } : it))
        return { ...prev, items: nextItems }
      })

      setSaveSuccess(
        `Quantidade ${qtd} gravada na lista local (offline). Clique em "Finalizar contagem diária" para salvar no banco.`,
      )
      setSaveError('')
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
    const pad = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const dayKey =
      dayOverride && /^\d{4}-\d{2}-\d{2}$/.test(dayOverride)
        ? dayOverride
        : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    const { data, error } = await supabase
      .from('contagens_estoque')
      .select('id,data_hora_contagem,codigo_interno,descricao,quantidade_up,lote,observacao,foto_base64')
      .eq('data_contagem', dayKey)
      .order('data_hora_contagem', { ascending: false })
      .limit(2000)

    if (error) {
      setSaveError(`Erro ao carregar prévia: ${error.message}`)
    } else {
      const rawRows = (data ?? []).map((r: any) => ({
        id: String(r.id),
        source_ids: [String(r.id)],
        data_hora_contagem: String(r.data_hora_contagem ?? ''),
        codigo_interno: String(r.codigo_interno ?? ''),
        descricao: String(r.descricao ?? ''),
        quantidade_up: Number(r.quantidade_up ?? 0),
        lote: r.lote ?? null,
        observacao: r.observacao ?? null,
        foto_base64: r.foto_base64 ?? null,
      })) as ContagemPreviewRow[]

      // Prévia agrupada: uma linha por dia + código + descrição, somando a quantidade.
      const grouped = new Map<string, ContagemPreviewRow>()
      for (const row of rawRows) {
        // Como filtramos por data_contagem (dia civil), a chave do dia deve usar dayKey diretamente.
        const day = dayKey
        const key = `${day}|${row.codigo_interno.trim().toLowerCase()}|${row.descricao.trim().toLowerCase()}`
        const existing = grouped.get(key)
        if (!existing) {
          grouped.set(key, { ...row })
          continue
        }
        existing.quantidade_up += Number(row.quantidade_up ?? 0)
        existing.source_ids = existing.source_ids.concat(row.source_ids)
        if (!existing.foto_base64 && row.foto_base64) existing.foto_base64 = row.foto_base64
        if (!existing.lote && row.lote) existing.lote = row.lote
        if (!existing.observacao && row.observacao) existing.observacao = row.observacao
      }

      setPreviewRows(Array.from(grouped.values()))
    }
    setPreviewLoading(false)
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
      let itemsRaw = await fetchListaChecklistFromDb()

      if (checklistListMode === 'armazem') {
        const missing = itemsRaw.map((it) => it.codigo_interno).filter((codigo) => getArmazemContagem(codigo) === null)
        setArmazemMissingCodes(missing)
        if (missing.length > 0) {
          throw new Error(
            `Modo armazém não está completo: faltam ${missing.length} código(s) para mapear nas 1-4 contagens. ` +
              `Ex.: ${missing.slice(0, 10).join(', ')}. ` +
              `Para continuar (sem "OUTROS"), ajuste o mapeamento no app (ARMAZEM_CONTAGEM_CODES).`,
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

      const items: OfflineChecklistItem[] = itemsRaw.map((row, index) => ({
        key: stableItemKey(row.codigo_interno, row.descricao, index),
        codigo_interno: row.codigo_interno,
        descricao: row.descricao,
        quantidade_contada: '',
        foto_base64: '',
      }))
      const sess: OfflineSession = {
        sessionId: newSessionId(),
        data_contagem_ymd: contagemDiaYmd,
        conferente_id: conferenteId,
        status: 'aberta',
        listMode: checklistListMode,
        items,
        updatedAt: new Date().toISOString(),
      }
      setOfflineSession(sess)
      saveOfflineSession(sess)
      setSaveSuccess(`Lista carregada: ${items.length} itens. Preencha as quantidades e finalize quando terminar.`)
      setSaveError('')
    } catch (e: any) {
      setChecklistError(e?.message ? String(e.message) : 'Erro ao carregar lista.')
    } finally {
      setChecklistLoading(false)
    }
  }

  function handleDescartarSessaoLocal() {
    if (!offlineSession || offlineSession.status !== 'aberta') {
      clearOfflineSession()
      setOfflineSession(null)
      setChecklistListMode('todos')
      return
    }
    if (!confirm('Descartar a sessão local? As quantidades não finalizadas serão perdidas.')) return
    clearOfflineSession()
    setOfflineSession(null)
    setChecklistError('')
    setChecklistListMode('todos')
  }

  function updateOfflineItemQty(key: string, quantidade: string) {
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      return {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, quantidade_contada: quantidade } : it)),
      }
    })
  }

  function handleLimparQuantidadeOffline(key: string) {
    updateOfflineItemQty(key, '')
  }

  function updateOfflineItemFields(
    key: string,
    patch: Partial<Pick<OfflineChecklistItem, 'codigo_interno' | 'descricao' | 'quantidade_contada'>>,
  ) {
    setOfflineSession((prev) => {
      if (!prev || prev.status !== 'aberta') return prev
      return {
        ...prev,
        items: prev.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      }
    })
  }

  function handleToggleChecklistCollapse() {
    setChecklistListCollapsed((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem('contagem-checklist-collapsed', next ? '1' : '0')
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
    updateOfflineItemFields(checklistEditingKey, {
      codigo_interno: cod,
      descricao: desc,
      quantidade_contada: checklistEditDraft.quantidade_contada.trim(),
    })
    cancelChecklistEdit()
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

    let itemsSnapshot = offlineSession.items.map((i) => ({ ...i }))
    let pend = countPendingItems(itemsSnapshot)
    if (pend > 0) {
      const missing = itemsSnapshot.filter((i) => String(i.quantidade_contada ?? '').trim() === '')
      setMissingItemsForFinalize(missing)
      setConfirmFinalizeMissingOpen(true)
      return
    }

    await finalizeInternal({ sendZerosForMissing: false })
  }

  async function finalizeInternal({ sendZerosForMissing }: { sendZerosForMissing: boolean }) {
    if (!offlineSession || offlineSession.status !== 'aberta') return
    if (!conferenteId || offlineSession.conferente_id !== conferenteId) return

    setFinalizing(true)
    try {
      const ymd = offlineSession.data_contagem_ymd
      let itemsSnapshot = offlineSession.items.map((i) => ({ ...i }))

      if (sendZerosForMissing) {
        itemsSnapshot = itemsSnapshot.map((i) =>
          String(i.quantidade_contada ?? '').trim() === '' ? { ...i, quantidade_contada: '0' } : i,
        )
      }

      const dataHoraIso = toISOStringFromDatetimeLocal(dataHoraContagem)
      const rows: Record<string, unknown>[] = []
      for (const it of itemsSnapshot) {
        const q = Number(String(it.quantidade_contada).replace(',', '.'))
        if (!Number.isFinite(q) || q < 0) {
          setChecklistError(`Quantidade inválida para ${it.codigo_interno}.`)
          return
        }
        rows.push({
          data_hora_contagem: dataHoraIso,
          conferente_id: offlineSession.conferente_id,
          produto_id: null,
          codigo_interno: it.codigo_interno.trim(),
          descricao: it.descricao.trim(),
          unidade_medida: null,
          quantidade_up: q,
          foto_base64: it.foto_base64 ?? null,
          lote: null,
          observacao: null,
        })
      }

      setFinalizeProgress('Conectando ao banco...')
      const { error: delErr } = await supabase
        .from('contagens_estoque')
        .delete()
        .eq('data_contagem', ymd)
        .eq('conferente_id', offlineSession.conferente_id)

      if (delErr) {
        const startIso = `${ymd}T00:00:00`
        const endIso = `${ymd}T23:59:59`
        setFinalizeProgress('Limpando registros antigos (fallback)...')
        const { error: del2 } = await supabase
          .from('contagens_estoque')
          .delete()
          .eq('conferente_id', offlineSession.conferente_id)
          .gte('data_hora_contagem', startIso)
          .lte('data_hora_contagem', endIso)
        if (del2) throw del2
      }

      const CHUNK = 250
      for (let i = 0; i < rows.length; i += CHUNK) {
        setFinalizeProgress(`Salvando: ${Math.min(i + CHUNK, rows.length)}/${rows.length} registros...`)
        const chunk = rows.slice(i, i + CHUNK)
        const { error: insErr } = await supabase.from('contagens_estoque').insert(chunk)
        if (insErr) throw insErr
      }

      clearOfflineSession()
      setOfflineSession(null)
      setChecklistListMode('todos')
      setSaveSuccess(`Contagem do dia ${ymd} finalizada: ${rows.length} registro(s) gravados no banco.`)
      setFinalizeProgress('Concluído: registros salvos com sucesso.')
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
  const [previewRowError, setPreviewRowError] = useState('')
  const [previewFilterCodigo, setPreviewFilterCodigo] = useState('')
  const [previewFilterDescricao, setPreviewFilterDescricao] = useState('')
  const [previewFilterData, setPreviewFilterData] = useState('')
  const [previewFilterLote, setPreviewFilterLote] = useState('')
  const [previewFilterObs, setPreviewFilterObs] = useState('')

  async function handlePreviewDelete(id: string) {
    if (!confirm('Deseja realmente excluir esta contagem?')) return
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const row = previewRows.find((r) => r.id === id)
      const idsToDelete = row?.source_ids?.length ? row.source_ids : [id]
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
    const filteredRows = previewRows.filter((r) => {
      const codigoOk =
        !previewFilterCodigo.trim() || r.codigo_interno.toLowerCase().includes(previewFilterCodigo.trim().toLowerCase())
      const descricaoOk =
        !previewFilterDescricao.trim() ||
        r.descricao.toLowerCase().includes(previewFilterDescricao.trim().toLowerCase())
      const dataOk =
        !previewFilterData || dataContagemYmdFromIso(String(r.data_hora_contagem)) === previewFilterData
      const loteOk =
        !previewFilterLote.trim() || String(r.lote ?? '').toLowerCase().includes(previewFilterLote.trim().toLowerCase())
      const obsOk =
        !previewFilterObs.trim() || String(r.observacao ?? '').toLowerCase().includes(previewFilterObs.trim().toLowerCase())
      return codigoOk && descricaoOk && dataOk && loteOk && obsOk
    })

    return (
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        {previewRowError ? <div style={{ color: '#b00020', marginBottom: 8 }}>{previewRowError}</div> : null}
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            minWidth: isMobile ? 820 : 1100,
          }}
        >
          <thead>
            <tr>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Descrição</th>
              <th style={thStyle}>Data (dd/mm/aaaa)</th>
              <th style={thStyle}>UP</th>
              <th style={thStyle}>Lote</th>
              <th style={thStyle}>Observação</th>
              <th style={thStyle}>Foto</th>
              <th style={thStyle}>Ações</th>
            </tr>
            <tr>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                <input
                  value={previewFilterCodigo}
                  onChange={(e) => setPreviewFilterCodigo(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                <input
                  value={previewFilterDescricao}
                  onChange={(e) => setPreviewFilterDescricao(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                <input
                  type="date"
                  value={previewFilterData}
                  onChange={(e) => setPreviewFilterData(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                {/* Excel tem filtro por coluna; aqui fica em branco por ser campo numérico editado em célula */}
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                <input
                  value={previewFilterLote}
                  onChange={(e) => setPreviewFilterLote(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                <input
                  value={previewFilterObs}
                  onChange={(e) => setPreviewFilterObs(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }}>
                {/* Sem filtro por imagem */}
              </th>
              <th style={{ ...thStyle, fontWeight: 400, fontSize: 12, background: '#f3f4f6' }} />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              return (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.codigo_interno}</td>
                  <td style={tdStyle}>{r.descricao}</td>
                  <td style={tdStyle}>{formatDateBRFromIso(r.data_hora_contagem)}</td>
                  <td style={tdStyle}>
                    {editingPreviewId === r.id ? (
                      <input
                        type="number"
                        step="0.001"
                        value={editingPreviewQuantidade}
                        onChange={(e) => setEditingPreviewQuantidade(e.target.value)}
                        style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, width: 120 }}
                      />
                    ) : (
                      r.quantidade_up
                    )}
                  </td>
                  <td style={tdStyle}>{r.lote ?? ''}</td>
                  <td style={tdStyle}>{r.observacao ?? ''}</td>
                  <td style={tdStyle}>
                    {r.foto_base64 ? (
                      <img
                        src={`data:image/jpeg;base64,${r.foto_base64}`}
                        alt="Foto do produto"
                        style={{ maxWidth: 60, maxHeight: 45, objectFit: 'cover', borderRadius: 8 }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text, #888)', fontSize: 12 }}>Sem foto anexada</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const checklistPending = offlineSession?.status === 'aberta' ? countPendingItems(offlineSession.items) : 0
  const checklistCounted =
    offlineSession?.status === 'aberta' ? offlineSession.items.length - checklistPending : 0

  const filteredChecklistItems =
    offlineSession?.status === 'aberta'
      ? offlineSession.items.filter((it) => {
          const codOk =
            !checklistFilterCodigo.trim() ||
            it.codigo_interno.toLowerCase().includes(checklistFilterCodigo.trim().toLowerCase())
          const descOk =
            !checklistFilterDescricao.trim() ||
            it.descricao.toLowerCase().includes(checklistFilterDescricao.trim().toLowerCase())
          const pend = String(it.quantidade_contada ?? '').trim() === ''
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
    offlineSession?.status === 'aberta' && offlineSession.listMode === 'armazem'
      ? offlineSession.items.some((it) => getArmazemContagem(it.codigo_interno) === null)
      : false

  const checklistDisplayItems: ChecklistDisplayItem[] =
    offlineSession?.status === 'aberta' && offlineSession.listMode === 'armazem' && !armazemModoIncompleto
      ? (() => {
          const out: ChecklistDisplayItem[] = []
          let lastContagem: number | null = null
          let hdrSeq = 0
          for (const it of filteredChecklistItems) {
            const contagem = getArmazemContagem(it.codigo_interno)
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

  const carregarListaDisabled = checklistLoading || finalizing || !conferenteId

  return (
    <div style={{ padding: isMobile ? 10 : 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Contagem de Estoque</h2>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: '1px solid var(--border, #ccc)',
          borderRadius: 10,
          background: 'var(--panel-bg, rgba(0,0,0,.04))',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 18 }}>Contagem diária (offline → banco)</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text, #555)' }}>
          Carregue a lista a partir da tabela <strong>public.&quot;Todos os Produtos&quot;</strong> (codigo_interno + descricao), preencha as quantidades no app
          (salvo no navegador) e clique em <strong>Finalizar contagem diária</strong> para gravar em{' '}
          <strong>contagens_estoque</strong>.
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
            Data da contagem (dia civil)
            <input
              type="date"
              value={contagemDiaYmd}
              onChange={(e) => setContagemDiaYmd(e.target.value)}
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
                <option value="armazem">Armazém (dividida por contagem 1-4)</option>
              </select>
            </label>
            <button
              type="button"
              style={{
                ...buttonStyle,
                ...(carregarListaDisabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
              }}
              disabled={carregarListaDisabled}
              onClick={() => void handleCarregarListaPlanilha()}
            >
              {checklistLoading ? 'Carregando lista…' : 'Carregar lista de produtos'}
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#444' }}
              disabled={finalizing}
              onClick={() => handleDescartarSessaoLocal()}
            >
              Descartar sessão local
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, background: checklistPending > 0 ? '#555' : '#0b5' }}
              disabled={
                finalizing ||
                !offlineSession ||
                offlineSession.status !== 'aberta' ||
                offlineSession.items.length === 0
              }
              onClick={() => void handleFinalizarContagemDiaria()}
            >
              {finalizing ? 'Finalizando…' : 'Finalizar contagem diária'}
            </button>
          </div>
        </div>

        {finalizeProgress ? (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text, #555)' }}>{finalizeProgress}</div>
        ) : null}

        {checklistError ? <div style={{ color: '#b00020', marginTop: 10 }}>{checklistError}</div> : null}
        {startFreshNotice ? (
          <div style={{ color: '#0a0', marginTop: 8, fontSize: 13 }}>
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
                Progresso: <strong>{checklistCounted}</strong> contados / <strong>{offlineSession.items.length}</strong> total
                {checklistPending > 0 ? (
                  <span style={{ color: '#a60', marginLeft: 8 }}>({checklistPending} pendente(s))</span>
                ) : (
                  <span style={{ color: '#0a0', marginLeft: 8 }}>Todos preenchidos — pode finalizar.</span>
                )}
                {offlineSession.listMode === 'armazem' && armazemModoIncompleto ? (
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
                  Informe a <strong>quantidade</strong> diretamente na coluna Qtd. Use <strong>Editar</strong> para ajustar
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
                {isMobile ? (
                  <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                    {checklistDisplayItems.map((item) => {
                      if ('kind' in item && item.kind === 'header') {
                        return (
                          <div
                            key={item.key}
                            style={{
                              padding: '10px 10px',
                              fontWeight: 800,
                              fontSize: 12,
                              border: '1px solid #444',
                              borderRadius: 10,
                              background: 'rgba(255, 255, 255, .04)',
                              color: 'var(--text, #111)',
                            }}
                          >
                            {formatArmazemGroupLabel(item.contagem)}
                          </div>
                        )
                      }

                      const it = item as OfflineChecklistItem
                      const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
                      const pend = String(it.quantidade_contada ?? '').trim() === ''
                      const isEditing = checklistEditingKey === it.key && checklistEditDraft

                      return (
                        <div key={it.key} style={{ border: '1px solid var(--border, #ccc)', borderRadius: 12, padding: 12 }}>
                          {isEditing && checklistEditDraft ? (
                            <>
                              <div style={{ display: 'grid', gap: 10 }}>
                                <label style={{ ...labelStyle }}>
                                  Código
                                  <input
                                    value={checklistEditDraft.codigo_interno}
                                    onChange={(e) =>
                                      setChecklistEditDraft((d) =>
                                        d ? { ...d, codigo_interno: e.target.value } : d,
                                      )
                                    }
                                    style={{ ...inputStyle, minWidth: 0 }}
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
                                    style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }}
                                  />
                                </label>
                                <label style={{ ...labelStyle }}>
                                  Qtd
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={checklistEditDraft.quantidade_contada}
                                    onChange={(e) =>
                                      setChecklistEditDraft((d) =>
                                        d ? { ...d, quantidade_contada: e.target.value } : d,
                                      )
                                    }
                                    style={inputStyle}
                                    placeholder="—"
                                  />
                                </label>
                              </div>
                              <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#0b5', fontSize: 13, flex: '1 1 160px' }}
                                  onClick={() => saveChecklistEdit()}
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#666', fontSize: 13, flex: '1 1 160px' }}
                                  onClick={() => cancelChecklistEdit()}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize: 12, color: 'var(--text, #666)', marginBottom: 6 }}>
                                Status: <strong style={{ color: pend ? '#a60' : '#0a0' }}>{pend ? 'Pendente' : 'Contado'}</strong>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace' }}>{it.codigo_interno}</div>
                              <div style={{ fontSize: 13, whiteSpace: 'normal', color: 'var(--text, #111)', marginTop: 4 }}>{it.descricao}</div>

                              <label style={{ ...labelStyle, marginTop: 10 }}>
                                Qtd
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={it.quantidade_contada}
                                  onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                  style={inputStyle}
                                  placeholder="—"
                                />
                              </label>

                              <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 13, flex: '1 1 160px' }}
                                  onClick={() => openChecklistEdit(it)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  style={{ ...buttonStyle, background: '#666', fontSize: 13, flex: '1 1 160px' }}
                                  onClick={() => handleLimparQuantidadeOffline(it.key)}
                                >
                                  Limpar
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...buttonStyle,
                                    background: hasPhoto ? '#0b5' : '#444',
                                    fontSize: 13,
                                    flex: '1 1 160px',
                                  }}
                                  onClick={() => openPhotoModalForCodigo(it.codigo_interno)}
                                  title={hasPhoto ? 'Ver/atualizar foto' : 'Anexar foto'}
                                >
                                  {hasPhoto ? 'Foto (ok)' : 'Sem foto'}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Código</th>
                          <th style={thStyle}>Descrição</th>
                          <th style={thStyle}>Qtd na lista</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checklistDisplayItems.map((item) => {
                          if ('kind' in item && item.kind === 'header') {
                            return (
                              <tr key={item.key}>
                                <td
                                  colSpan={5}
                                  style={{
                                    padding: '10px 8px',
                                    fontWeight: 800,
                                    fontSize: 12,
                                    borderBottom: '1px solid #444',
                                    background: 'rgba(255, 255, 255, .04)',
                                    color: 'var(--text, #111)',
                                  }}
                                >
                                  {formatArmazemGroupLabel(item.contagem)}
                                </td>
                              </tr>
                            )
                          }
                          const it = item as OfflineChecklistItem
                          const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
                          const pend = String(it.quantidade_contada ?? '').trim() === ''
                          const isEditing = checklistEditingKey === it.key && checklistEditDraft
                          return (
                            <tr key={it.key}>
                              {isEditing && checklistEditDraft ? (
                                <>
                                  <td style={tdStyle}>
                                    <input
                                      value={checklistEditDraft.codigo_interno}
                                      onChange={(e) =>
                                        setChecklistEditDraft((d) =>
                                          d ? { ...d, codigo_interno: e.target.value } : d,
                                        )
                                      }
                                      style={{ ...checklistQtdInputStyle, width: '100%', minWidth: 100 }}
                                      aria-label="Código"
                                    />
                                  </td>
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
                                  <td style={tdStyle}>Editando</td>
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
                                </>
                              ) : (
                                <>
                                  <td style={tdStyle}>{it.codigo_interno}</td>
                                  <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>{it.descricao}</td>
                                  <td style={tdStyle}>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={it.quantidade_contada}
                                      onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                      style={checklistQtdInputStyle}
                                      placeholder="—"
                                      aria-label={`Quantidade ${it.codigo_interno}`}
                                    />
                                  </td>
                                  <td style={tdStyle}>{pend ? 'Pendente' : 'Contado'}</td>
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
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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
              <h3 style={{ margin: '0 0 8px' }}>Existem itens sem quantidade</h3>
              {finalizing ? (
                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text, #444)' }}>
                  {finalizeProgress || 'Processando...'}
                </div>
              ) : null}
              <div style={{ fontSize: 13, color: 'var(--text, #444)' }}>
                Há <strong>{missingItemsForFinalize.length}</strong> item(ns) sem quantidade digitada.
                Deseja finalizar mesmo assim?
              </div>

              <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd', fontSize: 12 }}>Código</th>
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
                  onClick={() => void finalizeInternal({ sendZerosForMissing: true })}
                  disabled={finalizing}
                >
                  Finalizar mesmo assim (enviar 0)
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 12' }}>
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
              style={inputStyle}
            />
          </label>
        </div>

        <label style={labelStyle}>
          Leitura de código de barras (DUN/EAN)
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              value={barcodeLeitura}
              onChange={(e) => setBarcodeLeitura(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const ok = applyProductByBarcode(barcodeLeitura)
                  // mantemos o valor para visualização rápida
                }
              }}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Bipe aqui (DUN/caixa ou EAN/pacote-unidade)"
              inputMode="numeric"
              disabled={productOptionsLoading}
            />
            <button
              type="button"
              style={{ ...buttonStyle, background: '#444', fontSize: 13, whiteSpace: 'nowrap' }}
              onClick={() => setBarcodeCameraOpen(true)}
              disabled={productOptionsLoading}
              title="Ler código de barras pela câmera (quando suportado)"
              aria-label="Ler código de barras (câmera)"
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
              style={{ ...buttonStyle, background: '#444', fontSize: 13, whiteSpace: 'nowrap' }}
              onClick={() => openPhotoModalForCodigo(codigoInterno)}
              disabled={!codigoInterno.trim() || productOptionsLoading}
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
        </label>

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
                  if (!matched && produto && produto.codigo_interno !== v) {
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
            {produtoError ? (
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

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 3' }}>
            <label style={labelStyle}>
              Data de fabricação
              <input
                type="date"
                value={dataFabricacao}
                onChange={(e) => setDataFabricacao(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 3' }}>
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

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <button type="submit" disabled={saving} style={buttonStyle}>
            {saving ? 'Gravando…' : 'Salvar na lista (offline)'}
          </button>
          {saveError ? <div style={{ color: '#b00020' }}>{saveError}</div> : null}
          {saveSuccess ? <div style={{ color: '#0f7a0f' }}>{saveSuccess}</div> : null}
        </div>
      </form>

      <div style={{ marginTop: 26 }}>
        <h3>Prévia — o que já está no banco (Supabase)</h3>
        <div style={{ color: 'var(--text, #555)', fontSize: 13, marginTop: 6, maxWidth: 720 }}>
          A lista da contagem diária fica <strong>só no navegador</strong> até você clicar em{' '}
          <strong>Finalizar contagem diária</strong> — aí os registros são enviados para a tabela{' '}
          <code style={{ fontSize: 12 }}>contagens_estoque</code>. Esta prévia mostra exatamente o que já foi gravado
          no banco (por dia civil). Após finalizar, a prévia é atualizada automaticamente; use{' '}
          <strong>Atualizar prévia</strong> para buscar de novo (por exemplo, outro dia ou depois de editar no banco).
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
          <button
            type="button"
            onClick={() => loadPreview()}
            disabled={previewLoading}
            style={buttonStyle}
          >
            {previewLoading ? 'Atualizando...' : 'Atualizar prévia'}
          </button>
        </div>
        {previewRows.length ? (
          renderPreviewTable()
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text, #888)' }}>
            Nenhum registro carregado para a data consultada (por padrão, <strong>hoje</strong>). Isso é normal se ainda
            não finalizou a contagem do dia — finalize para gravar no Supabase, ou clique em{' '}
            <strong>Atualizar prévia</strong> para listar o que já existe no banco.
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
            alignItems: 'center',
            padding: 16,
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: 'min(980px, 100%)',
              background: 'var(--panel-bg, #fff)',
              border: '1px solid var(--border, #ccc)',
              borderRadius: 12,
              padding: 16,
              color: 'var(--text, #111)',
            }}
          >
            <h3 style={{ margin: '0 0 10px' }}>Leitor de código de barras</h3>
            {barcodeCameraError ? <div style={{ color: '#b00020', fontSize: 13, marginBottom: 10 }}>{barcodeCameraError}</div> : null}
            <video ref={barcodeVideoRef} style={{ width: '100%', maxHeight: 420, background: '#000' }} playsInline muted />
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
            alignItems: 'center',
            padding: 16,
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: 'min(980px, 100%)',
              background: 'var(--panel-bg, #fff)',
              border: '1px solid var(--border, #ccc)',
              borderRadius: 12,
              padding: 16,
              color: 'var(--text, #111)',
            }}
          >
            <h3 style={{ margin: '0 0 10px' }}>Foto do produto</h3>
            <div style={{ fontSize: 13, color: 'var(--text, #555)', marginBottom: 10 }}>
              Código: <span style={{ fontFamily: 'monospace' }}>{photoTargetCodigo || '—'}</span>
            </div>
            {photoUiError ? <div style={{ color: '#b00020', fontSize: 13, marginBottom: 10 }}>{photoUiError}</div> : null}

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 12, alignItems: 'start' }}>
              <div>
                <video ref={photoVideoRef} style={{ width: '100%', maxHeight: 420, background: '#000' }} playsInline muted />
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

              <div style={{ border: '1px solid var(--border, #ccc)', borderRadius: 12, padding: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text, #666)', marginBottom: 8 }}>Prévia</div>
                {photoPreviewBase64 ? (
                  <img
                    src={`data:image/jpeg;base64,${photoPreviewBase64}`}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid #eee', background: '#fafafa' }}
                    alt="Prévia foto"
                  />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text, #888)' }}>Sem foto anexada</div>
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

const thStyle: React.CSSProperties = {
  borderBottom: '1px solid #ddd',
  textAlign: 'left',
  padding: 8,
  fontWeight: 700,
  fontSize: 13,
  background: '#fafafa',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: 8,
  fontSize: 13,
  whiteSpace: 'nowrap',
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

