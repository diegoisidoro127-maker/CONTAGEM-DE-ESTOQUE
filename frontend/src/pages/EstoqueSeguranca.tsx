import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, type ChartConfiguration } from 'chart.js/auto'

const SHEET_ID = '1KBDdsl4GeQL97mAvJS_J7uf0a6M7LRr0fHtPZE_QFhU'
const SHEET_GID = '1626679618'

type RawRow = Record<string, string>
type TipoRegistro = 'presente' | 'falta' | 'folga' | 'outro'
type ParsedRow = RawRow & {
  _data: Date | null
  _periodo: string
  _colaborador: string
  _unidade: string
  _justificativa: string
  _tipo: TipoRegistro
}

type Filter = {
  periodo: string
  colaborador: string
  unidade: string
  justificativa: string
  dataInicio: string
  dataFim: string
}

function normalizeHeader(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function parseCsv(csvText: string): { headers: string[]; rows: RawRow[] } {
  const lines = String(csvText || '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return { headers: [], rows: [] }
  const sep = lines[0].includes('\t') ? '\t' : ','
  const parseLine = (line: string): string[] => {
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
  }
  const matrix = lines.map(parseLine)
  const headers = matrix[0].map((h, idx) => (h.trim() || `Coluna ${idx + 1}`))
  const rows = matrix.slice(1).map((line) => {
    const r: RawRow = {}
    headers.forEach((h, idx) => {
      r[h] = String(line[idx] ?? '').trim()
    })
    return r
  })
  return { headers, rows }
}

function parseDateFlex(raw: string): Date | null {
  const s = String(raw || '').trim().split(/\s+/)[0]
  if (!s) return null
  const p = s.split(/[/.-]/)
  if (p.length !== 3) return null
  let y = 0
  let m = 0
  let d = 0
  if (p[0].length === 4) {
    y = Number(p[0])
    m = Number(p[1]) - 1
    d = Number(p[2])
  } else {
    d = Number(p[0])
    m = Number(p[1]) - 1
    y = Number(p[2])
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  const dt = new Date(y, m, d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function looksLikeHtmlOrSignIn(text: string): boolean {
  return /<html|<!doctype html|Google Sheets: Sign-in|Sign in/i.test(text)
}

function detectColumn(headers: string[], candidates: string[]): string {
  const normalized = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }))
  for (const c of candidates) {
    const key = normalizeHeader(c)
    const exact = normalized.find((h) => h.n === key)
    if (exact) return exact.raw
  }
  for (const c of candidates) {
    const key = normalizeHeader(c)
    const like = normalized.find((h) => h.n.includes(key))
    if (like) return like.raw
  }
  return headers[0] || ''
}

function classificarTipo(justificativa: string): TipoRegistro {
  const j = normalizeHeader(justificativa)
  if (j.includes('presente')) return 'presente'
  if (j.includes('falta')) return 'falta'
  if (j.includes('folga')) return 'folga'
  return 'outro'
}

function ChartCard({ title, config }: { title: string; config: ChartConfiguration }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }
    chartRef.current = new Chart(canvasRef.current, config)
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [config])

  return (
    <div style={cardChart}>
      <h3 style={{ margin: '0 0 10px 0' }}>{title}</h3>
      <div style={{ height: 280 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

export default function EstoqueSeguranca() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [filter, setFilter] = useState<Filter>({
    periodo: '',
    colaborador: '',
    unidade: '',
    justificativa: '',
    dataInicio: '',
    dataFim: '',
  })

  useEffect(() => {
    let alive = true
    async function run() {
      setLoading(true)
      setError(null)
      const urls = [
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
      ]
      let lastErr = 'Falha ao carregar a planilha.'
      for (const url of urls) {
        try {
          const resp = await fetch(url, { cache: 'no-store', credentials: 'omit' })
          const text = await resp.text()
          if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`)
          if (looksLikeHtmlOrSignIn(text)) throw new Error('Acesso bloqueado pelo Google Sheets.')
          const parsed = parseCsv(text)
          if (!parsed.headers.length) throw new Error('CSV sem cabecalho.')

          const colData = detectColumn(parsed.headers, ['data'])
          const colPeriodo = detectColumn(parsed.headers, ['periodo', 'mes'])
          const colColab = detectColumn(parsed.headers, ['colaborador', 'conferente', 'funcionario'])
          const colUnidade = detectColumn(parsed.headers, ['unidade', 'setor'])
          const colJust = detectColumn(parsed.headers, ['justificativa', 'status'])
          const parsedRows: ParsedRow[] = parsed.rows.map((r) => {
            const just = String(r[colJust] || '')
            return {
              ...r,
              _data: parseDateFlex(r[colData]),
              _periodo: String(r[colPeriodo] || '').trim(),
              _colaborador: String(r[colColab] || '').trim(),
              _unidade: String(r[colUnidade] || '').trim(),
              _justificativa: just,
              _tipo: classificarTipo(just),
            }
          })
          if (!alive) return
          setHeaders(parsed.headers)
          setRows(parsedRows)
          setSource(url)
          setLoading(false)
          return
        } catch (e) {
          lastErr = e instanceof Error ? e.message : 'Falha ao carregar a planilha.'
        }
      }
      if (!alive) return
      setError(
        `Nao foi possivel acessar a planilha (detalhe: ${lastErr}). Verifique permissao publica e gid da aba Resumo.`,
      )
      setLoading(false)
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const filterOptions = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return {
      periodos: uniq(rows.map((r) => r._periodo)),
      colaboradores: uniq(rows.map((r) => r._colaborador)),
      unidades: uniq(rows.map((r) => r._unidade)),
      justificativas: uniq(rows.map((r) => r._justificativa)),
    }
  }, [rows])

  const filtered = useMemo(() => {
    const di = filter.dataInicio ? new Date(`${filter.dataInicio}T00:00:00`) : null
    const df = filter.dataFim ? new Date(`${filter.dataFim}T23:59:59`) : null
    return rows.filter((r) => {
      if (filter.periodo && r._periodo !== filter.periodo) return false
      if (filter.colaborador && r._colaborador !== filter.colaborador) return false
      if (filter.unidade && r._unidade !== filter.unidade) return false
      if (filter.justificativa && r._justificativa !== filter.justificativa) return false
      if (di && (!r._data || r._data < di)) return false
      if (df && (!r._data || r._data > df)) return false
      return true
    })
  }, [rows, filter])

  const resumo = useMemo(() => {
    let presentes = 0
    let faltas = 0
    let folgas = 0
    const porJust: Record<string, number> = {}
    const porDia: Record<string, number> = {}
    const porMes: Record<string, { presente: number; falta: number; folga: number }> = {}
    const porColab: Record<string, { presente: number; falta: number; folga: number }> = {}

    filtered.forEach((r) => {
      if (r._tipo === 'presente') presentes += 1
      else if (r._tipo === 'falta') faltas += 1
      else if (r._tipo === 'folga') folgas += 1
      const j = r._justificativa || '(vazio)'
      porJust[j] = (porJust[j] || 0) + 1
      const dia = r._data
        ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][r._data.getDay()]
        : '(sem data)'
      porDia[dia] = (porDia[dia] || 0) + 1
      const mes = r._data
        ? `${String(r._data.getMonth() + 1).padStart(2, '0')}/${r._data.getFullYear()}`
        : '(sem data)'
      if (!porMes[mes]) porMes[mes] = { presente: 0, falta: 0, folga: 0 }
      porMes[mes][r._tipo === 'presente' ? 'presente' : r._tipo === 'falta' ? 'falta' : 'folga'] += 1
      const c = r._colaborador || '(sem colaborador)'
      if (!porColab[c]) porColab[c] = { presente: 0, falta: 0, folga: 0 }
      porColab[c][r._tipo === 'presente' ? 'presente' : r._tipo === 'falta' ? 'falta' : 'folga'] += 1
    })

    return { presentes, faltas, folgas, porJust, porDia, porMes, porColab }
  }, [filtered])

  const chartConfigs = useMemo(() => {
    const labelsJust = Object.keys(resumo.porJust).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const valuesJust = labelsJust.map((k) => resumo.porJust[k])
    const labelsDia = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']
    const valuesDia = labelsDia.map((k) => resumo.porDia[k] || 0)
    const labelsMes = Object.keys(resumo.porMes).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const diasTrab = labelsMes.map((k) => resumo.porMes[k].presente)
    const faltasMes = labelsMes.map((k) => resumo.porMes[k].falta)
    const folgasMes = labelsMes.map((k) => resumo.porMes[k].folga)
    const labelsColab = Object.keys(resumo.porColab)
      .map((k) => ({ nome: k, total: resumo.porColab[k].falta + resumo.porColab[k].folga + resumo.porColab[k].presente }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((x) => x.nome)
    const colabDias = labelsColab.map((k) => resumo.porColab[k].presente)
    const colabFaltas = labelsColab.map((k) => resumo.porColab[k].falta)
    const colabFolgas = labelsColab.map((k) => resumo.porColab[k].folga)

    return {
      justPie: {
        type: 'pie',
        data: { labels: labelsJust, datasets: [{ data: valuesJust }] },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
      justBar: {
        type: 'bar',
        data: { labels: labelsJust, datasets: [{ label: 'Quantidade', data: valuesJust, backgroundColor: '#22c55e' }] },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
      diaBar: {
        type: 'bar',
        data: { labels: labelsDia, datasets: [{ label: 'Registros', data: valuesDia, backgroundColor: '#3b82f6' }] },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
      tipoRosca: {
        type: 'doughnut',
        data: {
          labels: ['Presente', 'Falta', 'Folga'],
          datasets: [{ data: [resumo.presentes, resumo.faltas, resumo.folgas], backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'] }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
      tendencia: {
        type: 'line',
        data: {
          labels: labelsMes,
          datasets: [
            { label: 'Dias trabalhados', data: diasTrab, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.2)', fill: true },
            { label: 'Faltas', data: faltasMes, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.2)', fill: true },
            { label: 'Folgas', data: folgasMes, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.2)', fill: true },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
      porColab: {
        type: 'bar',
        data: {
          labels: labelsColab,
          datasets: [
            { label: 'Trabalhados', data: colabDias, backgroundColor: '#22c55e' },
            { label: 'Faltas', data: colabFaltas, backgroundColor: '#ef4444' },
            { label: 'Folgas', data: colabFolgas, backgroundColor: '#f59e0b' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      } as ChartConfiguration,
    }
  }, [resumo])

  return (
    <section style={{ maxWidth: 1360, margin: '0 auto', padding: '0 12px 24px' }}>
      <h2 style={{ textAlign: 'center', margin: '10px 0 16px' }}>Estoque de Seguranca</h2>
      {loading ? <p style={{ color: '#94a3b8' }}>Carregando resumo da planilha...</p> : null}
      {error ? <div style={errorBox}>{error}</div> : null}
      {!loading && !error ? (
        <>
          <div style={filtersWrap}>
            <Select label="Periodo" value={filter.periodo} onChange={(v) => setFilter((f) => ({ ...f, periodo: v }))} options={filterOptions.periodos} />
            <Select label="Colaborador" value={filter.colaborador} onChange={(v) => setFilter((f) => ({ ...f, colaborador: v }))} options={filterOptions.colaboradores} />
            <Select label="Unidade" value={filter.unidade} onChange={(v) => setFilter((f) => ({ ...f, unidade: v }))} options={filterOptions.unidades} />
            <Select label="Justificativa" value={filter.justificativa} onChange={(v) => setFilter((f) => ({ ...f, justificativa: v }))} options={filterOptions.justificativas} />
            <div>
              <div style={labelStyle}>Data inicio</div>
              <input type="date" value={filter.dataInicio} onChange={(e) => setFilter((f) => ({ ...f, dataInicio: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Data fim</div>
              <input type="date" value={filter.dataFim} onChange={(e) => setFilter((f) => ({ ...f, dataFim: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" style={clearBtn} onClick={() => setFilter({ periodo: '', colaborador: '', unidade: '', justificativa: '', dataInicio: '', dataFim: '' })}>
                Limpar filtros
              </button>
            </div>
          </div>

          <div style={cardsWrap}>
            <Card title="Registros filtrados" value={String(filtered.length)} />
            <Card title="Dias trabalhados" value={String(resumo.presentes)} />
            <Card title="Faltas" value={String(resumo.faltas)} />
            <Card title="Folgas" value={String(resumo.folgas)} />
            <Card title="Origem" value={source} />
          </div>

          <div style={gridCharts}>
            <ChartCard title="Por justificativa (pizza)" config={chartConfigs.justPie} />
            <ChartCard title="Por justificativa (barras)" config={chartConfigs.justBar} />
            <ChartCard title="Por dia da semana" config={chartConfigs.diaBar} />
            <ChartCard title="Presente/Falta/Folga" config={chartConfigs.tipoRosca} />
            <ChartCard title="Tendencia por mes" config={chartConfigs.tendencia} />
            <ChartCard title="Por colaborador (top 10)" config={chartConfigs.porColab} />
          </div>

          <h3 style={{ margin: '12px 0 8px' }}>Dados detalhados</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>{headers.map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={`r-${idx}`}>
                    {headers.map((h) => <td key={`${idx}-${h}`} style={td}>{r[h] || '-'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Todos</option>
        {options.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
    </div>
  )
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--code-bg)' }}>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

const errorBox: CSSProperties = {
  border: '1px solid #7f1d1d',
  background: '#450a0a',
  color: '#fecaca',
  padding: 12,
  borderRadius: 8,
}

const filtersWrap: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 10,
  marginBottom: 12,
}

const cardsWrap: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
  marginBottom: 14,
}

const gridCharts: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
  marginBottom: 14,
}

const cardChart: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--code-bg)',
}

const labelStyle: CSSProperties = { fontSize: 12, marginBottom: 4, color: 'var(--text)' }

const inputStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--border)',
  padding: '8px 10px',
  background: 'transparent',
  color: 'var(--text-h)',
}

const clearBtn: CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border)',
  padding: '8px 10px',
  background: 'transparent',
  color: 'var(--text-h)',
  cursor: 'pointer',
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--code-bg)',
  fontSize: 12,
}

const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
}
