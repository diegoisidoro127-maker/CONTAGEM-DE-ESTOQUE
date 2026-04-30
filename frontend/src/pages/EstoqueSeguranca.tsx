import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, type ChartConfiguration } from 'chart.js/auto'

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
  'Estoque Atual (29/04)',
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
  const v = parseNumberBR(row['Estoque Atual (29/04)']) // V
  const r = parseNumberBR(row['Estoque Ideal Mínimo']) // R
  const s = parseNumberBR(row['Estoque Ideal Máximo']) // S
  const t = parseNumberBR(row['Estoque Ideal Médio']) // T
  if (v > r) return 'Excedido'
  if (v >= s) return 'Verde'
  if (v >= t) return 'Amarelo'
  if (v < t) return 'Vermelho'
  return 'Analisar'
}

function itensAmareloOuVermelho(rows: RowLista[]): RowLista[] {
  return rows.filter((r) => {
    const c = calcCond(r)
    return c === 'Amarelo' || c === 'Vermelho'
  })
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

function useChart(config: ChartConfiguration) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!ref.current) return
    if (chartRef.current) chartRef.current.destroy()
    chartRef.current = new Chart(ref.current, config)
    return () => {
      if (chartRef.current) chartRef.current.destroy()
    }
  }, [config])

  return ref
}

