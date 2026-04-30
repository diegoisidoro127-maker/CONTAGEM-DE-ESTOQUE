import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, type ChartConfiguration } from 'chart.js/auto'

const SHEET_ID = '1KBDdsl4GeQL97mAvJS_J7uf0a6M7LRr0fHtPZE_QFhU'
const SHEET_GID = '1626679618'

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
type CondClass = 'Verde' | 'Amarelo' | 'Vermelho'

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

function calcCond(row: DataRow): CondClass {
  const v = parseNumberBR(row['Estoque Atual (29/04)']) // V
  const s = parseNumberBR(row['Estoque Ideal Máximo']) // S
  const t = parseNumberBR(row['Estoque Ideal Médio']) // T
  if (v >= s) return 'Verde'
  if (v >= t) return 'Amarelo'
  return 'Vermelho'
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

function CondicionalChart({ rows }: { rows: DataRow[] }) {
  const counts = useMemo(() => {
    const out: Record<CondClass, number> = { Verde: 0, Amarelo: 0, Vermelho: 0 }
    rows.forEach((r) => {
      out[calcCond(r)] += 1
    })
    return out
  }, [rows])
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'doughnut',
      data: {
        labels: ['Verde', 'Amarelo', 'Vermelho'],
        datasets: [
          {
            data: [counts.Verde, counts.Amarelo, counts.Vermelho],
            backgroundColor: ['#22c55e', '#eab308', '#ef4444'],
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
  const [rows, setRows] = useState<DataRow[]>([])
  const [source, setSource] = useState('')

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
          const head = grid[0].map((h) => normalize(h))
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
          const parsed: DataRow[] = grid.slice(1).map((line) => {
            const obj = {} as DataRow
            COLUNAS.forEach((c) => {
              obj[c] = String(line[idxMap[c]] ?? '').trim()
            })
            return obj
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

  const labelsCategoria = useMemo(() => rows.map((r) => r.Categoria || '(sem categoria)'), [rows])
  const metricasGraficos = useMemo(
    () =>
      COLUNAS.filter(
        (c) =>
          c !== 'Categoria' &&
          c !== 'Para condicional' &&
          c !== 'Posição Atual' &&
          c !== 'Estoque Atual ( comparação de 5 Dias)' &&
          c !== 'Estoque Atual (comparação mensal)',
      ),
    [],
  )

  return (
    <section style={{ maxWidth: 1500, margin: '0 auto', padding: '0 12px 26px' }}>
      <h2 style={{ textAlign: 'center', margin: '12px 0 14px' }}>Estoque de Seguranca</h2>
      {loading ? <p style={{ color: '#94a3b8' }}>Carregando planilha...</p> : null}
      {error ? <div style={errorBox}>{error}</div> : null}

      {!loading && !error ? (
        <>
          <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8' }}>Origem: {source}</p>
          <div style={gridCharts}>
            {metricasGraficos.map((m) => (
              <MetricChart key={m} titulo={m} labels={labelsCategoria} values={rows.map((r) => parseNumberBR(r[m]))} />
            ))}
            <CondicionalChart rows={rows} />
          </div>

          <h3 style={{ margin: '10px 0 8px' }}>Lista de itens (formatação condicional)</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
              <thead>
                <tr>
                  {COLUNAS.map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                  <th style={th}>Resultado condicional</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const cond = calcCond(r)
                  const bg = cond === 'Verde' ? '#14532d' : cond === 'Amarelo' ? '#713f12' : '#7f1d1d'
                  return (
                    <tr key={`${r.Categoria}-${i}`}>
                      {COLUNAS.map((h) => (
                        <td key={`${i}-${h}`} style={td}>
                          {r[h] || '-'}
                        </td>
                      ))}
                      <td style={{ ...td, fontWeight: 700, background: bg }}>{cond}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
