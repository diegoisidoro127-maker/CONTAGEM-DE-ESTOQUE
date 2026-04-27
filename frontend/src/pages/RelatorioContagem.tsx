import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'
import { loadChecklistVisibleColsFromStorage } from '../lib/checklistVisibleCols'
import { enrichContagemRowsWithPlanilhaLinhas } from '../lib/enrichContagemRowsWithPlanilhaLinhas'
import { enrichContagemRowsEanDunFromTodosOsProdutos } from '../lib/enrichContagemRowsEanDunFromTodosOsProdutos'
import { fetchConferentesNomesPorIds } from '../lib/conferentesNomesBatch'
import {
  fetchPlanilhaContagemIdsParaIntervalo,
  filterContagensPorModoListagem,
  ordenarLinhasInventarioComoPrevia,
  prepararContagemDiariaOficialListaUnicaPorProduto,
  type ConferenteDetalheGrupo,
} from '../lib/contagemListagemCompat'
import { formatContagemLabel, inventarioCamaraLabelFromGrupo } from '../components/inventario/inventarioPlanilhaModel'
import { deleteInventarioPlanilhaLinhasForContagensIds } from '../lib/inventarioPlanilhaLinhasDelete'
import { isVencimentoAntesFabricacao } from '../lib/contagemDatasValidacao'
import { normalizeCodigoInternoCompareKey } from '../lib/codigoInternoCompare'

type ContagemRow = {
  id: string
  data_contagem?: string | null
  data_hora_contagem: string
  conferente_id: string
  conferentes?: { nome: string } | Array<{ nome: string }> | null

  codigo_interno: string
  descricao: string
  unidade_medida: string | null

  quantidade_up: number
  up_adicional?: number | null
  lote: string | null
  observacao: string | null

  produto_id: string | null
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
  foto_base64?: string | null
  /** contagem_diaria | inventario — quando existir na tabela */
  origem?: string | null
  /** 1–4 na rodada de inventário; contagem diária costuma ser null */
  inventario_numero_contagem?: number | null
  /** 1–3 repetição (inventário); necessário para o mesmo filtro da prévia */
  inventario_repeticao?: number | null
  /** Quando a linha é agrupamento da contagem diária (igual à prévia), ids aglutinados */
  source_ids?: string[]
  /** Lote da finalização (contagem diária); separa várias finalizações no mesmo dia/conferente. */
  finalizacao_sessao_id?: string | null
  /** Preenchido a partir de `inventario_planilha_linhas` (inventário formato planilha). */
  planilha_grupo_armazem?: number | null
  planilha_rua?: string | null
  planilha_posicao?: number | null
  planilha_nivel?: number | null
  /** Contagem diária agrupada: quantidade por conferente (mesma regra da prévia). */
  preview_conferentes_detalhe?: ConferenteDetalheGrupo[]
  /** true = sincronização em andamento (excluir do relatório oficial). */
  contagem_rascunho?: boolean | null
}

function semLinhasRascunhoRelatorio<T extends { contagem_rascunho?: boolean | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.contagem_rascunho !== true)
}

function toISODateLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDateBR(dateStr: string) {
  // YYYY-MM-DD
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr
  return `${d}/${m}/${y}`
}

function formatDateBRFromYmd(ymd: string | null | undefined): string {
  if (!ymd || String(ymd).trim() === '') return ''
  return formatDateBR(String(ymd).slice(0, 10))
}

function toYmdSP(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Timestamp válido de `data_hora_contagem` ou null. */
function tsFromDataHoraContagem(iso: string | null | undefined): number | null {
  if (!iso || !String(iso).trim()) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** Primeiro/último horário de lançamento no dia (mesmo grupo); sempre exibe intervalo início - fim. */
function formatHistoricoHorarioInput(minTs: number | null, maxTs: number | null): string {
  if (minTs == null && maxTs == null) return '—'
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const a = minTs ?? maxTs
  const b = maxTs ?? minTs
  if (a == null || b == null) return '—'
  return `${fmt(a)} - ${fmt(b)}`
}

function isColumnMissingErrorRel(e: unknown): boolean {
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
  return (
    code === '42703' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  )
}

const TABELA_PRODUTOS_REL = 'Todos os Produtos'

/** Com modo Inventário: Câmara, Rua, POS, Nível, Contagem (rodada), Conferente (6). Contagem diária: só Conferente (1). */
const RELATORIO_COLS_PLANILHA_LOCAL = 6

function conferenteNomeRelatorio(r: ContagemRow): string {
  const c = r.conferentes
  if (Array.isArray(c)) {
    const n = c[0]?.nome
    if (typeof n === 'string' && n.trim() !== '') return n.trim()
  } else if (c && typeof c === 'object' && 'nome' in c) {
    const n = (c as { nome?: string }).nome
    if (typeof n === 'string' && n.trim() !== '') return n.trim()
  }
  const id = String(r.conferente_id ?? '').trim()
  return id !== '' ? id : '—'
}

/** Garante nome legível quando o embed `conferentes(nome)` não veio (RLS / PostgREST). */
async function enrichRelatorioRowsConferenteNomes(rows: ContagemRow[]): Promise<ContagemRow[]> {
  const ids = rows.map((r) => r.conferente_id).filter(Boolean) as string[]
  const map = await fetchConferentesNomesPorIds(ids)
  return rows.map((r) => {
    const id = String(r.conferente_id ?? '').trim()
    const nome = id ? map.get(id)?.trim() : ''
    if (!nome) return r
    return { ...r, conferentes: { nome } }
  })
}

async function enrichPlanilhaEConferente(rows: ContagemRow[]): Promise<ContagemRow[]> {
  const withNames = await enrichRelatorioRowsConferenteNomes(rows)
  const withPlanilha = await enrichContagemRowsWithPlanilhaLinhas(withNames, 'RelatorioContagem')
  return enrichContagemRowsEanDunFromTodosOsProdutos(withPlanilha, 'RelatorioContagem')
}

function mergeContagemRowsById(
  a: ContagemRow[] | null | undefined,
  b: ContagemRow[] | null | undefined,
): ContagemRow[] {
  const map = new Map<string, ContagemRow>()
  for (const r of a ?? []) map.set(r.id, r)
  for (const r of b ?? []) map.set(r.id, r)
  return Array.from(map.values()).sort((x, y) => {
    const nx = normalizeCodigoInternoCompareKey(String(x.codigo_interno))
    const ny = normalizeCodigoInternoCompareKey(String(y.codigo_interno))
    const c = nx !== ny ? nx.localeCompare(ny, 'pt-BR') : String(x.codigo_interno).localeCompare(String(y.codigo_interno), 'pt-BR')
    if (c !== 0) return c
    return new Date(x.data_hora_contagem).getTime() - new Date(y.data_hora_contagem).getTime()
  })
}

function relatorioItemDiaKey(dataYmd: string, codigo: string, descricao: string): string {
  return `${String(dataYmd ?? '').slice(0, 10)}|${normalizeCodigoInternoCompareKey(String(codigo ?? '')).toLowerCase()}|${String(descricao ?? '').trim().toLowerCase()}`
}

/** Paginação (15 + “Mostrar tudo”) vale para Relatório completo e Todas as contagens — mesmo componente. */
const RELATORIO_PAGE_SIZE = 15
/** PostgREST costuma limitar ~1000 linhas por requisição; buscamos em fatias para trazer o relatório inteiro. */
const RELATORIO_FETCH_CHUNK = 1000

/** Uma linha no histórico: conferente × dia civil × lote de finalização × quantidade de lançamentos. */
type HistoricoContagemItem = {
  conferenteId: string | null
  conferenteNome: string
  dataYmd: string
  /** `null` = registros sem coluna de sessão (legado) ou vazio; UUID = uma finalização específica. */
  finalizacaoSessaoId: string | null
  /** Horário(ões) de registro (`data_hora_contagem`) no grupo: primeiro–último ou único. */
  horaInputLabel: string
  totalItens: number
}

type AvisoCargaPendente = {
  diaYmd: string
  pendencias: number
  conferentes: number
}

type AvisoExportPendente = {
  diaYmd: string
  pendencias: number
  conferentes: number
}

type PainelDiaResumo = {
  count: number
  inicio: string | null
  fim: string | null
}

/** Resultado de uma consulta rápida ao dia antes de carregar/exportar (uma única busca). */
type AvaliacaoUmDiaContagem =
  | { kind: 'vazio' }
  | { kind: 'pendente'; aviso: AvisoCargaPendente }
  | { kind: 'ok' }

/**
 * Dia civil (YMD) para histórico/lista:
 * - prioriza `data_contagem` (quando válida)
 * - fallback para `data_hora_contagem` (legado / migrações antigas)
 */
function diaYmdSoDataContagemRow(r: Pick<ContagemRow, 'data_contagem' | 'data_hora_contagem'>): string | null {
  const d = r.data_contagem != null ? String(r.data_contagem).slice(0, 10) : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const t = r.data_hora_contagem != null ? String(r.data_hora_contagem).slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function computeMinMaxYmdDataContagemOnly(rows: ContagemRow[]): { minY: string; maxY: string } {
  let minY = '9999-12-31'
  let maxY = '1970-01-01'
  for (const r of rows) {
    const day = diaYmdSoDataContagemRow(r)
    if (!day) continue
    if (day < minY) minY = day
    if (day > maxY) maxY = day
  }
  if (minY === '9999-12-31') return { minY: '1970-01-01', maxY: '2100-12-31' }
  return { minY, maxY }
}

type RelatorioContagemProps = {
  mode?: 'periodo' | 'dia'
  /** Valor inicial: última tela Contagem vs Inventário (sessionStorage no App). */
  listColumnPrefsInventario?: boolean
}

const relPanelStyle: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  border: '1px solid var(--border, #ccc)',
  borderRadius: 10,
  background: 'var(--panel-bg, rgba(0,0,0,.04))',
}

const relToolbarLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
}

const relToolbarInputStyle: React.CSSProperties = {
  padding: '10px 10px',
  border: '1px solid #ccc',
  borderRadius: 8,
  width: '100%',
  boxSizing: 'border-box',
}

const relToolbarBtnRow: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const relBtnCarregar: React.CSSProperties = {
  ...relToolbarBtnRow,
  background: 'linear-gradient(180deg, #4f8eff 0%, #2f6fdf 100%)',
  border: '1px solid #7fb0ff',
  color: '#f4f9ff',
  fontWeight: 700,
}

const relBtnExcel: React.CSSProperties = {
  ...relToolbarBtnRow,
  background: 'linear-gradient(180deg, #66bb6a 0%, #2e7d32 100%)',
  border: '1px solid #a5d6a7',
  color: '#fff',
  fontWeight: 700,
}

const relBtnBaseExport: React.CSSProperties = {
  ...relToolbarBtnRow,
  background: 'linear-gradient(180deg, #42a5f5 0%, #1976d2 100%)',
  border: '1px solid #90caf9',
  color: '#fff',
  fontWeight: 700,
}

const relBtnDark: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #222',
  background: '#111',
  color: 'white',
  cursor: 'pointer',
  minHeight: 40,
}