function MetricChart({ titulo, labels, values }: { titulo: string; labels: string[]; values: number[] }) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: titulo, data: values, backgroundColor: '#3b82f6', borderColor: '#2563eb', borderWidth: 1 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 20, color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' } },
        },
      },
    }),
    [labels, titulo, values],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>{titulo}</h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function ComboPedidosChart({ labels, rows }: { labels: string[]; rows: RowLista[] }) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Pedido Méd. Abril',
            data: rows.map((r) => parseNumberBR(r['Pedido Méd. Abril'])),
            backgroundColor: '#22c55e',
            borderColor: '#16a34a',
            borderWidth: 1,
          },
          {
            label: 'Pedido Máx. Abril',
            data: rows.map((r) => parseNumberBR(r['Pedido Máx. Abril'])),
            backgroundColor: '#3b82f6',
            borderColor: '#2563eb',
            borderWidth: 1,
          },
          {
            label: 'Média ult. 5 dias',
            data: rows.map((r) => parseNumberBR(r['Média ult. 5 dias'])),
            backgroundColor: '#f59e0b',
            borderColor: '#d97706',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#cbd5e1', boxWidth: 14, font: { size: 11 } },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 20, color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' } },
        },
      },
    }),
    [labels, rows],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
        Pedido Méd. Abril · Pedido Máx. Abril · Média ult. 5 dias
      </h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function ComboPosicoesChart({ labels, rows }: { labels: string[]; rows: RowLista[] }) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Posições Máximo',
            data: rows.map((r) => parseNumberBR(r['Posições Máximo'])),
            backgroundColor: '#8b5cf6',
            borderColor: '#7c3aed',
            borderWidth: 1,
          },
          {
            label: 'Posições Média',
            data: rows.map((r) => parseNumberBR(r['Posições Média'])),
            backgroundColor: '#3b82f6',
            borderColor: '#2563eb',
            borderWidth: 1,
          },
          {
            label: 'Posições Mínimo',
            data: rows.map((r) => parseNumberBR(r['Posições Mínimo'])),
            backgroundColor: '#06b6d4',
            borderColor: '#0891b2',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 20, color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' } },
        },
      },
    }),
    [labels, rows],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Comparativo de posições (3 métricas)</h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function ComboEstoqueIdealChart({ labels, rows }: { labels: string[]; rows: RowLista[] }) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Estoque Ideal Máximo',
            data: rows.map((r) => parseNumberBR(r['Estoque Ideal Máximo'])),
            backgroundColor: '#1d4ed8',
            borderColor: '#1e40af',
            borderWidth: 1,
          },
          {
            label: 'Estoque Ideal Médio',
            data: rows.map((r) => parseNumberBR(r['Estoque Ideal Médio'])),
            backgroundColor: '#3b82f6',
            borderColor: '#2563eb',
            borderWidth: 1,
          },
          {
            label: 'Estoque Ideal Mínimo',
            data: rows.map((r) => parseNumberBR(r['Estoque Ideal Mínimo'])),
            backgroundColor: '#93c5fd',
            borderColor: '#60a5fa',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 20, color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' } },
        },
      },
    }),
    [labels, rows],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Comparativo de estoque ideal (3 métricas)</h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function ComboDiasEstoqueChart({ labels, rows }: { labels: string[]; rows: RowLista[] }) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Dias de Estoque Máximo',
            data: rows.map((r) => parseNumberBR(r['Dias de Estoque Máximo'])),
            backgroundColor: '#ef4444',
            borderColor: '#dc2626',
            borderWidth: 1,
          },
          {
            label: 'Dias de Estoque Médio',
            data: rows.map((r) => parseNumberBR(r['Dias de Estoque Médio'])),
            backgroundColor: '#f59e0b',
            borderColor: '#d97706',
            borderWidth: 1,
          },
          {
            label: 'Dias de Estoque Mínimo',
            data: rows.map((r) => parseNumberBR(r['Dias de Estoque Mínimo'])),
            backgroundColor: '#10b981',
            borderColor: '#059669',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 20, color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' } },
        },
      },
    }),
    [labels, rows],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Comparativo de dias de estoque (3 métricas)</h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function CondicionalChart({ rows }: { rows: RowLista[] }) {
  const counts = useMemo(() => {
    const out: Record<CondClass, number> = { Excedido: 0, Verde: 0, Amarelo: 0, Vermelho: 0, Analisar: 0 }
    rows.forEach((r) => {
      out[calcCond(r)] += 1
    })
    return out
  }, [rows])
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'doughnut',
      data: {
        labels: ['Excedido', 'Verde', 'Amarelo', 'Vermelho', 'Analisar'],
        datasets: [
          {
            data: [counts.Excedido, counts.Verde, counts.Amarelo, counts.Vermelho, counts.Analisar],
            backgroundColor: ['#8b5cf6', '#22c55e', '#eab308', '#ef4444', '#64748b'],
            borderColor: '#111827',
            borderWidth: 1,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    }),
    [counts],
  )
  const canvasRef = useChart(config)
  return (
    <div style={chartCard}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>{'Para condicional (SE V>=S / V>=T / V<T)'}</h3>
      <div style={{ height: 230 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

export default function EstoqueSeguranca() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<RowLista[]>([])
  const [source, setSource] = useState('')
  const [filtroSemaforo, setFiltroSemaforo] = useState<'Todos' | CondClass>('Todos')
  const [page, setPage] = useState(1)
  const [painelAlertasAberto, setPainelAlertasAberto] = useState(false)

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

  const labelsSku = useMemo(() => {
    if (rows.some((r) => r.sku.trim() !== '')) {
      return rows.map((r) => r.sku.trim() || '(sem SKU)')
    }
    return rows.map((r) => r.Categoria || '(sem categoria)')
  }, [rows])

  const alertasAmareloVermelho = useMemo(() => itensAmareloOuVermelho(rows), [rows])

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
  /** Colunas que ainda têm um gráfico de barra individual (demais estão nos comparativos 3-em-1). */
  const metricasGraficos = useMemo<Coluna[]>(() => ['Estoque Atual (29/04)'], [])

  const rowsFiltradasSemaforo = useMemo(() => {
    if (filtroSemaforo === 'Todos') return rows
    return rows.filter((r) => calcCond(r) === filtroSemaforo)
  }, [filtroSemaforo, rows])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rowsFiltradasSemaforo.length / 15)), [rowsFiltradasSemaforo.length])
  const rowsPagina = useMemo(() => {
    const p = Math.min(page, totalPages)
    const start = (p - 1) * 15
    return rowsFiltradasSemaforo.slice(start, start + 15)
  }, [page, rowsFiltradasSemaforo, totalPages])

  useEffect(() => {
    setPage(1)
  }, [filtroSemaforo, rows.length])

  const qtdAlertas = alertasAmareloVermelho.length

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
              <div style={{ maxHeight: 'min(60vh, 420px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>SKU</th>
                      <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1, minWidth: 200 }}>DESCRIÇÃO</th>
                      <th style={{ ...th, position: 'sticky', top: 0, zIndex: 1 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertasAmareloVermelho.map((r, i) => {
                      const st = calcCond(r)
                      const cor =
                        st === 'Amarelo'
                          ? { bg: 'rgba(234, 179, 8, 0.2)', fg: '#eab308' }
                          : { bg: 'rgba(239, 68, 68, 0.18)', fg: '#f87171' }
                      return (
                        <tr key={`${r.sku || r.Categoria}-${i}`} style={{ background: cor.bg }}>
                          <td style={td}>{r.sku || '-'}</td>
                          <td style={{ ...td, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.descricao || '-'}</td>
                          <td style={{ ...td, fontWeight: 700, color: cor.fg }}>{st}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="button" style={pagerBtn} onClick={() => setPainelAlertasAberto(false)}>
                Fechar
              </button>
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
          <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8' }}>Origem: {source}</p>
          <div style={gridCharts}>
            <ComboPedidosChart labels={labelsSku} rows={rows} />
            <ComboEstoqueIdealChart labels={labelsSku} rows={rows} />
            <ComboDiasEstoqueChart labels={labelsSku} rows={rows} />
            <ComboPosicoesChart labels={labelsSku} rows={rows} />
            {metricasGraficos.map((m) => (
              <MetricChart key={m} titulo={m} labels={labelsSku} values={rows.map((r) => parseNumberBR(r[m]))} />
            ))}
            <CondicionalChart rows={rows} />
          </div>

          <h3 style={{ margin: '10px 0 8px' }}>Lista de itens (formatação condicional)</h3>
          <div style={filtrosSemaforoWrap}>
            {(['Todos', 'Excedido', 'Verde', 'Amarelo', 'Vermelho', 'Analisar'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFiltroSemaforo(st)}
                style={btnSemaforo(st, filtroSemaforo === st)}
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
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
  marginBottom: 16,
}

const chartCard: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--code-bg)',
}

const filtrosSemaforoWrap: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 10,
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
  maxWidth: 560,
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
