import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { ComparativoLinhasSvgChart, type SvgChartSeries } from '../components/ComparativoLinhasSvgChart'

const SHEET_ID = '1KBDdsl4GeQL97mAvJS_J7uf0a6M7LRr0fHtPZE_QFhU'
const SHEET_GID = '1626679618'
/** Um aviso automático por dia (após carregar os dados do dia). */
const LS_AVISO_DIARIO_YMD = 'estoque-seguranca.aviso-amarelo-vermelho.ymd'

function todayYmdLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const COLUNAS = [
  'Categoria',
  'Pedido Méd. Abril',
  'Pedido Máx. Abril',
  'Média ult. 5 dias',
  'Estoque Ideal Máximo',
  'Estoque Ideal Médio',
  'Estoque Ideal Mínimo',
  'Dias de Estoque Máximo',
  'Dias de Estoque Médio',
  'Dias de Estoque Mínimo',
  'Posições Máximo',
  'Posições Média',
  'Posições Mínimo',
  'Estoque Atual',
  'Posição Atual',
  'Para condicional',
  'Estoque Atual ( comparação de 5 Dias)',
  'Estoque Atual (comparação mensal)',
] as const

type Coluna = (typeof COLUNAS)[number]
type DataRow = Record<Coluna, string>
/** Linha da planilha com colunas extras para a lista (SKU / DESCRIÇÃO vêm do CSV, fora de COLUNAS). */
type RowLista = DataRow & { sku: string; descricao: string }
type CondClass = 'Excedido' | 'Verde' | 'Amarelo' | 'Vermelho' | 'Analisar'

type GraficoFiltro = null | { kind: 'sku'; label: string } | { kind: 'cond'; cond: CondClass }

const CONDICIONAL_LABELS: CondClass[] = ['Excedido', 'Verde', 'Amarelo', 'Vermelho', 'Analisar']

/** Cores alinhadas aos botões semaforicos da lista. */
const SEMAFORO_CORES_BARRA = ['#7c3aed', '#16a34a', '#ca8a04', '#dc2626', '#db2777'] as const
const SEMAFORO_BORDA_BARRA = ['#6d28d9', '#15803d', '#a16207', '#b91c1c', '#be185d'] as const