export default function RelatorioContagem({
  mode = 'periodo',
  listColumnPrefsInventario = false,
}: RelatorioContagemProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingQuantidade, setEditingQuantidade] = useState<string>('')
  const [rowActionLoading, setRowActionLoading] = useState(false)

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 900,
  )
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Preferências de colunas: inventário vs contagem diária (toggle ou valor vindo do App). */
  const [useInventarioCols, setUseInventarioCols] = useState(listColumnPrefsInventario)

  const isDiaMode = mode === 'dia'
  /** Excel só no relatório por período — nunca em “Todas as contagens” (`mode="dia"`). */
  const showExportExcel = mode === 'periodo'

  const listColPrefs = useMemo(() => loadChecklistVisibleColsFromStorage(useInventarioCols), [useInventarioCols])
  const prevCol = (id: string) => listColPrefs[id] !== false
  const relatorioListaColCount = useMemo(
    () =>
      (useInventarioCols ? RELATORIO_COLS_PLANILHA_LOCAL : 1) +
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
      ].filter((id) => listColPrefs[id] !== false).length,
    [listColPrefs, useInventarioCols],
  )

  const [startDate, setStartDate] = useState(() =>
    toISODateLocal(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  )
  const [endDate, setEndDate] = useState(() => toISODateLocal(new Date()))
  const [allTime, setAllTime] = useState(false)
  const [useSingleDay, setUseSingleDay] = useState(false)
  const [singleDay, setSingleDay] = useState(() => toISODateLocal(new Date()))
  /** Filtro opcional: qual das 4 contagens da rodada de inventário (linhas sem número = contagem diária). */
  const [numeroContagemFilter, setNumeroContagemFilter] = useState<'todas' | '1' | '2' | '3' | '4'>('todas')
  const [rows, setRows] = useState<ContagemRow[]>([])
  const [relatorioPage, setRelatorioPage] = useState(1)
  const [relatorioShowAll, setRelatorioShowAll] = useState(false)
  const prevLoadingRef = useRef(false)
  const [baseExportLoading, setBaseExportLoading] = useState(false)
  const [exportExcelLoading, setExportExcelLoading] = useState(false)
  const [avisoCargaPendente, setAvisoCargaPendente] = useState<AvisoCargaPendente | null>(null)
  const [avisoDiaSemContagem, setAvisoDiaSemContagem] = useState<{ diaYmd: string } | null>(null)
  const [avisoExportPendente, setAvisoExportPendente] = useState<AvisoExportPendente | null>(null)
  /** Contagem diária: qual conferente exibir na coluna quantidade/nome (mesma ideia da prévia em Contagem). */
  const [relatorioConferenteFiltroLista, setRelatorioConferenteFiltroLista] = useState<string>('')

  /** Só em “Todas as contagens”: histórico agregado + filtro vindo de “Ver contagem”. */
  const [historicoItems, setHistoricoItems] = useState<HistoricoContagemItem[]>([])
  const [historicoLoading, setHistoricoLoading] = useState(false)
  const [historicoError, setHistoricoError] = useState('')
  /** Evita request 400 repetido quando `finalizacao_sessao_id` não existe no banco. */
  const contagensHasFinalizacaoSessaoIdRef = useRef(true)
  /**
   * Quando definido, o Carregar aplica só linhas deste conferente (contagem diária).
   * `'__sem__'` = sem conferente no registro.
   */
  const [conferenteFiltroHistorico, setConferenteFiltroHistorico] = useState<string | null>(null)
  const listaRelatorioRef = useRef<HTMLDivElement | null>(null)

  const dateRangeText = useMemo(() => {
    if (allTime) return 'Todas as datas'
    if (useSingleDay) return `Dia: ${formatDateBR(singleDay)}`
    return `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`
  }, [allTime, useSingleDay, singleDay, startDate, endDate])

  /** Um único dia civil no filtro (inclui início = fim sem “Filtrar por dia”). */
  const isExportUmDiaCivil = useMemo(
    () => !allTime && (useSingleDay || startDate === endDate),
    [allTime, useSingleDay, startDate, endDate],
  )

  const conferentesRelatorioOpcoes = useMemo(() => {
    if (useInventarioCols) return [] as Array<{ id: string; nome: string }>
    const map = new Map<string, string>()
    for (const r of rows) {
      const det = r.preview_conferentes_detalhe
      if (det?.length) {
        for (const d of det) {
          if (d.conferente_id) map.set(d.conferente_id, String(d.conferente_nome ?? '').trim() || d.conferente_id)
        }
      } else {
        const cid = String(r.conferente_id ?? '').trim()
        if (cid) map.set(cid, conferenteNomeRelatorio(r))
      }
    }
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [rows, useInventarioCols])

  useEffect(() => {
    if (useInventarioCols) return
    if (conferentesRelatorioOpcoes.length === 0) return
    const want = conferentesRelatorioOpcoes.some((o) => o.id === relatorioConferenteFiltroLista)
      ? relatorioConferenteFiltroLista
      : conferentesRelatorioOpcoes[0].id
    if (relatorioConferenteFiltroLista !== want) setRelatorioConferenteFiltroLista(want)
  }, [useInventarioCols, conferentesRelatorioOpcoes, relatorioConferenteFiltroLista])

  const relatorioQuantidadeExibida = useCallback((r: ContagemRow) => r.quantidade_up, [])

  const relatorioSourceIdsParaAcao = useCallback(
    (r: ContagemRow) => (r.source_ids?.length ? r.source_ids : [r.id]),
    [],
  )

  const relatorioPodeEditarQuantidade = useCallback((_r: ContagemRow) => true, [])

  const rowsFiltradosLista = useMemo(() => rows, [rows])

  useEffect(() => {
    setRelatorioPage(1)
  }, [relatorioConferenteFiltroLista])

  const relatorioTotalPages = Math.max(1, Math.ceil(rowsFiltradosLista.length / RELATORIO_PAGE_SIZE))
  const relatorioPageSafe = Math.min(relatorioPage, relatorioTotalPages)
  const displayRows = useMemo(() => {
    if (relatorioShowAll) return rowsFiltradosLista
    const start = (relatorioPageSafe - 1) * RELATORIO_PAGE_SIZE
    return rowsFiltradosLista.slice(start, start + RELATORIO_PAGE_SIZE)
  }, [rowsFiltradosLista, relatorioPageSafe, relatorioShowAll])

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setRelatorioPage(1)
      setRelatorioShowAll(false)
    }
    prevLoadingRef.current = loading
  }, [loading])

  /** Em contagem diária o filtro de rodada não se aplica; evita valor antigo ao voltar ao modo inventário. */
  useEffect(() => {
    if (!useInventarioCols) setNumeroContagemFilter('todas')
  }, [useInventarioCols])

  async function fetchRelatorioContagemRows(opts?: {
    /** Força busca só neste dia civil (ex.: “Ver contagem” no histórico). */
    singleDayYmd?: string
    allTimeOverride?: boolean
    /** Inclui linhas rascunho (`contagem_rascunho = true`) no resultado. */
    includeRascunho?: boolean
  }): Promise<{
    rows: ContagemRow[]
    successMessage?: string
    /** Igual à prévia quando `origem` não existe no banco (fallback SQL). */
    origemAusenteNoResultado: boolean
  }> {
    const allT = opts?.allTimeOverride ?? allTime
    const useSd = opts?.singleDayYmd != null ? true : useSingleDay
    const singleDayVal = opts?.singleDayYmd ?? singleDay
    const includeRascunho = opts?.includeRascunho ?? false
    const applyRascunhoPolicy = <T extends { contagem_rascunho?: boolean | null }>(data: T[]): T[] =>
      includeRascunho ? data : semLinhasRascunhoRelatorio(data)

    const selectCompletoSemSessao = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      conferentes(nome),
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      origem,
      inventario_repeticao,
      inventario_numero_contagem,
      contagem_rascunho
    `
    const selectCompleto = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      conferentes(nome),
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      finalizacao_sessao_id,
      origem,
      inventario_repeticao,
      inventario_numero_contagem,
      contagem_rascunho
    `
    const selectCompletoCompact = selectCompleto.replace(/\s+/g, '')
    const selectCompletoSemSessaoCompact = selectCompletoSemSessao.replace(/\s+/g, '')

    const selectBasico = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      conferentes(nome),
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      lote,
      observacao
    `
    const selectBasicoCompact = selectBasico.replace(/\s+/g, '')

    /** Mesmas colunas do SELECT completo, sem embed `conferentes(nome)` (fallback quando o join falha). */
    const selectFlatCompletoSemSessao = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      origem,
      inventario_repeticao,
      inventario_numero_contagem,
      contagem_rascunho
    `
    const selectFlatCompleto = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      finalizacao_sessao_id,
      origem,
      inventario_repeticao,
      inventario_numero_contagem,
      contagem_rascunho
    `
    const selectFlatCompletoCompact = selectFlatCompleto.replace(/\s+/g, '')
    const selectFlatCompletoSemSessaoCompact = selectFlatCompletoSemSessao.replace(/\s+/g, '')

    /** Mesmo SELECT sem colunas de inventário, sem embed de conferente. */
    const selectFlatSemColunasInventario = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      inventario_repeticao
    `
    const selectFlatSemColunasInventarioCompact = selectFlatSemColunasInventario.replace(/\s+/g, '')

    const selectFlatBasico = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      lote,
      observacao
    `
    const selectFlatBasicoCompact = selectFlatBasico.replace(/\s+/g, '')

    /**
     * Mesmo fallback “básico”, mas com origem + metadados de inventário.
     * Sem isso, o último fallback zerava esses campos e o filtro “Inventário” escondia
     * linhas salvas em `contagens_estoque` (só passavam IDs ligados em `inventario_planilha_linhas`).
     */
    const selectBasicoComOrigemInventario = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      conferentes(nome),
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      lote,
      observacao,
      origem,
      inventario_repeticao,
      inventario_numero_contagem
    `
    const selectBasicoComOrigemInventarioCompact = selectBasicoComOrigemInventario.replace(/\s+/g, '')

    const selectFlatBasicoComOrigemInventario = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      lote,
      observacao,
      origem,
      inventario_repeticao,
      inventario_numero_contagem
    `
    const selectFlatBasicoComOrigemInventarioCompact = selectFlatBasicoComOrigemInventario.replace(/\s+/g, '')

    /** Mesmo SELECT completo, sem colunas de inventário (banco sem migração). */
    const selectSemColunasInventario = `
      id,
      data_contagem,
      data_hora_contagem,
      conferente_id,
      conferentes(nome),
      produto_id,
      codigo_interno,
      descricao,
      unidade_medida,
      quantidade_up,
      up_adicional,
      lote,
      observacao,
      data_fabricacao,
      data_validade,
      ean,
      dun,
      foto_base64,
      inventario_repeticao
    `
    const selectSemColunasInventarioCompact = selectSemColunasInventario.replace(/\s+/g, '')

    const applyNumeroInventario = (q: any, withNumeroFilter: boolean) => {
      /** Só filtra no servidor no modo inventário; em “contagem diária” o filtro esvaziaria o resultado. */
      if (!withNumeroFilter || !useInventarioCols || numeroContagemFilter === 'todas') return q
      return q.eq('inventario_numero_contagem', Number(numeroContagemFilter))
    }

    /** Nova query a cada fatia — evita reaproveitar builder com `.range()` mutado. */
    async function fetchAllPaged(buildQ: () => any): Promise<ContagemRow[]> {
      const out: ContagemRow[] = []
      let from = 0
      while (true) {
        const { data, error: qError } = await buildQ().range(from, from + RELATORIO_FETCH_CHUNK - 1)
        if (qError) throw qError
        const batch = (data ?? []) as unknown as ContagemRow[]
        out.push(...batch)
        if (batch.length < RELATORIO_FETCH_CHUNK) break
        from += RELATORIO_FETCH_CHUNK
        if (from > 500000) break
      }
      return out
    }

    async function fetchRows(selectCompact: string, withNumeroFilter: boolean): Promise<ContagemRow[]> {
      const base = () =>
        applyNumeroInventario(
          supabase
            .from('contagens_estoque')
            .select(selectCompact)
            .order('codigo_interno', { ascending: true })
            .order('data_hora_contagem', { ascending: true }),
          withNumeroFilter,
        )

      if (allT) {
        return fetchAllPaged(() => base())
      }

      if (useSd) {
        const startIsoSd = `${singleDayVal}T00:00:00`
        const endIsoSd = `${singleDayVal}T23:59:59`
        const [a, b] = await Promise.all([
          fetchAllPaged(() => base().eq('data_contagem', singleDayVal)),
          // Fallback legado: registros sem `data_contagem` válida, mas com `data_hora_contagem` no dia.
          fetchAllPaged(() => base().gte('data_hora_contagem', startIsoSd).lte('data_hora_contagem', endIsoSd)),
        ])
        return mergeContagemRowsById(a, b)
      }

      const startIso = `${startDate}T00:00:00`
      const endIso = `${endDate}T23:59:59`
      const [a, b] = await Promise.all([
        fetchAllPaged(() => base().gte('data_contagem', startDate).lte('data_contagem', endDate)),
        // Fallback legado: inclui linhas com `data_contagem` nula/vazia/inválida, guiando pelo timestamp.
        fetchAllPaged(() => base().gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)),
      ])
      return mergeContagemRowsById(a, b)
    }

    const mapSemOrigem = (data: ContagemRow[]): ContagemRow[] =>
      data.map((r) => ({
        ...r,
        origem: r.origem ?? null,
        inventario_repeticao: r.inventario_repeticao ?? null,
        inventario_numero_contagem: r.inventario_numero_contagem ?? null,
      }))

    /** SELECT sem `inventario_numero_contagem` não devolve o campo; se filtramos por nº no servidor, preenche para exibição. */
    const injectNumeroSeFiltroAtivo = (data: ContagemRow[]): ContagemRow[] => {
      if (numeroContagemFilter === 'todas') {
        return data.map((r) => ({ ...r, origem: null }))
      }
      const n = Number(numeroContagemFilter)
      return data.map((r) => ({ ...r, origem: null, inventario_numero_contagem: n }))
    }

    async function fetchRowsComFallbackEmbed(
      selectComEmbed: string,
      selectSemEmbed: string,
      withNumeroFilter: boolean,
    ): Promise<ContagemRow[]> {
      try {
        return (await fetchRows(selectComEmbed, withNumeroFilter)) as ContagemRow[]
      } catch (err: unknown) {
        if (isColumnMissingErrorRel(err)) throw err
        return (await fetchRows(selectSemEmbed, withNumeroFilter)) as ContagemRow[]
      }
    }

    try {
      let data: ContagemRow[]
      const selectCompletoPrefer = contagensHasFinalizacaoSessaoIdRef.current
        ? selectCompletoCompact
        : selectCompletoSemSessaoCompact
      const selectFlatCompletoPrefer = contagensHasFinalizacaoSessaoIdRef.current
        ? selectFlatCompletoCompact
        : selectFlatCompletoSemSessaoCompact
      try {
        data = await fetchRowsComFallbackEmbed(selectCompletoPrefer, selectFlatCompletoPrefer, true)
      } catch (e0: unknown) {
        if (!isColumnMissingErrorRel(e0)) throw e0
        contagensHasFinalizacaoSessaoIdRef.current = false
        data = await fetchRowsComFallbackEmbed(selectCompletoSemSessaoCompact, selectFlatCompletoSemSessaoCompact, true)
      }
      return {
        rows: await enrichPlanilhaEConferente(mapSemOrigem(applyRascunhoPolicy(data))),
        origemAusenteNoResultado: false,
      }
    } catch (e: unknown) {
      if (!isColumnMissingErrorRel(e)) {
        throw new Error(e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Erro ao carregar relatório.')
      }
      try {
        const data = await fetchRowsComFallbackEmbed(
          selectSemColunasInventarioCompact,
          selectFlatSemColunasInventarioCompact,
          true,
        )
        return {
          rows: await enrichPlanilhaEConferente(mapSemOrigem(injectNumeroSeFiltroAtivo(applyRascunhoPolicy(data)))),
          successMessage:
            'Colunas origem / nº contagem ausentes no SELECT (migre com os SQL em supabase/sql). O filtro por nº da contagem foi aplicado no servidor.',
          origemAusenteNoResultado: true,
        }
      } catch (e2: unknown) {
        if (!isColumnMissingErrorRel(e2)) {
          throw new Error(
            e2 && typeof e2 === 'object' && 'message' in e2 ? String((e2 as Error).message) : 'Erro ao carregar relatório.',
          )
        }
      }
      try {
        const data = applyRascunhoPolicy(
          await fetchRowsComFallbackEmbed(
            selectSemColunasInventarioCompact,
            selectFlatSemColunasInventarioCompact,
            false,
          ),
        )
        return {
          rows: await enrichPlanilhaEConferente(
            (data as ContagemRow[]).map((r) => ({
              ...r,
              origem: null,
              inventario_repeticao: null,
              inventario_numero_contagem: null,
            })) as ContagemRow[],
          ),
          successMessage:
            'Colunas de inventário ausentes no Supabase: relatório sem filtro por nº da contagem. Execute alter_contagens_estoque_origem_inventario.sql e alter_contagens_estoque_inventario_numero_contagem.sql.',
          origemAusenteNoResultado: true,
        }
      } catch (e3: unknown) {
        if (!isColumnMissingErrorRel(e3)) {
          throw new Error(
            e3 && typeof e3 === 'object' && 'message' in e3 ? String((e3 as Error).message) : 'Erro ao carregar relatório.',
          )
        }
      }
      try {
        let data: ContagemRow[]
        let basicoEstendidoOk = false
        try {
          data = (await fetchRowsComFallbackEmbed(
            selectBasicoComOrigemInventarioCompact,
            selectFlatBasicoComOrigemInventarioCompact,
            false,
          )) as ContagemRow[]
          basicoEstendidoOk = true
        } catch (eExt: unknown) {
          if (!isColumnMissingErrorRel(eExt)) throw eExt
          data = (await fetchRowsComFallbackEmbed(selectBasicoCompact, selectFlatBasicoCompact, false)) as ContagemRow[]
        }
        const mapped = applyRascunhoPolicy(data).map((r) => ({
          ...r,
          data_fabricacao: null,
          data_validade: null,
          ean: null,
          dun: null,
          up_adicional: null,
          foto_base64: null,
          ...(basicoEstendidoOk
            ? {}
            : { origem: null, inventario_repeticao: null, inventario_numero_contagem: null }),
        })) as ContagemRow[]
        return {
          rows: await enrichPlanilhaEConferente(mapped),
          successMessage: basicoEstendidoOk
            ? 'Relatório em modo compatível (EAN, fotos e outras colunas omitidas). Inventário e contagem diária seguem o filtro da prévia. Execute os scripts SQL em supabase/sql para o relatório completo.'
            : 'Relatório em modo compatível (menos colunas). Execute os scripts SQL do projeto no Supabase para todos os campos.',
          origemAusenteNoResultado: !basicoEstendidoOk,
        }
      } catch (e4: unknown) {
        throw new Error(
          e4 && typeof e4 === 'object' && 'message' in e4 ? String((e4 as Error).message) : 'Erro ao carregar relatório (fallback).',
        )
      }
    }
  }

  function planilhaIntervalYmdForPrevia(data: ContagemRow[]): { minY: string; maxY: string } {
    let minY = startDate
    let maxY = endDate
    if (useSingleDay) {
      minY = maxY = singleDay
    } else if (allTime) {
      minY = '9999-12-31'
      maxY = '1970-01-01'
      for (const r of data) {
        const d = r.data_contagem != null ? String(r.data_contagem).slice(0, 10) : ''
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          if (d < minY) minY = d
          if (d > maxY) maxY = d
        }
      }
      if (minY === '9999-12-31') {
        minY = '1970-01-01'
        maxY = '2100-12-31'
      }
    }
    return { minY, maxY }
  }

  /** Filtro origem/planilha igual à prévia, antes de ordenar (inventário) ou agrupar (contagem diária). */
  async function filtrarLinhasParaPrevia(
    data: ContagemRow[],
    origemAusenteNoResultado: boolean,
  ): Promise<{ modo: 'inventario' | 'contagem_diaria'; filtered: ContagemRow[] }> {
    const { minY, maxY } = planilhaIntervalYmdForPrevia(data)
    const planilhaIds = await fetchPlanilhaContagemIdsParaIntervalo(supabase, minY, maxY)
    const modo = useInventarioCols ? 'inventario' : 'contagem_diaria'
    const asRec = data.map((r) => ({ ...r }) as Record<string, unknown>)
    const filtered = filterContagensPorModoListagem(
      asRec,
      modo,
      planilhaIds,
      origemAusenteNoResultado,
    ) as ContagemRow[]
    return { modo, filtered }
  }

  /** Regra do relatório: inventário ordenado como prévia; contagem diária = uma linha por produto (último lançamento; sem somar conferentes). */
  async function aplicarMesmaRegraDaPreviaAsync(
    data: ContagemRow[],
    origemAusenteNoResultado: boolean,
  ): Promise<ContagemRow[]> {
    const { modo, filtered } = await filtrarLinhasParaPrevia(data, origemAusenteNoResultado)
    if (modo === 'inventario') {
      let inv = ordenarLinhasInventarioComoPrevia(filtered) as ContagemRow[]
      if (numeroContagemFilter !== 'todas') {
        const n = Number(numeroContagemFilter)
        inv = inv.filter((r) => Number(r.inventario_numero_contagem ?? NaN) === n)
      }
      return inv
    }
    let grouped = prepararContagemDiariaOficialListaUnicaPorProduto(filtered as ContagemRow[]) as ContagemRow[]

    // Alinha o nome da coluna Conferente com a view oficial de itens do painel.
    try {
      const byDay = grouped
        .map((r) => String(r.data_contagem ?? '').slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
      if (byDay.length > 0) {
        const minDay = byDay[0]
        const maxDay = byDay[byDay.length - 1]
        const { data: itens, error: itensErr } = await supabase
          .from('v_contagem_diaria_itens_painel')
          .select('data_contagem,codigo_interno,descricao,conferente_nome')
          .gte('data_contagem', minDay)
          .lte('data_contagem', maxDay)
          .limit(50000)
        if (!itensErr && itens) {
          const nomeByKey = new Map<string, string>()
          for (const row of itens as Array<Record<string, unknown>>) {
            const key = relatorioItemDiaKey(
              String(row.data_contagem ?? ''),
              String(row.codigo_interno ?? ''),
              String(row.descricao ?? ''),
            )
            const nome = String(row.conferente_nome ?? '').trim()
            if (key && nome) nomeByKey.set(key, nome)
          }
          grouped = grouped.map((r) => {
            const key = relatorioItemDiaKey(r.data_contagem, r.codigo_interno, r.descricao)
            const nome = nomeByKey.get(key)
            if (!nome) return r
            return { ...r, conferentes: { nome } }
          })
        }
      }
    } catch {
      // fallback silencioso para dados nativos de contagens_estoque
    }

    return grouped.sort((a, b) => {
      const c = a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
      if (c !== 0) return c
      return a.descricao.localeCompare(b.descricao, 'pt-BR')
    })
  }

  async function fetchHistoricoRawRows(): Promise<{ rows: ContagemRow[]; origemAusenteNoResultado: boolean }> {
    const cand1 =
      'id,data_contagem,data_hora_contagem,conferente_id,origem,inventario_repeticao,inventario_numero_contagem,finalizacao_sessao_id'.replace(
        /\s/g,
        '',
      )
    const cand1SemSess =
      'id,data_contagem,data_hora_contagem,conferente_id,origem,inventario_repeticao,inventario_numero_contagem'.replace(
        /\s/g,
        '',
      )
    const cand2 = 'id,data_contagem,data_hora_contagem,conferente_id'.replace(/\s/g, '')
    async function pull(sel: string): Promise<ContagemRow[]> {
      const acc: ContagemRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('contagens_estoque')
          .select(sel)
          .order('data_hora_contagem', { ascending: false })
          .range(from, from + RELATORIO_FETCH_CHUNK - 1)
        if (error) throw error
        const batch = (data ?? []) as ContagemRow[]
        acc.push(...batch)
        if (batch.length < RELATORIO_FETCH_CHUNK) break
        from += RELATORIO_FETCH_CHUNK
        if (from > 100000) break
      }
      return semLinhasRascunhoRelatorio(acc)
    }
    try {
      const sel = contagensHasFinalizacaoSessaoIdRef.current ? cand1 : cand1SemSess
      return { rows: await pull(sel), origemAusenteNoResultado: false }
    } catch {
      try {
        contagensHasFinalizacaoSessaoIdRef.current = false
        return { rows: await pull(cand1SemSess), origemAusenteNoResultado: false }
      } catch {
        return { rows: await pull(cand2), origemAusenteNoResultado: true }
      }
    }
  }

  async function buildHistoricoLista(
    raw: ContagemRow[],
    origemAusenteNoResultado: boolean,
  ): Promise<HistoricoContagemItem[]> {
    if (!raw.length) return []
    const { minY, maxY } = computeMinMaxYmdDataContagemOnly(raw)
    const planilhaIds = await fetchPlanilhaContagemIdsParaIntervalo(supabase, minY, maxY)
    const asRec = raw.map((r) => ({ ...r }) as Record<string, unknown>)
    const filtered = filterContagensPorModoListagem(
      asRec,
      'contagem_diaria',
      planilhaIds,
      origemAusenteNoResultado,
    ) as ContagemRow[]

    const bucket = new Map<
      string,
      {
        dataYmd: string
        conferenteId: string | null
        finalizacaoSessaoId: string | null
        total: number
        minTs: number | null
        maxTs: number | null
      }
    >()
    for (const r of filtered) {
      const dataYmd = diaYmdSoDataContagemRow(r)
      if (!dataYmd) continue
      const cidRaw = String(r.conferente_id ?? '').trim()
      const conferenteId = cidRaw === '' ? null : cidRaw
      const sidRaw = String(r.finalizacao_sessao_id ?? '').trim()
      const finalizacaoSessaoId = sidRaw === '' ? null : sidRaw
      const key = `${dataYmd}|${conferenteId ?? '__sem__'}|${finalizacaoSessaoId ?? '__legacy__'}`
      const ts = tsFromDataHoraContagem(r.data_hora_contagem)
      const prev = bucket.get(key)
      if (prev) {
        prev.total += 1
        if (ts != null) {
          if (prev.minTs == null || ts < prev.minTs) prev.minTs = ts
          if (prev.maxTs == null || ts > prev.maxTs) prev.maxTs = ts
        }
      } else {
        bucket.set(key, {
          dataYmd,
          conferenteId,
          finalizacaoSessaoId,
          total: 1,
          minTs: ts,
          maxTs: ts,
        })
      }
    }

    const ids = [...new Set([...bucket.values()].map((b) => b.conferenteId).filter(Boolean))] as string[]
    const nomes = await fetchConferentesNomesPorIds(ids)
    const out: HistoricoContagemItem[] = []
    for (const v of bucket.values()) {
      const nome =
        v.conferenteId == null ? 'Sem conferente' : nomes.get(v.conferenteId)?.trim() || v.conferenteId
      out.push({
        conferenteId: v.conferenteId,
        conferenteNome: nome,
        dataYmd: v.dataYmd,
        finalizacaoSessaoId: v.finalizacaoSessaoId,
        horaInputLabel: formatHistoricoHorarioInput(v.minTs, v.maxTs),
        totalItens: v.total,
      })
    }
    out.sort((a, b) => {
      if (a.dataYmd !== b.dataYmd) return b.dataYmd.localeCompare(a.dataYmd)
      const c = a.conferenteNome.localeCompare(b.conferenteNome, 'pt-BR')
      if (c !== 0) return c
      const sa = a.finalizacaoSessaoId ?? ''
      const sb = b.finalizacaoSessaoId ?? ''
      return sa.localeCompare(sb, 'pt-BR')
    })
    return out
  }

  async function fetchResumoPainelDia(
    dataYmd: string,
  ): Promise<Map<string, PainelDiaResumo> | null> {
    const ymd = String(dataYmd ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
    try {
      const { data, error } = await supabase
        .from('v_contagem_diaria_painel')
        .select('conferente_id,itens_contados,inicio,fim,data_contagem')
        .eq('data_contagem', ymd)
      if (error) return null
      const out = new Map<string, PainelDiaResumo>()
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const id = String(r.conferente_id ?? '').trim()
        if (!id) continue
        const rawCount = Number(r.itens_contados ?? 0)
        const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : 0
        const inicio = String(r.inicio ?? '').trim() || null
        const fim = String(r.fim ?? '').trim() || null
        out.set(id, { count, inicio, fim })
      }
      return out
    } catch {
      return null
    }
  }

  async function loadHistoricoContagens() {
    if (!isDiaMode) return
    setHistoricoLoading(true)
    setHistoricoError('')
    try {
      const { rows: raw, origemAusenteNoResultado } = await fetchHistoricoRawRows()
      let items = await buildHistoricoLista(raw, origemAusenteNoResultado)
      // Alinha os números/horário do dia atual com a mesma fonte do painel da Contagem.
      const day = diaCivilFiltroAtual() ?? toYmdSP()
      const painelDia = await fetchResumoPainelDia(day)
      if (painelDia && painelDia.size > 0) {
        items = items.map((it) => {
          if (it.dataYmd !== day || !it.conferenteId) return it
          const p = painelDia.get(it.conferenteId)
          if (!p) return it
          const minTs = tsFromDataHoraContagem(p.inicio)
          const maxTs = tsFromDataHoraContagem(p.fim ?? p.inicio)
          return {
            ...it,
            totalItens: p.count,
            horaInputLabel: formatHistoricoHorarioInput(minTs, maxTs),
          }
        })
      }
      setHistoricoItems(items)
    } catch (e: unknown) {
      setHistoricoError(e instanceof Error ? e.message : 'Erro ao carregar histórico.')
    } finally {
      setHistoricoLoading(false)
    }
  }

  useEffect(() => {
    if (!isDiaMode) return
    void loadHistoricoContagens()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega histórico só ao entrar na aba
  }, [isDiaMode])

  async function loadFromHistoricoItem(item: HistoricoContagemItem) {
    setAllTime(false)
    setUseSingleDay(true)
    setSingleDay(item.dataYmd)
    setUseInventarioCols(false)
    setConferenteFiltroHistorico(item.conferenteId == null ? '__sem__' : item.conferenteId)
    setLoading(true)
    setError('')
    setSuccess('')
    setRows([])
    try {
      const { rows: data, successMessage, origemAusenteNoResultado } = await fetchRelatorioContagemRows({
        singleDayYmd: item.dataYmd,
        allTimeOverride: false,
        includeRascunho: true,
      })
      const fh = item.conferenteId == null ? '__sem__' : item.conferenteId
      let dataForPrevia = data
      if (fh === '__sem__') dataForPrevia = data.filter((r) => !String(r.conferente_id ?? '').trim())
      else dataForPrevia = data.filter((r) => String(r.conferente_id ?? '').trim() === fh)
      if (item.finalizacaoSessaoId != null) {
        dataForPrevia = dataForPrevia.filter(
          (r) => String(r.finalizacao_sessao_id ?? '').trim() === item.finalizacaoSessaoId,
        )
      } else {
        dataForPrevia = dataForPrevia.filter((r) => !String(r.finalizacao_sessao_id ?? '').trim())
      }
      const finalRows = await aplicarMesmaRegraDaPreviaAsync(dataForPrevia, origemAusenteNoResultado)
      setRows(finalRows)
      const baseMsg = successMessage ? `${successMessage} ` : ''
      setSuccess(
        `${baseMsg}Exibindo contagem de «${item.conferenteNome}» em ${formatDateBR(item.dataYmd)} (${item.totalItens} lançamento(s) neste dia).`,
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar relatório.')
    } finally {
      setLoading(false)
    }
    window.setTimeout(() => listaRelatorioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }

  async function limparFiltroHistorico() {
    setConferenteFiltroHistorico(null)
    await handleCarregarComAvisoPendencia()
  }

  function diaCivilFiltroAtual(): string | null {
    if (allTime) return null
    if (useSingleDay) return singleDay
    if (startDate === endDate) return startDate
    return null
  }

  async function avaliarUmDiaContagem(diaYmd: string): Promise<AvaliacaoUmDiaContagem> {
    const { rows: rowsComRascunho, origemAusenteNoResultado } = await fetchRelatorioContagemRows({
      singleDayYmd: diaYmd,
      allTimeOverride: false,
      includeRascunho: true,
    })
    const { filtered } = await filtrarLinhasParaPrevia(rowsComRascunho, origemAusenteNoResultado)
    const rowsDia = filtered.filter((r) => diaYmdSoDataContagemRow(r) === diaYmd)
    if (rowsDia.length === 0) return { kind: 'vazio' }
    const pendentes = rowsDia.filter((r) => r.contagem_rascunho === true)
    if (pendentes.length > 0) {
      const conferentes = new Set(
        pendentes
          .map((r) => String(r.conferente_id ?? '').trim())
          .filter((v) => v !== ''),
      )
      return {
        kind: 'pendente',
        aviso: {
          diaYmd,
          pendencias: pendentes.length,
          conferentes: conferentes.size || 1,
        },
      }
    }
    return { kind: 'ok' }
  }

  async function handleCarregarComAvisoPendencia() {
    if (loading) return
    try {
      setError('')
      setAvisoCargaPendente(null)
      setAvisoDiaSemContagem(null)
      if (!useInventarioCols) {
        const diaYmd = diaCivilFiltroAtual()
        if (diaYmd) {
          const ev = await avaliarUmDiaContagem(diaYmd)
          if (ev.kind === 'vazio' && useSingleDay) {
            setAvisoDiaSemContagem({ diaYmd })
            return
          }
          if (ev.kind === 'pendente') {
            setAvisoCargaPendente(ev.aviso)
            return
          }
        }
      }
      await load({ ignoreHistoricoFilter: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao verificar pendências antes de carregar.')
    }
  }

  async function load(opts?: { ignoreHistoricoFilter?: boolean }) {
    setLoading(true)
    setError('')
    setSuccess('')
    setRows([])
    try {
      const { rows: data, successMessage, origemAusenteNoResultado } = await fetchRelatorioContagemRows({
        includeRascunho: true,
      })
      let dataForPrevia = data
      const aplicarFiltroHistorico = isDiaMode && !opts?.ignoreHistoricoFilter
      if (aplicarFiltroHistorico && conferenteFiltroHistorico) {
        if (conferenteFiltroHistorico === '__sem__') {
          dataForPrevia = data.filter((r) => !String(r.conferente_id ?? '').trim())
        } else {
          dataForPrevia = data.filter((r) => String(r.conferente_id ?? '').trim() === conferenteFiltroHistorico)
        }
      }
      const finalRows = await aplicarMesmaRegraDaPreviaAsync(dataForPrevia, origemAusenteNoResultado)
      setRows(finalRows)
      if (successMessage) setSuccess(successMessage)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar relatório.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteRow(id: string) {
    const row = rows.find((r) => r.id === id)
    const idsToDelete = row ? relatorioSourceIdsParaAcao(row) : [id]
    const excluiSoUmConferente = false
    const msg = excluiSoUmConferente
      ? `Excluir ${idsToDelete.length} registro(s) deste conferente no banco?`
      : idsToDelete.length > 1
        ? `Excluir ${idsToDelete.length} registros no banco (agrupados como na prévia)?`
        : 'Deseja realmente excluir esta contagem?'
    if (!confirm(msg)) return
    setRowActionLoading(true)
    setError('')
    setSuccess('')

    if (useInventarioCols) {
      await deleteInventarioPlanilhaLinhasForContagensIds(supabase, idsToDelete)
    }
    for (const uid of idsToDelete) {
      const { error: delError } = await supabase.from('contagens_estoque').delete().eq('id', uid)
      if (delError) {
        setError(`Erro ao excluir: ${delError.message}`)
        setRowActionLoading(false)
        return
      }
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
    setSuccess(idsToDelete.length > 1 ? `${idsToDelete.length} registros excluídos.` : 'Contagem excluída com sucesso.')
    if (isDiaMode) void loadHistoricoContagens()
    setRowActionLoading(false)
  }

  async function handleSaveQuantidade(id: string) {
    const qtd = Number(editingQuantidade.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setError('Quantidade inválida para atualização.')
      return
    }

    const row = rows.find((r) => r.id === id)
    if (!row) {
      setError('Linha não encontrada.')
      return
    }
    if (!relatorioPodeEditarQuantidade(row)) {
      setError(
        'Selecione um conferente específico no seletor “Conferente na lista” acima para editar a quantidade deste produto.',
      )
      return
    }

    setRowActionLoading(true)
    setError('')
    setSuccess('')

    try {
      if (useInventarioCols) {
        const idsToUpdate = row.source_ids?.length ? row.source_ids : [id]
        for (const uid of idsToUpdate) {
          const { error: updError } = await supabase.from('contagens_estoque').update({ quantidade_up: qtd }).eq('id', uid)
          if (updError) {
            setError(`Erro ao atualizar quantidade: ${updError.message}`)
            return
          }
        }
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, quantidade_up: qtd } : r)))
        setSuccess(
          idsToUpdate.length > 1
            ? `Quantidade ${qtd} aplicada a ${idsToUpdate.length} registros agrupados.`
            : 'Quantidade atualizada com sucesso.',
        )
        setEditingId(null)
        setEditingQuantidade('')
        if (isDiaMode) void loadHistoricoContagens()
      } else {
        const sourceIds = relatorioSourceIdsParaAcao(row)
        const keepId = sourceIds[0]
        const { error: updError } = await supabase.from('contagens_estoque').update({ quantidade_up: qtd }).eq('id', keepId)
        if (updError) {
          setError(`Erro ao atualizar quantidade: ${updError.message}`)
          return
        }
        const otherIds = sourceIds.slice(1)
        if (otherIds.length) {
          const { error: delError } = await supabase.from('contagens_estoque').delete().in('id', otherIds)
          if (delError) {
            setError(`Erro ao consolidar registros: ${delError.message}`)
            return
          }
        }
        setSuccess('Quantidade atualizada com sucesso.')
        await load()
        if (isDiaMode) void loadHistoricoContagens()
        setEditingId(null)
        setEditingQuantidade('')
      }
    } finally {
      setRowActionLoading(false)
    }
  }

  /** Planilha com a mesma ordem de colunas da tela; `aoa_to_sheet` garante todas as linhas (sem depender só da página visível). */
  function formatRodadaRelatorioCell(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(Number(n))) return ''
    return formatContagemLabel(Number(n))
  }

  function buildRelatorioExcelAoa(rowsToExport: ContagemRow[]): (string | number)[][] {
    const header: (string | number)[] = []
    if (useInventarioCols) {
      header.push('Câmara', 'Rua', 'POS', 'Nível', 'Contagem')
    }
    header.push('Conferente')
    if (prevCol('codigo')) header.push('Código do produto')
    if (prevCol('descricao')) header.push('Descrição')
    if (prevCol('unidade')) header.push('Unidade de medida')
    if (prevCol('quantidade')) header.push('Quantidade contada')
    if (prevCol('data_fabricacao')) header.push('Data de fabricação')
    if (prevCol('data_validade')) header.push('Data de vencimento')
    if (prevCol('lote')) header.push('Lote')
    if (prevCol('up')) header.push('UP')
    if (prevCol('observacao')) header.push('Observação')
    if (prevCol('ean')) header.push('EAN')
    if (prevCol('dun')) header.push('DUN')
    if (prevCol('foto')) header.push('Foto')

    const aoa: (string | number)[][] = [header]
    for (const r of rowsToExport) {
      const row: (string | number)[] = []
      if (useInventarioCols) {
        const cam = inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem)
        row.push(cam === '—' ? '' : cam)
        row.push(r.planilha_rua != null && String(r.planilha_rua).trim() !== '' ? String(r.planilha_rua) : '')
        row.push(
          r.planilha_posicao != null && Number.isFinite(Number(r.planilha_posicao)) ? Number(r.planilha_posicao) : '',
        )
        row.push(r.planilha_nivel != null && Number.isFinite(Number(r.planilha_nivel)) ? Number(r.planilha_nivel) : '')
        row.push(formatRodadaRelatorioCell(r.inventario_numero_contagem))
      }
      {
        const nome = conferenteNomeRelatorio(r)
        row.push(nome === '—' ? '' : nome)
      }
      if (prevCol('codigo')) row.push(r.codigo_interno)
      if (prevCol('descricao')) row.push(r.descricao)
      if (prevCol('unidade')) row.push(r.unidade_medida ?? '')
      if (prevCol('quantidade')) row.push(r.quantidade_up)
      if (prevCol('data_fabricacao'))
        row.push(r.data_fabricacao ? formatDateBR(String(r.data_fabricacao).slice(0, 10)) : '')
      if (prevCol('data_validade'))
        row.push(r.data_validade ? formatDateBR(String(r.data_validade).slice(0, 10)) : '')
      if (prevCol('lote')) row.push(r.lote ?? '')
      if (prevCol('up')) row.push(r.up_adicional ?? '')
      if (prevCol('observacao')) row.push(r.observacao ?? '')
      if (prevCol('ean')) row.push(r.ean ?? '')
      if (prevCol('dun')) row.push(r.dun ?? '')
      if (prevCol('foto')) row.push(String(r.foto_base64 ?? '').trim() ? 'Com foto' : 'Sem foto')
      aoa.push(row)
    }
    return aoa
  }

  async function exportToExcel(opts?: { skipPendenciaCheck?: boolean }) {
    setExportExcelLoading(true)
    setError('')
    try {
      if (!opts?.skipPendenciaCheck && !useInventarioCols && isExportUmDiaCivil) {
        const diaAlvo = useSingleDay ? singleDay : startDate
        const {
          rows: rowsComRascunho,
          origemAusenteNoResultado: origemAusenteComRascunho,
        } = await fetchRelatorioContagemRows({ includeRascunho: true })
        const { filtered: filteredComRascunho } = await filtrarLinhasParaPrevia(
          rowsComRascunho,
          origemAusenteComRascunho,
        )
        const pendentesNoDia = filteredComRascunho.filter((r) => {
          const ymd = String(r.data_contagem ?? r.data_hora_contagem ?? '').slice(0, 10)
          return ymd === diaAlvo && r.contagem_rascunho === true
        })
        if (pendentesNoDia.length > 0) {
          const conferentesPendentes = Array.from(
            new Set(
              pendentesNoDia
                .map((r) => String(r.conferente_id ?? '').trim())
                .filter((v) => v !== ''),
            ),
          )
          setError(
            `Excel bloqueado: ainda há contagem pendente de finalização para ${conferentesPendentes.length || 1} conferente(s) em ${formatDateBR(diaAlvo)}. Aguarde todos finalizarem a contagem e tente novamente.`,
          )
          return
        }
      }

      const { rows: data, origemAusenteNoResultado } = await fetchRelatorioContagemRows()

      if (!useInventarioCols && isExportUmDiaCivil) {
        const { filtered } = await filtrarLinhasParaPrevia(data, origemAusenteNoResultado)
        if (!filtered.length) {
          setError('Nenhum registro no dia para exportar.')
          return
        }
        // Usa a mesma regra da listagem (inclui alinhamento com v_contagem_diaria_itens_painel).
        const sorted = await aplicarMesmaRegraDaPreviaAsync(data, origemAusenteNoResultado)
        const ws = XLSX.utils.aoa_to_sheet(buildRelatorioExcelAoa(sorted))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Contagens')
        const safeFile = dateRangeText.replace(/[/\\?*[\]:]/g, '-').replace(/\s+/g, '_')
        XLSX.writeFile(wb, `relatorio-contagem_${safeFile}.xlsx`)
        return
      }

      const exportRows = await aplicarMesmaRegraDaPreviaAsync(data, origemAusenteNoResultado)
      if (!exportRows.length) {
        setError('Nenhum registro no período para exportar.')
        return
      }
      const ws = XLSX.utils.aoa_to_sheet(buildRelatorioExcelAoa(exportRows))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Contagens')
      const safeFile = dateRangeText.replace(/[/\\?*[\]:]/g, '-').replace(/\s+/g, '_')
      XLSX.writeFile(wb, `relatorio-contagem_${safeFile}.xlsx`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar Excel.')
    } finally {
      setExportExcelLoading(false)
    }
  }

  async function handleExportarComAvisoPendencia() {
    if (loading || exportExcelLoading) return
    try {
      setError('')
      setAvisoExportPendente(null)
      if (!useInventarioCols && isExportUmDiaCivil) {
        const diaYmd = useSingleDay ? singleDay : startDate
        const ev = await avaliarUmDiaContagem(diaYmd)
        if (ev.kind === 'pendente') {
          setAvisoExportPendente(ev.aviso)
          return
        }
      }
      await exportToExcel()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao verificar pendências antes de exportar.')
    }
  }

  async function exportProdutosBaseExcel() {
    setBaseExportLoading(true)
    setError('')
    setSuccess('')
    try {
      const selFull = 'id,codigo_interno,descricao,unidade,ean,dun'
      const selLegado = 'id,codigo_interno,descricao,unidade_medida,ean,dun'
      const selBasico = 'id,codigo_interno,descricao,ean,dun'
      const candidates = [
        `${selFull},ean_alterado_em,dun_alterado_em`,
        `${selFull},ean_dun_alterado_em`,
        selFull,
        `${selLegado},ean_alterado_em,dun_alterado_em`,
        `${selLegado},ean_dun_alterado_em`,
        selLegado,
        `${selBasico},ean_alterado_em,dun_alterado_em`,
        `${selBasico},ean_dun_alterado_em`,
        selBasico,
      ]

      let data: Record<string, unknown>[] | null = null
      let qErr: { message?: string; code?: string } | null = null
      for (const cols of candidates) {
        const res = await supabase
          .from(TABELA_PRODUTOS_REL)
          .select(cols)
          .order('codigo_interno', { ascending: true })
          .limit(20000)
        data = res.data as Record<string, unknown>[] | null
        qErr = res.error
        if (!qErr) break
        if (!isColumnMissingErrorRel(qErr)) break
      }
      if (qErr) throw qErr

      const mapped = (data ?? []).map((r: Record<string, unknown>) => {
        const um = r.unidade ?? r.unidade_medida ?? r.UNIDADE
        const leg = r.ean_dun_alterado_em
        const legStr = leg != null && String(leg).trim() !== '' ? String(leg).slice(0, 10) : null
        const eanA = r.ean_alterado_em
        const dunA = r.dun_alterado_em
        const eanStr =
          eanA != null && String(eanA).trim() !== '' ? String(eanA).slice(0, 10) : legStr
        const dunStr =
          dunA != null && String(dunA).trim() !== '' ? String(dunA).slice(0, 10) : legStr
        return {
          codigo_interno: String(r.codigo_interno ?? r.codigo ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade: um != null && String(um).trim() !== '' ? String(um).trim() : null,
          ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean) : null,
          dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun) : null,
          ean_alterado_em: eanStr,
          dun_alterado_em: dunStr,
        }
      })
      const list = mapped.filter((r) => r.codigo_interno.trim() !== '')

      const sheetRows = list.map((r) => ({
        'Código do produto': r.codigo_interno,
        Descrição: r.descricao,
        'Unidade de medida': r.unidade ?? '',
        EAN: r.ean ?? '',
        DUN: r.dun ?? '',
        'Alteração EAN': formatDateBRFromYmd(r.ean_alterado_em),
        'Alteração DUN': formatDateBRFromYmd(r.dun_alterado_em),
      }))

      const ws = XLSX.utils.json_to_sheet(sheetRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Todos os Produtos')
      const stamp = toISODateLocal(new Date()).replace(/-/g, '')
      XLSX.writeFile(wb, `relatorio-base-todos-produtos_${stamp}.xlsx`)
      setSuccess(`Planilha exportada com ${list.length} produto(s) da base.`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao exportar a base de produtos.')
    } finally {
      setBaseExportLoading(false)
    }
  }

  const totalRel = rowsFiltradosLista.length
  const rangeFrom =
    totalRel === 0 ? 0 : relatorioShowAll ? 1 : (relatorioPageSafe - 1) * RELATORIO_PAGE_SIZE + 1
  const rangeTo =
    totalRel === 0 ? 0 : relatorioShowAll ? totalRel : Math.min(relatorioPageSafe * RELATORIO_PAGE_SIZE, totalRel)

  const relatorioNavStyleBtn = (disabled: boolean) => ({
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid var(--border, #ccc)',
    background: disabled ? 'rgba(255,255,255,0.08)' : 'var(--surface, #222)',
    color: 'var(--text, #eee)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    opacity: disabled ? 0.5 : 1,
  })

  const relatorioPagination = (
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
        {totalRel === 0
          ? ''
          : relatorioShowAll
            ? `Exibindo todos os ${totalRel} registros`
            : `${rangeFrom}–${rangeTo} de ${totalRel} · Página ${relatorioPageSafe} de ${relatorioTotalPages} · ${RELATORIO_PAGE_SIZE} por página`}
      </span>
      <button
        type="button"
        disabled={relatorioShowAll || relatorioPageSafe <= 1 || totalRel === 0}
        onClick={() => setRelatorioPage((p) => Math.max(1, p - 1))}
        style={relatorioNavStyleBtn(relatorioShowAll || relatorioPageSafe <= 1 || totalRel === 0)}
      >
        Anterior
      </button>
      <button
        type="button"
        disabled={relatorioShowAll || relatorioPageSafe >= relatorioTotalPages || totalRel === 0}
        onClick={() => setRelatorioPage((p) => Math.min(relatorioTotalPages, p + 1))}
        style={relatorioNavStyleBtn(
          relatorioShowAll || relatorioPageSafe >= relatorioTotalPages || totalRel === 0,
        )}
      >
        Próxima
      </button>
      {totalRel > RELATORIO_PAGE_SIZE ? (
        relatorioShowAll ? (
          <button
            type="button"
            onClick={() => {
              setRelatorioShowAll(false)
              setRelatorioPage(1)
            }}
            style={relatorioNavStyleBtn(false)}
          >
            Paginar ({RELATORIO_PAGE_SIZE} por página)
          </button>
        ) : (
          <button type="button" onClick={() => setRelatorioShowAll(true)} style={relatorioNavStyleBtn(false)}>
            Mostrar tudo
          </button>
        )
      ) : null}
    </div>
  )

  const relatorioConferenteGlobalBar =
    !useInventarioCols && conferentesRelatorioOpcoes.length > 0 ? (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 8,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--border, #ccc)',
          background: 'rgba(25, 118, 210, 0.08)',
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #555)', marginBottom: 6 }}>
            Conferentes com contagem nesta lista
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text, #222)' }}>
            {conferentesRelatorioOpcoes.map((o) => o.nome).join(' · ')}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            flex: '1 1 200px',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-muted, #555)' }}>
            Cada linha mantém o conferente que lançou o valor exibido.
          </div>
        </div>
      </div>
    ) : null

  const avisoOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(2,6,23,.66)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    padding: 16,
  }

  const avisoModalStyle: React.CSSProperties = {
    width: 'min(680px, 100%)',
    borderRadius: 12,
    padding: '16px 18px',
    border: '1px solid rgba(148,163,184,.35)',
    background: 'linear-gradient(170deg, rgba(15,23,42,.98), rgba(17,24,39,.98))',
    boxShadow: '0 20px 60px rgba(0,0,0,.5)',
    display: 'grid',
    gap: 12,
  }

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <h2>{isDiaMode ? 'Todas as contagens' : 'Relatório completo por data de contagem'}</h2>

      {isDiaMode ? (
        <section style={relPanelStyle}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18 }}>Histórico de contagens</h3>
            <button
              type="button"
              onClick={() => void loadHistoricoContagens()}
              disabled={historicoLoading}
              style={{
                ...relBtnDark,
                cursor: historicoLoading ? 'wait' : 'pointer',
                opacity: historicoLoading ? 0.85 : 1,
              }}
            >
              {historicoLoading ? 'Atualizando…' : 'Atualizar histórico'}
            </button>
          </div>
          {historicoError ? <div style={{ color: '#b00020', marginBottom: 8 }}>{historicoError}</div> : null}
          {historicoLoading && historicoItems.length === 0 ? (
            <div style={{ fontSize: 13, color: '#666' }}>Carregando histórico…</div>
          ) : null}
          {!historicoLoading && !historicoError && historicoItems.length === 0 ? (
            <div style={{ fontSize: 13, color: '#666' }}>Nenhuma contagem diária encontrada.</div>
          ) : null}
          {historicoItems.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Conferente</th>
                    <th style={thStyle}>Data da contagem</th>
                    <th style={thStyle}>Hora do registro</th>
                    <th style={thStyle}>Itens contados</th>
                    <th style={thStyle}> </th>
                  </tr>
                </thead>
                <tbody>
                  {historicoItems.map((item) => (
                    <tr
                      key={`${item.dataYmd}|${item.conferenteId ?? '__sem__'}|${item.finalizacaoSessaoId ?? '__legacy__'}`}
                    >
                      <td style={tdStyle}>{item.conferenteNome}</td>
                      <td style={tdStyle}>{formatDateBR(item.dataYmd)}</td>
                      <td style={tdStyle}>{item.horaInputLabel}</td>
                      <td style={tdStyle}>{item.totalItens}</td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => void loadFromHistoricoItem(item)}
                          disabled={loading}
                          style={miniBtnStyle}
                        >
                          Ver contagem
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <div ref={listaRelatorioRef} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <section style={{ ...relPanelStyle, marginTop: 0 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 18 }}>
            {isDiaMode ? 'Filtros da lista' : 'Relatório — filtros e exportação'}
          </h3>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 13,
              cursor: 'pointer',
              maxWidth: 900,
              lineHeight: 1.45,
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={useInventarioCols}
              onChange={(e) => setUseInventarioCols(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Usar colunas da tela <strong>Inventário</strong> (Câmara, Rua, POS, Nível, rodada). Desmarcado ={' '}
              <strong>Contagem diária</strong>.
            </span>
          </label>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, minmax(0, 1fr))',
              gap: 12,
              alignItems: 'end',
              marginBottom: 12,
            }}
          >
            <label
              style={{
                ...relToolbarLabelStyle,
                gridColumn: isMobile ? 'auto' : useInventarioCols ? 'span 4' : 'span 6',
              }}
            >
              Início
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={allTime || useSingleDay}
                style={relToolbarInputStyle}
              />
            </label>

            <label
              style={{
                ...relToolbarLabelStyle,
                gridColumn: isMobile ? 'auto' : useInventarioCols ? 'span 4' : 'span 6',
              }}
            >
              Fim
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={allTime || useSingleDay}
                style={relToolbarInputStyle}
              />
            </label>

            {useInventarioCols ? (
              <label style={{ ...relToolbarLabelStyle, gridColumn: isMobile ? 'auto' : 'span 4' }}>
                Nº contagem (inventário)
                <select
                  value={numeroContagemFilter}
                  onChange={(e) => setNumeroContagemFilter(e.target.value as typeof numeroContagemFilter)}
                  style={relToolbarInputStyle}
                  title="Filtra pela rodada do inventário (1ª a 4ª)."
                >
                  <option value="todas">Todas</option>
                  <option value="1">1ª contagem</option>
                  <option value="2">2ª contagem</option>
                  <option value="3">3ª contagem</option>
                  <option value="4">4ª contagem</option>
                </select>
              </label>
            ) : null}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, minmax(0, 1fr))',
              gap: 12,
              alignItems: 'end',
              marginBottom: 12,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                gridColumn: isMobile ? 'auto' : 'span 4',
              }}
            >
              <input
                type="checkbox"
                checked={allTime}
                disabled={useSingleDay}
                onChange={(e) => {
                  const v = e.target.checked
                  setAllTime(v)
                  if (v) setUseSingleDay(false)
                }}
              />
              Carregar todas as datas
            </label>

            <div
              style={{
                gridColumn: isMobile ? 'auto' : 'span 8',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 13,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={useSingleDay}
                  onChange={(e) => {
                    const v = e.target.checked
                    setUseSingleDay(v)
                    if (v) setAllTime(false)
                  }}
                />
                Filtrar por dia
              </label>
              <input
                type="date"
                value={singleDay}
                onChange={(e) => setSingleDay(e.target.value)}
                disabled={!useSingleDay}
                style={relToolbarInputStyle}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: isMobile
                ? '1fr'
                : showExportExcel
                  ? 'repeat(3, minmax(150px, 1fr))'
                  : 'repeat(1, minmax(200px, 1fr))',
              gap: 10,
              alignItems: 'stretch',
              padding: isMobile ? 0 : '10px 12px',
              borderRadius: 10,
              border: isMobile ? 'none' : '1px solid var(--border, #4b4b4b)',
              background: isMobile ? 'transparent' : 'rgba(255,255,255,0.03)',
            }}
          >
            <button
              type="button"
              onClick={() => void handleCarregarComAvisoPendencia()}
              disabled={loading}
              style={{
                ...relBtnCarregar,
                width: '100%',
                minHeight: 44,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.85 : 1,
              }}
            >
              <span className="app-nav-icon app-nav-icon--bounce" aria-hidden>
                📥
              </span>
              {loading ? 'Carregando...' : `Carregar (${dateRangeText})`}
            </button>

            {showExportExcel ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportarComAvisoPendencia()}
                  disabled={loading || exportExcelLoading}
                  style={{
                    ...relBtnExcel,
                    width: '100%',
                    minHeight: 44,
                    cursor: loading || exportExcelLoading ? 'not-allowed' : 'pointer',
                    opacity: loading || exportExcelLoading ? 0.5 : 1,
                  }}
                  title={
                    !useInventarioCols && isExportUmDiaCivil
                      ? 'Exporta o dia com uma aba por conferente (contagem diária). Períodos com vários dias ou modo Inventário: uma aba «Contagens».'
                      : 'Busca de novo no banco todos os registros do filtro (data, nº contagem, etc.) e gera o .xlsx completo — não só a página visível na tela.'
                  }
                >
                  <span className="app-nav-icon app-nav-icon--pulse" aria-hidden>
                    📊
                  </span>
                  {exportExcelLoading ? 'Exportando…' : 'Exportar Excel'}
                </button>
                <button
                  type="button"
                  onClick={() => void exportProdutosBaseExcel()}
                  disabled={baseExportLoading}
                  style={{
                    ...relBtnBaseExport,
                    width: '100%',
                    minHeight: 44,
                    cursor: baseExportLoading ? 'wait' : 'pointer',
                    opacity: baseExportLoading ? 0.7 : 1,
                  }}
                  title="Baixar planilha .xlsx da base Todos os Produtos (códigos, EAN, DUN e datas de alteração), sem filtro de data"
                >
                  <span className="app-nav-icon app-nav-icon--pulse" aria-hidden>
                    📄
                  </span>
                  {baseExportLoading ? 'Exportando…' : 'Exportar Relatorio Alteração DUN/EAN'}
                </button>
              </>
            ) : null}
          </div>
        </section>

        {error ? <div style={{ color: '#b00020' }}>{error}</div> : null}
        {success ? <div style={{ color: '#0f7a0f' }}>{success}</div> : null}
        {conferenteFiltroHistorico ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(25, 118, 210, 0.08)',
              border: '1px solid rgba(25, 118, 210, 0.35)',
              fontSize: 13,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'space-between',
            }}
          >
            <span>
              Filtro do histórico ativo: a lista mostra só o conferente escolhido. «Limpar» volta ao carregamento normal do
              período (sem esse filtro).
            </span>
            <button
              type="button"
              onClick={() => void limparFiltroHistorico()}
              disabled={loading}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #1976d2',
                background: '#fff',
                color: '#1565c0',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              Limpar filtro do histórico
            </button>
          </div>
        ) : null}

        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            {relatorioConferenteGlobalBar}
            {relatorioPagination}
            {rowsFiltradosLista.length > 0 ? (
            <table
              style={{
                borderCollapse: 'collapse',
                width: '100%',
                minWidth: Math.max(520, relatorioListaColCount * 140),
              }}
            >
              <thead>
                <tr>
                  {useInventarioCols ? (
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
              <tbody>
                {displayRows.map((r) => {
                  const hasPhoto = Boolean(String(r.foto_base64 ?? '').trim())
                  const datasOrdemInvalida = isVencimentoAntesFabricacao(r.data_fabricacao, r.data_validade)
                  return (
                  <tr
                    key={r.id}
                    style={
                      datasOrdemInvalida
                        ? {
                            background: 'rgba(198, 40, 40, 0.14)',
                            boxShadow: 'inset 0 0 0 1px rgba(198, 40, 40, 0.45)',
                          }
                        : undefined
                    }
                  >
                    {useInventarioCols ? (
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
                        <td style={tdStyle}>
                          {r.inventario_numero_contagem != null && Number.isFinite(Number(r.inventario_numero_contagem))
                            ? formatContagemLabel(Number(r.inventario_numero_contagem))
                            : '—'}
                        </td>
                      </>
                    ) : null}
                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 260 }}>{conferenteNomeRelatorio(r)}</td>
                    {prevCol('codigo') ? <td style={tdStyle}>{r.codigo_interno}</td> : null}
                    {prevCol('descricao') ? (
                      <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>{r.descricao}</td>
                    ) : null}
                    {prevCol('unidade') ? <td style={tdStyle}>{r.unidade_medida ?? ''}</td> : null}
                    {prevCol('quantidade') ? (
                      <td style={tdStyle}>
                        {editingId === r.id ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={editingQuantidade}
                            onChange={(e) => setEditingQuantidade(e.target.value)}
                            style={{ ...inputInlineStyle }}
                          />
                        ) : (
                          relatorioQuantidadeExibida(r)
                        )}
                      </td>
                    ) : null}
                    {prevCol('data_fabricacao') ? (
                      <td style={tdStyle}>
                        {r.data_fabricacao ? formatDateBR(String(r.data_fabricacao).slice(0, 10)) : ''}
                      </td>
                    ) : null}
                    {prevCol('data_validade') ? (
                      <td style={tdStyle}>
                        {r.data_validade ? formatDateBR(String(r.data_validade).slice(0, 10)) : ''}
                      </td>
                    ) : null}
                    {prevCol('lote') ? <td style={tdStyle}>{r.lote ?? ''}</td> : null}
                    {prevCol('up') ? <td style={tdStyle}>{r.up_adicional ?? ''}</td> : null}
                    {prevCol('observacao') ? <td style={tdStyle}>{r.observacao ?? ''}</td> : null}
                    {prevCol('ean') ? <td style={tdStyle}>{r.ean ?? ''}</td> : null}
                    {prevCol('dun') ? <td style={tdStyle}>{r.dun ?? ''}</td> : null}
                    {prevCol('foto') ? (
                      <td style={tdStyle}>
                        <span style={{ color: 'var(--text-muted, #888)', fontSize: 12 }}>
                          {hasPhoto ? 'Com foto' : 'Sem foto'}
                        </span>
                      </td>
                    ) : null}
                    {prevCol('acoes') ? (
                      <td style={tdStyle}>
                        {editingId === r.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => handleSaveQuantidade(r.id)}
                              disabled={rowActionLoading}
                              style={miniBtnStyle}
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null)
                                setEditingQuantidade('')
                              }}
                              disabled={rowActionLoading}
                              style={miniBtnStyle}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              title={
                                !relatorioPodeEditarQuantidade(r)
                                  ? 'Selecione um conferente no seletor “Quantidade por conferente” acima que corresponda a esta linha para editar a quantidade'
                                  : undefined
                              }
                              onClick={() => {
                                setEditingId(r.id)
                                setEditingQuantidade(String(relatorioQuantidadeExibida(r)))
                              }}
                              disabled={rowActionLoading || !relatorioPodeEditarQuantidade(r)}
                              style={miniBtnStyle}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(r.id)}
                              disabled={rowActionLoading}
                              style={miniBtnStyle}
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                  )
                })}
              </tbody>
            </table>
            ) : null}
            {totalRel > 0 ? relatorioPagination : null}
          </div>
        ) : (
          !loading ? <div style={{ marginTop: 8 }}>Sem dados no período.</div> : null
        )}
      </div>

      {avisoCargaPendente ? (
        <div style={avisoOverlayStyle}>
          <div style={{ ...avisoModalStyle, border: '1px solid rgba(245,158,11,.45)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fef3c7' }}>Atenção sobre a contagem do dia</div>
            <div style={{ color: '#fde68a', fontSize: 14, lineHeight: 1.5 }}>
              A contagem ainda não foi finalizada por todos os conferentes. Deseja carregar o que já foi contado assim
              mesmo? Se carregar agora, poderão aparecer itens com quantidade zerada.
              {avisoCargaPendente.pendencias > 0 ? (
                <>
                  {' '}
                  Há <strong>{avisoCargaPendente.pendencias}</strong> lançamento(s) pendente(s) em{' '}
                  <strong>{formatDateBR(avisoCargaPendente.diaYmd)}</strong>, envolvendo{' '}
                  <strong>{avisoCargaPendente.conferentes}</strong> conferente(s).
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setAvisoCargaPendente(null)
                  void load({ ignoreHistoricoFilter: true })
                }}
                disabled={loading}
                style={{ ...miniBtnStyle, background: '#2563eb', border: '1px solid #60a5fa', color: '#eff6ff' }}
              >
                Carregar
              </button>
              <button
                type="button"
                onClick={() => setAvisoCargaPendente(null)}
                style={{ ...miniBtnStyle, background: 'transparent', border: '1px solid rgba(245,158,11,.55)', color: '#fde68a' }}
              >
                Aguardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {avisoDiaSemContagem ? (
        <div style={avisoOverlayStyle}>
          <div style={{ ...avisoModalStyle, border: '1px solid rgba(148,163,184,.5)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0' }}>Nenhuma contagem neste dia</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setAvisoDiaSemContagem(null)}
                style={{ ...miniBtnStyle, background: '#2563eb', border: '1px solid #60a5fa', color: '#eff6ff' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {avisoExportPendente ? (
        <div style={avisoOverlayStyle}>
          <div style={{ ...avisoModalStyle, border: '1px solid rgba(56,189,248,.45)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#e0f2fe' }}>Atenção na exportação do dia</div>
            <div style={{ color: '#bae6fd', fontSize: 14, lineHeight: 1.5 }}>
              A contagem ainda não foi finalizada por todos os conferentes. Deseja exportar o que já foi contado assim
              mesmo? Se exportar agora, a planilha poderá incluir itens com quantidade zerada.
              {avisoExportPendente.pendencias > 0 ? (
                <>
                  {' '}
                  Há <strong>{avisoExportPendente.pendencias}</strong> lançamento(s) pendente(s) em{' '}
                  <strong>{formatDateBR(avisoExportPendente.diaYmd)}</strong>, envolvendo{' '}
                  <strong>{avisoExportPendente.conferentes}</strong> conferente(s).
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setAvisoExportPendente(null)
                  void exportToExcel({ skipPendenciaCheck: true })
                }}
                disabled={loading || exportExcelLoading}
                style={{ ...miniBtnStyle, background: '#2563eb', border: '1px solid #60a5fa', color: '#eff6ff' }}
              >
                Exportar
              </button>
              <button
                type="button"
                onClick={() => setAvisoExportPendente(null)}
                style={{ ...miniBtnStyle, background: 'transparent', border: '1px solid rgba(56,189,248,.55)', color: '#bae6fd' }}
              >
                Aguardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  )
}

const thStyle: React.CSSProperties = {
  borderBottom: '1px solid #3a3b45',
  textAlign: 'left',
  padding: 8,
  fontWeight: 700,
  fontSize: 13,
  background: '#1d1e24',
  color: '#fff',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: 8,
  fontSize: 13,
  whiteSpace: 'nowrap',
}

const miniBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #222',
  background: '#111',
  color: 'white',
  cursor: 'pointer',
  fontSize: 12,
}

const inputInlineStyle: React.CSSProperties = {
  width: 110,
  padding: '6px 8px',
  border: '1px solid #ccc',
  borderRadius: 6,
}

