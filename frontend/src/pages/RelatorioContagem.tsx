import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'
import { loadChecklistVisibleColsFromStorage } from '../lib/checklistVisibleCols'
import { enrichContagemRowsWithPlanilhaLinhas } from '../lib/enrichContagemRowsWithPlanilhaLinhas'
import { enrichContagemRowsEanDunFromTodosOsProdutos } from '../lib/enrichContagemRowsEanDunFromTodosOsProdutos'
import { fetchConferentesNomesPorIds } from '../lib/conferentesNomesBatch'
import {
  agruparContagemDiariaComoPrevia,
  fetchPlanilhaContagemIdsParaIntervalo,
  filterContagensPorModoListagem,
  ordenarLinhasInventarioComoPrevia,
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
  /** Preenchido a partir de `inventario_planilha_linhas` (inventário formato planilha). */
  planilha_grupo_armazem?: number | null
  planilha_rua?: string | null
  planilha_posicao?: number | null
  planilha_nivel?: number | null
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

/** Colunas fixas antes da checklist: Câmara, Rua, POS, Nível, Contagem (rodada), Conferente. */
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

/** Paginação (15 + “Mostrar tudo”) vale para Relatório completo e Todas as contagens — mesmo componente. */
const RELATORIO_PAGE_SIZE = 15
/** PostgREST costuma limitar ~1000 linhas por requisição; buscamos em fatias para trazer o relatório inteiro. */
const RELATORIO_FETCH_CHUNK = 2000

type RelatorioContagemProps = {
  mode?: 'periodo' | 'dia'
  /** Valor inicial: última tela Contagem vs Inventário (sessionStorage no App). */
  listColumnPrefsInventario?: boolean
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

  /** Preferências de colunas: inventário vs contagem diária (toggle ou valor vindo do App). */
  const [useInventarioCols, setUseInventarioCols] = useState(listColumnPrefsInventario)

  const isDiaMode = mode === 'dia'
  /** Excel só no relatório por período — nunca em “Todas as contagens” (`mode="dia"`). */
  const showExportExcel = mode === 'periodo'

  const listColPrefs = useMemo(() => loadChecklistVisibleColsFromStorage(useInventarioCols), [useInventarioCols])
  const prevCol = (id: string) => listColPrefs[id] !== false
  const relatorioListaColCount = useMemo(
    () =>
      RELATORIO_COLS_PLANILHA_LOCAL +
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
    [listColPrefs],
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

  const dateRangeText = useMemo(() => {
    if (allTime) return 'Todas as datas'
    if (useSingleDay) return `Dia: ${formatDateBR(singleDay)}`
    return `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`
  }, [allTime, useSingleDay, singleDay, startDate, endDate])

  const relatorioTotalPages = Math.max(1, Math.ceil(rows.length / RELATORIO_PAGE_SIZE))
  const relatorioPageSafe = Math.min(relatorioPage, relatorioTotalPages)
  const displayRows = useMemo(() => {
    if (relatorioShowAll) return rows
    const start = (relatorioPageSafe - 1) * RELATORIO_PAGE_SIZE
    return rows.slice(start, start + RELATORIO_PAGE_SIZE)
  }, [rows, relatorioPageSafe, relatorioShowAll])

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setRelatorioPage(1)
      setRelatorioShowAll(false)
    }
    prevLoadingRef.current = loading
  }, [loading])

  async function fetchRelatorioContagemRows(): Promise<{
    rows: ContagemRow[]
    successMessage?: string
    /** Igual à prévia quando `origem` não existe no banco (fallback SQL). */
    origemAusenteNoResultado: boolean
  }> {
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
      origem,
      inventario_repeticao,
      inventario_numero_contagem
    `
    const selectCompletoCompact = selectCompleto.replace(/\s+/g, '')

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
      origem,
      inventario_repeticao,
      inventario_numero_contagem
    `
    const selectFlatCompletoCompact = selectFlatCompleto.replace(/\s+/g, '')

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

    const applyNumeroInventario = (
      q: ReturnType<typeof supabase.from<'contagens_estoque'>>,
      withNumeroFilter: boolean,
    ) => {
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

      if (allTime) {
        return fetchAllPaged(() => base())
      }

      if (useSingleDay) {
        const startIso = `${singleDay}T00:00:00`
        const endIso = `${singleDay}T23:59:59`
        const [a, b] = await Promise.all([
          fetchAllPaged(() => base().eq('data_contagem', singleDay)),
          fetchAllPaged(() =>
            base()
              .is('data_contagem', null)
              .gte('data_hora_contagem', startIso)
              .lte('data_hora_contagem', endIso),
          ),
        ])
        return mergeContagemRowsById(a, b)
      }

      const startIso = `${startDate}T00:00:00`
      const endIso = `${endDate}T23:59:59`
      const [a, b] = await Promise.all([
        fetchAllPaged(() => base().gte('data_contagem', startDate).lte('data_contagem', endDate)),
        fetchAllPaged(() =>
          base()
            .is('data_contagem', null)
            .gte('data_hora_contagem', startIso)
            .lte('data_hora_contagem', endIso),
        ),
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
      const data = await fetchRowsComFallbackEmbed(selectCompletoCompact, selectFlatCompletoCompact, true)
      return {
        rows: await enrichPlanilhaEConferente(mapSemOrigem(data)),
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
          rows: await enrichPlanilhaEConferente(mapSemOrigem(injectNumeroSeFiltroAtivo(data))),
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
        const data = await fetchRowsComFallbackEmbed(
          selectSemColunasInventarioCompact,
          selectFlatSemColunasInventarioCompact,
          false,
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
        const mapped = data.map((r) => ({
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

  /** Mesma regra da prévia em ContagemEstoque: filtro origem/planilha + ordem (inventário) ou agrupamento (contagem diária). */
  async function aplicarMesmaRegraDaPreviaAsync(
    data: ContagemRow[],
    origemAusenteNoResultado: boolean,
  ): Promise<ContagemRow[]> {
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
    const planilhaIds = await fetchPlanilhaContagemIdsParaIntervalo(supabase, minY, maxY)
    const modo = useInventarioCols ? 'inventario' : 'contagem_diaria'
    const asRec = data.map((r) => ({ ...r }) as Record<string, unknown>)
    const filtered = filterContagensPorModoListagem(asRec, modo, planilhaIds, origemAusenteNoResultado)
    if (useInventarioCols) {
      let inv = ordenarLinhasInventarioComoPrevia(filtered) as ContagemRow[]
      if (numeroContagemFilter !== 'todas') {
        const n = Number(numeroContagemFilter)
        inv = inv.filter((r) => Number(r.inventario_numero_contagem ?? NaN) === n)
      }
      return inv
    }
    return agruparContagemDiariaComoPrevia(filtered as ContagemRow[]) as ContagemRow[]
  }

  async function load() {
    setLoading(true)
    setError('')
    setSuccess('')
    setRows([])
    try {
      const { rows: data, successMessage, origemAusenteNoResultado } = await fetchRelatorioContagemRows()
      const finalRows = await aplicarMesmaRegraDaPreviaAsync(data, origemAusenteNoResultado)
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
    const idsToDelete = row?.source_ids?.length ? row.source_ids : [id]
    const msg =
      idsToDelete.length > 1
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
    setRowActionLoading(false)
  }

  async function handleSaveQuantidade(id: string) {
    const qtd = Number(editingQuantidade.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setError('Quantidade inválida para atualização.')
      return
    }

    setRowActionLoading(true)
    setError('')
    setSuccess('')

    const row = rows.find((r) => r.id === id)
    const idsToUpdate = row?.source_ids?.length ? row.source_ids : [id]

    for (const uid of idsToUpdate) {
      const { error: updError } = await supabase.from('contagens_estoque').update({ quantidade_up: qtd }).eq('id', uid)
      if (updError) {
        setError(`Erro ao atualizar quantidade: ${updError.message}`)
        setRowActionLoading(false)
        return
      }
    }

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, quantidade_up: qtd } : r)))
    setEditingId(null)
    setEditingQuantidade('')
    setSuccess(
      idsToUpdate.length > 1
        ? `Quantidade ${qtd} aplicada a ${idsToUpdate.length} registros agrupados.`
        : 'Quantidade atualizada com sucesso.',
    )
    setRowActionLoading(false)
  }

  /** Planilha com a mesma ordem de colunas da tela; `aoa_to_sheet` garante todas as linhas (sem depender só da página visível). */
  function formatRodadaRelatorioCell(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(Number(n))) return ''
    return formatContagemLabel(Number(n))
  }

  function buildRelatorioExcelAoa(rowsToExport: ContagemRow[]): (string | number)[][] {
    const header: (string | number)[] = ['Câmara', 'Rua', 'POS', 'Nível', 'Contagem', 'Conferente']
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
      const cam = inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem)
      row.push(cam === '—' ? '' : cam)
      row.push(r.planilha_rua != null && String(r.planilha_rua).trim() !== '' ? String(r.planilha_rua) : '')
      row.push(
        r.planilha_posicao != null && Number.isFinite(Number(r.planilha_posicao)) ? Number(r.planilha_posicao) : '',
      )
      row.push(r.planilha_nivel != null && Number.isFinite(Number(r.planilha_nivel)) ? Number(r.planilha_nivel) : '')
      row.push(formatRodadaRelatorioCell(r.inventario_numero_contagem))
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

  async function exportToExcel() {
    setExportExcelLoading(true)
    setError('')
    try {
      const { rows: data, origemAusenteNoResultado } = await fetchRelatorioContagemRows()
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

  const totalRel = rows.length
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

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <h2>{isDiaMode ? 'Todas as contagens' : 'Relatório completo por data de contagem'}</h2>

      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted, #888)', lineHeight: 1.45 }}>
        O período e o &quot;filtrar por dia&quot; usam o <strong>dia civil da contagem</strong> (campo gravado na
        sessão), alinhado ao que você vê na tela de contagem — não só o relógio do momento em que salvou. Registros
        muito antigos sem esse campo usam a data/hora do registro.
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted, #888)', lineHeight: 1.45 }}>
        A lista abaixo usa a <strong>mesma regra da prévia</strong> em Contagem/Inventário: colunas &quot;Inventário
        físico&quot; mostram só inventário (e a mesma ordem); &quot;Contagem diária&quot; agrupa por dia+código como na
        prévia. IDs em <code style={{ fontSize: 12 }}>inventario_planilha_linhas</code> entram no filtro como na prévia.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            Início
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={allTime || useSingleDay}
              style={{ padding: '10px 10px', border: '1px solid #ccc', borderRadius: 8 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            Fim
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={allTime || useSingleDay}
              style={{ padding: '10px 10px', border: '1px solid #ccc', borderRadius: 8 }}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
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
            </div>
            <input
              type="date"
              value={singleDay}
              onChange={(e) => setSingleDay(e.target.value)}
              disabled={!useSingleDay}
              style={{ padding: '10px 10px', border: '1px solid #ccc', borderRadius: 8 }}
            />
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            Nº contagem (inventário)
            <select
              value={numeroContagemFilter}
              onChange={(e) => setNumeroContagemFilter(e.target.value as typeof numeroContagemFilter)}
              disabled={!useInventarioCols}
              style={{
                padding: '10px 10px',
                border: '1px solid #ccc',
                borderRadius: 8,
                minWidth: 160,
                opacity: useInventarioCols ? 1 : 0.55,
              }}
              title={
                useInventarioCols
                  ? 'Filtra pela rodada do inventário (1ª a 4ª).'
                  : 'Ative “colunas de Inventário” acima para filtrar pela rodada (1ª–4ª).'
              }
            >
              <option value="todas">Todas</option>
              <option value="1">1ª contagem</option>
              <option value="2">2ª contagem</option>
              <option value="3">3ª contagem</option>
              <option value="4">4ª contagem</option>
            </select>
          </label>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #222',
              background: '#111',
              color: 'white',
              cursor: 'pointer',
              height: 40,
            }}
          >
            {loading ? 'Carregando...' : `Carregar (${dateRangeText})`}
          </button>

          {showExportExcel ? (
            <>
              <button
                type="button"
                onClick={() => void exportToExcel()}
                disabled={loading || exportExcelLoading}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #1b5e20',
                  background: '#2e7d32',
                  color: 'white',
                  cursor: loading || exportExcelLoading ? 'not-allowed' : 'pointer',
                  height: 40,
                  opacity: loading || exportExcelLoading ? 0.5 : 1,
                }}
                title="Busca de novo no banco todos os registros do filtro (data, nº contagem, etc.) e gera o .xlsx completo — não só a página visível na tela."
              >
                {exportExcelLoading ? 'Exportando…' : 'Exportar Excel'}
              </button>
              <button
                type="button"
                onClick={() => void exportProdutosBaseExcel()}
                disabled={baseExportLoading}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #1565c0',
                  background: '#1976d2',
                  color: 'white',
                  cursor: baseExportLoading ? 'wait' : 'pointer',
                  height: 40,
                  opacity: baseExportLoading ? 0.7 : 1,
                }}
                title="Baixar planilha .xlsx da base Todos os Produtos (códigos, EAN, DUN e datas de alteração), sem filtro de data"
              >
                {baseExportLoading ? 'Exportando…' : 'Exportar Relatorio Alteração DUN/EAN'}
              </button>
            </>
          ) : null}
        </div>

        {error ? <div style={{ color: '#b00020' }}>{error}</div> : null}
        {success ? <div style={{ color: '#0f7a0f' }}>{success}</div> : null}

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: 13,
            marginTop: 10,
            cursor: 'pointer',
            maxWidth: 720,
            lineHeight: 1.45,
          }}
        >
          <input
            type="checkbox"
            checked={useInventarioCols}
            onChange={(e) => setUseInventarioCols(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            Usar colunas salvas na tela <strong>Inventário</strong> (desmarcado = <strong>Contagem diária</strong>). Por
            padrão, usa a última lista que você abriu no painel (Contagem ou Inventário).
          </span>
        </label>
        <p style={{ fontSize: 13, color: 'var(--text, #666)', marginTop: 8, maxWidth: 720, lineHeight: 1.45 }}>
          Mesmas colunas que a lista — controle em <strong>Ocultar/mostrar colunas</strong> na tela correspondente.
        </p>

        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            {relatorioPagination}
            <table
              style={{
                borderCollapse: 'collapse',
                width: '100%',
                minWidth: Math.max(520, relatorioListaColCount * 140),
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Câmara</th>
                  <th style={thStyle}>Rua</th>
                  <th style={thStyle}>POS</th>
                  <th style={thStyle}>Nível</th>
                  <th style={thStyle}>Contagem</th>
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
                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 200 }}>
                      {conferenteNomeRelatorio(r)}
                    </td>
                    {prevCol('codigo') ? <td style={tdStyle}>{r.codigo_interno}</td> : null}
                    {prevCol('descricao') ? (
                      <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 420 }}>{r.descricao}</td>
                    ) : null}
                    {prevCol('unidade') ? <td style={tdStyle}>{r.unidade_medida ?? ''}</td> : null}
                    {prevCol('quantidade') ? (
                      <td style={tdStyle}>
                        {editingId === r.id ? (
                          <input
                            type="number"
                            step="0.001"
                            value={editingQuantidade}
                            onChange={(e) => setEditingQuantidade(e.target.value)}
                            style={{ ...inputInlineStyle }}
                          />
                        ) : (
                          r.quantidade_up
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
                              onClick={() => {
                                setEditingId(r.id)
                                setEditingQuantidade(String(r.quantidade_up))
                              }}
                              disabled={rowActionLoading}
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
            {totalRel > 0 ? relatorioPagination : null}
          </div>
        ) : (
          !loading ? <div style={{ marginTop: 8 }}>Sem dados no período.</div> : null
        )}
      </div>

    </div>
  )
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