function labelForRow(r: RowLista, allRows: RowLista[]): string {
  if (allRows.some((x) => x.sku.trim() !== '')) {
    return r.sku.trim() || '(sem SKU)'
  }
  return r.Categoria || '(sem categoria)'
}

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function parseNumberBR(raw: string): number {
  const txt = String(raw || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
  const n = Number(txt)
  return Number.isFinite(n) ? n : 0
}

function parseCsv(csvText: string): string[][] {
  const lines = String(csvText || '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const sep = lines[0]?.includes('\t') ? '\t' : ','
  return lines.map((line) => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        const next = line[i + 1]
        if (inQuotes && next === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === sep && !inQuotes) {
        out.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur.trim())
    return out
  })
}

function isHtmlResponse(txt: string): boolean {
  return /<html|<!doctype html|sign in|google sheets/i.test(txt)
}

function calcCond(row: DataRow | RowLista): CondClass {
  const v = parseNumberBR(row['Estoque Atual']) // V
  const r = parseNumberBR(row['Estoque Ideal Mínimo']) // R
  const s = parseNumberBR(row['Estoque Ideal Máximo']) // S
  const t = parseNumberBR(row['Estoque Ideal Médio']) // T
  if (v > r) return 'Excedido'
  if (v >= s) return 'Verde'
  if (v >= t) return 'Amarelo'
  if (v < t) return 'Vermelho'
  return 'Analisar'
}

/** Dias de cobertura do estoque atual (Estoque ÷ Média 5 dias), alinhado ao eixo dos demais “dias de estoque”. */
function diasEstoqueAtualCobertura(r: RowLista): number {
  const est = parseNumberBR(r['Estoque Atual'])
  const med = parseNumberBR(r['Média ult. 5 dias'])
  if (med <= 0) return 0
  return Math.round((est / med) * 100) / 100
}

function itensAmareloOuVermelho(rows: RowLista[]): RowLista[] {
  return rows.filter((r) => {
    const c = calcCond(r)
    return c === 'Amarelo' || c === 'Vermelho'
  })
}

type FiltroPainelAlerta = 'todos' | 'Amarelo' | 'Vermelho'

function exportarAlertasParaExcel(lista: RowLista[], filtro: FiltroPainelAlerta) {
  if (lista.length === 0) return
  const suf =
    filtro === 'todos' ? 'amarelo-e-vermelho' : filtro === 'Amarelo' ? 'amarelo' : 'vermelho'
  const fileName = `alertas-estoque-seguranca-${todayYmdLocal()}-${suf}.xlsx`
  const data = lista.map((r) => ({
    SKU: r.sku || '',
    DESCRIÇÃO: r.descricao || '',
    'Estoque Ideal Máximo': r['Estoque Ideal Máximo'] ?? '',
    'Estoque Atual': r['Estoque Atual'] ?? '',
    Status: calcCond(r),
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Alertas')
  XLSX.writeFile(wb, fileName)
}

function IconBell() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function formatLineTooltipNumber(y: number): string {
  if (Number.isFinite(y) && Math.abs(y - Math.round(y)) < 1e-9) return String(Math.round(y))
  return y.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatTooltipEstoque(v: number, seriesLabel: string): string {
  const n = formatLineTooltipNumber(v)
  if (seriesLabel === 'Quantidade por status' || seriesLabel === 'Quantidade de itens') {
    return `${n} item(ns)`
  }
  return n
}

function MetricChart({
  titulo,
  labels,
  values,
  onCategoryClick,
}: {
  titulo: string
  labels: string[]
  values: number[]
  onCategoryClick?: (label: string) => void
}) {
  const series = useMemo<SvgChartSeries[]>(
    () => [{ label: titulo, color: '#3b82f6', values }],
    [titulo, values],
  )
  return (
    <ComparativoLinhasSvgChart
      title={titulo}
      xLabels={labels}
      series={series}
      hideLegend
      yFormat={formatLineTooltipNumber}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={onCategoryClick ? (label) => onCategoryClick(label) : undefined}
    />
  )
}

function ComboPedidosChart({
  labels,
  rows,
  onCategoryClick,
}: {
  labels: string[]
  rows: RowLista[]
  onCategoryClick?: (label: string) => void
}) {
  const series = useMemo<SvgChartSeries[]>(
    () => [
      { label: 'Pedido Méd. Abril', color: '#16a34a', values: rows.map((r) => parseNumberBR(r['Pedido Méd. Abril'])) },
      { label: 'Pedido Máx. Abril', color: '#2563eb', values: rows.map((r) => parseNumberBR(r['Pedido Máx. Abril'])) },
      { label: 'Média ult. 5 dias', color: '#d97706', values: rows.map((r) => parseNumberBR(r['Média ult. 5 dias'])) },
    ],
    [rows],
  )
  return (
    <ComparativoLinhasSvgChart
      title="Pedido Méd. / Máx. / Média 5 dias (linhas)"
      xLabels={labels}
      series={series}
      yFormat={formatLineTooltipNumber}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={onCategoryClick ? (l) => onCategoryClick(l) : undefined}
    />
  )
}

function ComboPosicoesChart({
  labels,
  rows,
  onCategoryClick,
}: {
  labels: string[]
  rows: RowLista[]
  onCategoryClick?: (label: string) => void
}) {
  const series = useMemo<SvgChartSeries[]>(
    () => [
      { label: 'Posições Máximo', color: '#7c3aed', values: rows.map((r) => parseNumberBR(r['Posições Máximo'])) },
      { label: 'Posições Média', color: '#2563eb', values: rows.map((r) => parseNumberBR(r['Posições Média'])) },
      { label: 'Posições Mínimo', color: '#0891b2', values: rows.map((r) => parseNumberBR(r['Posições Mínimo'])) },
    ],
    [rows],
  )
  return (
    <ComparativoLinhasSvgChart
      title="Comparativo de posições (linhas)"
      xLabels={labels}
      series={series}
      yFormat={formatLineTooltipNumber}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={onCategoryClick ? (l) => onCategoryClick(l) : undefined}
    />
  )
}

function ComboEstoqueIdealChart({
  labels,
  rows,
  onCategoryClick,
}: {
  labels: string[]
  rows: RowLista[]
  onCategoryClick?: (label: string) => void
}) {
  const series = useMemo<SvgChartSeries[]>(
    () => [
      { label: 'Estoque Ideal Máximo', color: '#1e40af', values: rows.map((r) => parseNumberBR(r['Estoque Ideal Máximo'])) },
      { label: 'Estoque Ideal Médio', color: '#2563eb', values: rows.map((r) => parseNumberBR(r['Estoque Ideal Médio'])) },
      { label: 'Estoque Ideal Mínimo', color: '#60a5fa', values: rows.map((r) => parseNumberBR(r['Estoque Ideal Mínimo'])) },
    ],
    [rows],
  )
  return (
    <ComparativoLinhasSvgChart
      title="Comparativo de estoque ideal (linhas)"
      xLabels={labels}
      series={series}
      yFormat={formatLineTooltipNumber}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={onCategoryClick ? (l) => onCategoryClick(l) : undefined}
    />
  )
}

function ComboDiasEstoqueChart({
  labels,
  rows,
  onCategoryClick,
}: {
  labels: string[]
  rows: RowLista[]
  onCategoryClick?: (label: string) => void
}) {
  const series = useMemo<SvgChartSeries[]>(
    () => [
      { label: 'Dias de Estoque Máximo', color: '#dc2626', values: rows.map((r) => parseNumberBR(r['Dias de Estoque Máximo'])) },
      { label: 'Dias de Estoque Médio', color: '#d97706', values: rows.map((r) => parseNumberBR(r['Dias de Estoque Médio'])) },
      { label: 'Dias de Estoque Mínimo', color: '#059669', values: rows.map((r) => parseNumberBR(r['Dias de Estoque Mínimo'])) },
      {
        label: 'Dias estoque atual (Est. ÷ média 5d)',
        color: '#9333ea',
        values: rows.map((r) => diasEstoqueAtualCobertura(r)),
      },
    ],
    [rows],
  )
  return (
    <ComparativoLinhasSvgChart
      title="Comparativo de dias de estoque (linhas, 4 métricas)"
      subtitle="Dias estoque atual: estoque atual ÷ média últ. 5 dias (cobertura em dias)."
      xLabels={labels}
      series={series}
      yFormat={formatLineTooltipNumber}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={onCategoryClick ? (l) => onCategoryClick(l) : undefined}
    />
  )
}

/** Linhas por status (mesma regra condicional), pontos com cores semaforicas — SVG como temperatura. */
function SemaforoLinhasChart({
  rows,
  onCondClick,
}: {
  rows: RowLista[]
  onCondClick?: (cond: CondClass) => void
}) {
  const counts = useMemo(() => {
    const out: Record<CondClass, number> = { Excedido: 0, Verde: 0, Amarelo: 0, Vermelho: 0, Analisar: 0 }
    rows.forEach((r) => {
      out[calcCond(r)] += 1
    })
    return out
  }, [rows])
  const series = useMemo<SvgChartSeries[]>(
    () => [
      {
        label: 'Quantidade de itens',
        color: '#94a3b8',
        values: CONDICIONAL_LABELS.map((k) => counts[k]),
      },
    ],
    [counts],
  )
  const pointFillColors = useMemo(() => [...SEMAFORO_CORES_BARRA], [])
  return (
    <ComparativoLinhasSvgChart
      title="Semaforo — quantidade por status (linhas)"
      xLabels={[...CONDICIONAL_LABELS]}
      series={series}
      hideLegend
      straightSegments
      pointFillColors={pointFillColors}
      yFormat={(v) => String(Math.round(v))}
      formatTooltipValue={formatTooltipEstoque}
      onXClick={
        onCondClick
          ? (label) => {
              if ((CONDICIONAL_LABELS as string[]).includes(label)) onCondClick(label as CondClass)
            }
          : undefined
      }
    />
  )
}

export default function EstoqueSeguranca() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<RowLista[]>([])
  const [source, setSource] = useState('')
  const [page, setPage] = useState(1)
  const [painelAlertasAberto, setPainelAlertasAberto] = useState(false)
  const [filtroPainelAlerta, setFiltroPainelAlerta] = useState<FiltroPainelAlerta>('todos')
  const [filtroGlobal, setFiltroGlobal] = useState<GraficoFiltro>(null)

  useEffect(() => {
    let alive = true
    async function run() {
      setLoading(true)
      setError(null)
      const urls = [
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
      ]
      let lastErr = 'Falha ao carregar planilha.'
      for (const url of urls) {
        try {
          const resp = await fetch(url, { cache: 'no-store', credentials: 'omit' })
          const text = await resp.text()
          if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`)
          if (isHtmlResponse(text)) throw new Error('Google retornou tela HTML/login.')
          const grid = parseCsv(text)
          if (grid.length < 2) throw new Error('CSV vazio.')
          const rawHead = grid[0].map((h) => String(h || '').trim())
          const head = rawHead.map((h) => normalize(h))
          const skuIdx = head.findIndex((h) => h === 'sku')
          const descIdx = head.findIndex((h) => h === 'descricao' || h === 'description')
          const idxMap = Object.fromEntries(
            COLUNAS.map((c) => {
              const idx = head.findIndex((h) => h === normalize(c))
              return [c, idx]
            }),
          ) as Record<Coluna, number>
          const missing = COLUNAS.filter((c) => idxMap[c] < 0)
          if (missing.length) {
            throw new Error(`Colunas não encontradas: ${missing.join(', ')}`)
          }
          const parsed: RowLista[] = grid.slice(1).map((line) => {
            const obj = {} as DataRow
            COLUNAS.forEach((c) => {
              obj[c] = String(line[idxMap[c]] ?? '').trim()
            })
            return {
              ...obj,
              sku: skuIdx >= 0 ? String(line[skuIdx] ?? '').trim() : '',
              descricao: descIdx >= 0 ? String(line[descIdx] ?? '').trim() : '',
            }
          })
          if (!alive) return
          setRows(parsed)
          setSource(url)
          setLoading(false)
          return
        } catch (e) {
          lastErr = e instanceof Error ? e.message : 'Falha.'
        }
      }
      if (!alive) return
      setError(`Não foi possível carregar: ${lastErr}`)
      setLoading(false)
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const rowsFiltradasGlobal = useMemo(() => {
    if (!filtroGlobal) return rows
    if (filtroGlobal.kind === 'sku') {
      return rows.filter((r) => labelForRow(r, rows) === filtroGlobal.label)
    }
    return rows.filter((r) => calcCond(r) === filtroGlobal.cond)
  }, [rows, filtroGlobal])

  const labelsSkuGraficos = useMemo(
    () => rowsFiltradasGlobal.map((r) => labelForRow(r, rows)),
    [rows, rowsFiltradasGlobal],
  )

  const onGraficoCategoriaClick = useCallback((label: string) => {
    setFiltroGlobal((prev) => {
      if (prev?.kind === 'sku' && prev.label === label) return null
      return { kind: 'sku', label }
    })
  }, [])

  const onGraficoCondClick = useCallback((cond: CondClass) => {
    setFiltroGlobal((prev) => {
      if (prev?.kind === 'cond' && prev.cond === cond) return null
      return { kind: 'cond', cond }
    })
  }, [])

  const onFiltroTabelaClick = useCallback((st: 'Todos' | CondClass) => {
    if (st === 'Todos') {
      setFiltroGlobal(null)
      return
    }
    setFiltroGlobal({ kind: 'cond', cond: st })
  }, [])

  const alertasAmareloVermelho = useMemo(() => itensAmareloOuVermelho(rows), [rows])

  const alertasPainelLista = useMemo(() => {
    if (filtroPainelAlerta === 'todos') return alertasAmareloVermelho
    return alertasAmareloVermelho.filter((r) => calcCond(r) === filtroPainelAlerta)
  }, [alertasAmareloVermelho, filtroPainelAlerta])

  /** Aviso automático único por dia, na primeira carga com dados após atualização da planilha. */
  useEffect(() => {
    if (loading || error || rows.length === 0) return
    const lista = itensAmareloOuVermelho(rows)
    if (lista.length === 0) return
    const hoje = todayYmdLocal()
    try {
      if (localStorage.getItem(LS_AVISO_DIARIO_YMD) === hoje) return
    } catch {
      /* private mode / bloqueio */
    }
    setPainelAlertasAberto(true)
    try {
      localStorage.setItem(LS_AVISO_DIARIO_YMD, hoje)
    } catch {
      /* ignore */
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = lista.length
      new Notification('Estoque de segurança', {
        body:
          n === 1
            ? '1 item em Amarelo ou Vermelho. Confira a lista no painel.'
            : `${n} itens em Amarelo ou Vermelho. Confira a lista no painel.`,
        tag: 'estoque-seguranca-diario',
      })
    }
  }, [loading, error, rows])
  /** Colunas que ainda têm um gráfico de linha individual (demais estão nos comparativos). */
  const metricasGraficos = useMemo<Coluna[]>(() => ['Estoque Atual'], [])

  const rowsFiltradasSemaforo = rowsFiltradasGlobal

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rowsFiltradasSemaforo.length / 15)), [rowsFiltradasSemaforo.length])
  const rowsPagina = useMemo(() => {
    const p = Math.min(page, totalPages)
    const start = (p - 1) * 15
    return rowsFiltradasSemaforo.slice(start, start + 15)
  }, [page, rowsFiltradasSemaforo, totalPages])

  useEffect(() => {
    setPage(1)
  }, [filtroGlobal, rows.length])

  const qtdAlertas = alertasAmareloVermelho.length
  const temFiltroAtivo = filtroGlobal !== null
  const filtroSemaforoAtivo: 'Todos' | CondClass = filtroGlobal?.kind === 'cond' ? filtroGlobal.cond : 'Todos'
  const planilhaReadOnlyUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/view?gid=${SHEET_GID}`

  return (
    <section style={{ maxWidth: 1500, margin: '0 auto', padding: '0 12px 26px', position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          margin: '12px 0 14px',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, textAlign: 'center' }}>Estoque de Seguranca</h2>
        {!loading && !error ? (
          <>
            <button
              type="button"
              aria-label={`Alertas de estoque: ${qtdAlertas} item(ns) em Amarelo ou Vermelho`}
              onClick={() => setPainelAlertasAberto(true)}
              style={btnSininho}
            >
              <IconBell />
              {qtdAlertas > 0 ? (
                <span style={badgeSininho}>{qtdAlertas > 99 ? '99+' : qtdAlertas}</span>
              ) : null}
            </button>
            <button
              type="button"
              disabled={!temFiltroAtivo}
              title={
                temFiltroAtivo
                  ? 'Remove o filtro dos gráficos e restaura a lista para «Todos»'
                  : 'Não há filtro ativo nos gráficos nem na lista'
              }
              onClick={() => {
                setFiltroGlobal(null)
              }}
              style={btnLimparFiltros(temFiltroAtivo)}
            >
              Limpar filtros
            </button>
          </>
        ) : null}
      </div>

      {painelAlertasAberto ? (
        <div
          style={modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-alertas-estoque"
          onClick={() => setPainelAlertasAberto(false)}
        >
          <div
            style={modalBox}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <h3 id="titulo-alertas-estoque" style={{ margin: '0 0 6px 0', fontSize: 17 }}>
                  Itens em Amarelo ou Vermelho
                </h3>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', maxWidth: 520 }}>
                  Aviso diário único: na primeira vez que os dados do dia são carregados, esta lista abre automaticamente se houver
                  alertas. Use o sininho para ver de novo a qualquer momento.
                </p>
              </div>
              <button type="button" style={modalFechar} onClick={() => setPainelAlertasAberto(false)} aria-label="Fechar">
                ×
              </button>
            </div>
            {qtdAlertas === 0 ? (
              <p style={{ color: '#94a3b8', margin: 0 }}>Nenhum item em Amarelo ou Vermelho no momento.</p>
            ) : (
              <>
                <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>Filtrar lista:</span>
                  {(['todos', 'Amarelo', 'Vermelho'] as const).map((f) => {
                    const label = f === 'todos' ? 'Amarelo e Vermelho' : f
                    const active = filtroPainelAlerta === f
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFiltroPainelAlerta(f)}
                        style={btnFiltroPainel(f, active)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <div style={{ maxHeight: 'min(60vh, 420px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>SKU</th>
                        <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1, minWidth: 160 }}>DESCRIÇÃO</th>
                        <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>Estoque Ideal Máximo</th>
                        <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>Estoque Atual</th>
                        <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertasPainelLista.map((r, i) => {
                        const st = calcCond(r)
                        const cor =
                          st === 'Amarelo'
                            ? { bg: 'rgba(234, 179, 8, 0.2)', fg: '#eab308' }
                            : { bg: 'rgba(239, 68, 68, 0.18)', fg: '#f87171' }
                        return (
                          <tr key={`${r.sku || r.Categoria}-${i}`} style={{ background: cor.bg }}>
                            <td style={td}>{r.sku || '-'}</td>
                            <td style={{ ...td, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.descricao || '-'}</td>
                            <td style={td}>{r['Estoque Ideal Máximo'] || '-'}</td>
                            <td style={td}>{r['Estoque Atual'] || '-'}</td>
                            <td style={{ ...td, fontWeight: 700, color: cor.fg }}>{st}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {alertasPainelLista.length === 0 ? (
                  <p style={{ color: '#94a3b8', margin: '8px 0 0', fontSize: 13 }}>Nenhum item neste filtro.</p>
                ) : null}
              </>
            )}
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="button" style={pagerBtn} onClick={() => setPainelAlertasAberto(false)}>
                Fechar
              </button>
              {qtdAlertas > 0 ? (
                <button
                  type="button"
                  style={{ ...pagerBtn, borderColor: '#16a34a', color: '#4ade80', fontWeight: 700 }}
                  onClick={() => exportarAlertasParaExcel(alertasPainelLista, filtroPainelAlerta)}
                  disabled={alertasPainelLista.length === 0}
                >
                  Exportar Excel ({alertasPainelLista.length} itens —{' '}
                  {filtroPainelAlerta === 'todos' ? 'Amarelo e Vermelho' : filtroPainelAlerta})
                </button>
              ) : null}
              {typeof Notification !== 'undefined' && Notification.permission === 'default' ? (
                <button
                  type="button"
                  style={{ ...pagerBtn, borderColor: '#2dd4bf', color: '#2dd4bf' }}
                  onClick={() => {
                    void Notification.requestPermission()
                  }}
                >
                  Permitir notificação do navegador (opcional)
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <p style={{ color: '#94a3b8' }}>Carregando planilha...</p> : null}
      {error ? <div style={errorBox}>{error}</div> : null}

      {!loading && !error ? (
        <>
          <div style={{ margin: '0 0 10px 0', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>Origem: {source}</p>
            <a
              href={planilhaReadOnlyUrl}
              target="_blank"
              rel="noreferrer"
              style={btnAbrirReadOnly}
              title="Abrir planilha em modo leitura"
            >
              Abrir (leitura)
            </a>
          </div>
          {filtroGlobal ? (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'rgba(45, 212, 191, 0.12)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 13 }}>
                {filtroGlobal.kind === 'sku' ? (
                  <>
                    Filtro ativo por <strong>SKU / eixo</strong>: «{filtroGlobal.label}»
                  </>
                ) : (
                  <>
                    Filtro ativo por <strong>status</strong>: «{filtroGlobal.cond}»
                  </>
                )}
                <span style={{ color: '#94a3b8', fontWeight: 400 }}> — clique de novo no mesmo item para limpar.</span>
              </span>
              <button type="button" style={pagerBtn} onClick={() => setFiltroGlobal(null)}>
                Mostrar todos os itens
              </button>
            </div>
          ) : (
            <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#94a3b8' }}>
              Clique em um <strong>ponto / linha</strong> no eixo SKU ou em um <strong>status</strong> no gráfico condicional para
              filtrar todos os gráficos e a tabela.
            </p>
          )}
          <div style={gridCharts}>
            <ComboPedidosChart
              labels={labelsSkuGraficos}
              rows={rowsFiltradasGlobal}
              onCategoryClick={onGraficoCategoriaClick}
            />
            <ComboEstoqueIdealChart
              labels={labelsSkuGraficos}
              rows={rowsFiltradasGlobal}
              onCategoryClick={onGraficoCategoriaClick}
            />
            <ComboDiasEstoqueChart
              labels={labelsSkuGraficos}
              rows={rowsFiltradasGlobal}
              onCategoryClick={onGraficoCategoriaClick}
            />
            <ComboPosicoesChart
              labels={labelsSkuGraficos}
              rows={rowsFiltradasGlobal}
              onCategoryClick={onGraficoCategoriaClick}
            />
            {metricasGraficos.map((m) => (
              <MetricChart
                key={m}
                titulo={m}
                labels={labelsSkuGraficos}
                values={rowsFiltradasGlobal.map((r) => parseNumberBR(r[m]))}
                onCategoryClick={onGraficoCategoriaClick}
              />
            ))}
            <SemaforoLinhasChart rows={rowsFiltradasGlobal} onCondClick={onGraficoCondClick} />
          </div>

          <h3 style={{ margin: '10px 0 8px' }}>Lista de itens (formatação condicional)</h3>
          <div style={filtrosSemaforoWrap}>
            {(['Todos', 'Excedido', 'Verde', 'Amarelo', 'Vermelho', 'Analisar'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onFiltroTabelaClick(st)}
                style={btnSemaforo(st, filtroSemaforoAtivo === st)}
              >
                {st}
              </button>
            ))}
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
              <thead>
                <tr>
                  <th style={th}>SKU</th>
                  <th style={{ ...th, minWidth: 220 }}>DESCRIÇÃO</th>
                  {COLUNAS.map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                  <th style={th}>Resultado condicional</th>
                </tr>
              </thead>
              <tbody>
                {rowsPagina.map((r, i) => {
                  const cond = calcCond(r)
                  const bgStatus =
                    cond === 'Excedido'
                      ? '#3b0764'
                      : cond === 'Verde'
                        ? '#14532d'
                        : cond === 'Amarelo'
                          ? '#713f12'
                          : cond === 'Vermelho'
                            ? '#7f1d1d'
                            : '#9d174d'
                  const bgLinha =
                    cond === 'Excedido'
                      ? 'rgba(124, 58, 237, 0.14)'
                      : cond === 'Verde'
                        ? 'rgba(34, 197, 94, 0.14)'
                        : cond === 'Amarelo'
                          ? 'rgba(234, 179, 8, 0.14)'
                          : cond === 'Vermelho'
                            ? 'rgba(239, 68, 68, 0.14)'
                            : 'rgba(236, 72, 153, 0.14)'
                  return (
                    <tr key={`${r.sku || r.Categoria}-${i}`} style={{ background: bgLinha }}>
                      <td style={td}>{r.sku || '-'}</td>
                      <td style={{ ...td, maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {r.descricao || '-'}
                      </td>
                      {COLUNAS.map((h) => (
                        <td key={`${i}-${h}`} style={td}>
                          {r[h] || '-'}
                        </td>
                      ))}
                      <td style={{ ...td, fontWeight: 700, background: bgStatus }}>{cond}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={paginacaoWrap}>
            <button type="button" style={pagerBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </button>
            <span style={{ fontSize: 13 }}>
              Página {Math.min(page, totalPages)} de {totalPages} ({rowsFiltradasSemaforo.length} itens)
            </span>
            <button
              type="button"
              style={pagerBtn}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Próxima
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}

const errorBox: CSSProperties = {
  border: '1px solid #7f1d1d',
  background: '#450a0a',
  color: '#fecaca',
  padding: 12,
  borderRadius: 8,
}

const gridCharts: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginBottom: 16,
  width: '100%',
}

const filtrosSemaforoWrap: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 10,
}

function btnFiltroPainel(filtro: FiltroPainelAlerta, active: boolean): CSSProperties {
  const cores: Record<FiltroPainelAlerta, string> = {
    todos: '#64748b',
    Amarelo: '#ca8a04',
    Vermelho: '#dc2626',
  }
  const c = cores[filtro]
  return {
    borderRadius: 8,
    border: `1px solid ${c}`,
    background: active ? `${c}33` : 'transparent',
    color: active ? '#f1f5f9' : c,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
  }
}

function btnLimparFiltros(enabled: boolean): CSSProperties {
  return {
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: enabled ? 'var(--code-bg)' : 'transparent',
    color: enabled ? 'var(--text-h)' : '#64748b',
    padding: '8px 14px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontWeight: 600,
    fontSize: 13,
    opacity: enabled ? 1 : 0.55,
  }
}

function btnSemaforo(status: 'Todos' | CondClass, active: boolean): CSSProperties {
  const paleta: Record<string, string> = {
    Todos: '#1f2937',
    Excedido: '#7c3aed',
    Verde: '#16a34a',
    Amarelo: '#ca8a04',
    Vermelho: '#dc2626',
    Analisar: '#db2777',
  }
  return {
    borderRadius: 999,
    border: `1px solid ${paleta[status]}`,
    background: active ? paleta[status] : `${paleta[status]}22`,
    color: active ? '#fff' : paleta[status],
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 12,
  }
}

const paginacaoWrap: CSSProperties = {
  marginTop: 10,
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  justifyContent: 'flex-end',
}

const pagerBtn: CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--code-bg)',
  color: 'var(--text-h)',
  padding: '6px 10px',
  cursor: 'pointer',
}

const btnAbrirReadOnly: CSSProperties = {
  borderRadius: 8,
  border: '1px solid #2dd4bf',
  background: 'rgba(45, 212, 191, 0.12)',
  color: '#5eead4',
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--code-bg)',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
}

const btnSininho: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  padding: 0,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--code-bg)',
  color: '#cbd5e1',
  cursor: 'pointer',
}

const badgeSininho: CSSProperties = {
  position: 'absolute',
  top: -4,
  right: -4,
  minWidth: 20,
  height: 20,
  padding: '0 6px',
  borderRadius: 999,
  background: '#dc2626',
  color: '#fff',
  fontSize: 11,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  border: '2px solid var(--bg, #0f172a)',
}

const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const modalBox: CSSProperties = {
  width: '100%',
  maxWidth: 920,
  maxHeight: '90vh',
  overflow: 'hidden',
  background: 'var(--code-bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 18,
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
}

const modalFechar: CSSProperties = {
  flexShrink: 0,
  width: 36,
  height: 36,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: '#94a3b8',
  fontSize: 24,
  lineHeight: 1,
  cursor: 'pointer',
}
