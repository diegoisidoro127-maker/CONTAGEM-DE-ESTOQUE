import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'

const SHEET_ID = '1KBDdsl4GeQL97mAvJS_J7uf0a6M7LRr0fHtPZE_QFhU'
const SHEET_GID = '1626679618'

type Row = Record<string, string>

type NumericSummary = {
  header: string
  count: number
  sum: number
  avg: number
  min: number
  max: number
}

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const out: string[][] = []
  let cur = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cur)
      cur = ''
      continue
    }
    if (ch === '\n') {
      row.push(cur)
      out.push(row)
      row = []
      cur = ''
      continue
    }
    if (ch !== '\r') cur += ch
  }
  row.push(cur)
  out.push(row)

  const clean = out.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!clean.length) return { headers: [], rows: [] }
  const headers = clean[0].map((h, idx) => {
    const v = String(h ?? '').trim()
    return v !== '' ? v : `Coluna ${idx + 1}`
  })
  const rows = clean.slice(1).map((r) => {
    const obj: Row = {}
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? '').trim()
    })
    return obj
  })
  return { headers, rows }
}

function parseNumberBR(raw: string): number | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const normalized = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function buildCandidateCsvUrls(): string[] {
  return [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
  ]
}

function looksLikeHtmlOrSignIn(text: string): boolean {
  return /<html|<!doctype html|Google Sheets: Sign-in|Sign in/i.test(text)
}

export default function EstoqueSeguranca() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])

  async function carregarPorUrls() {
    const urls = buildCandidateCsvUrls()
    let lastErr = 'Falha ao carregar a planilha.'
    for (const url of urls) {
      try {
        const resp = await fetch(url, { cache: 'no-store', credentials: 'omit' })
        const text = await resp.text()
        if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`)
        if (looksLikeHtmlOrSignIn(text)) {
          throw new Error('Google bloqueou leitura pública (retornou tela de login).')
        }
        const parsed = parseCsv(text)
        if (!parsed.headers.length) throw new Error('CSV sem cabeçalho.')
        setHeaders(parsed.headers)
        setRows(parsed.rows)
        setSource(url)
        return
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'Falha ao carregar a planilha.'
      }
    }
    throw new Error(lastErr)
  }

  useEffect(() => {
    let alive = true
    async function run() {
      setLoading(true)
      setError(null)
      try {
        if (!alive) return
        await carregarPorUrls()
      } catch (e) {
        if (!alive) return
        const raw = e instanceof Error ? e.message : 'Falha ao carregar a planilha.'
        const msg = raw.toLowerCase().includes('erro http')
          || raw.toLowerCase().includes('failed to fetch')
          || raw.toLowerCase().includes('bloqueou')
          ? 'Nao foi possivel acessar a aba "Resumo da Planilha" no Google Sheets. Verifique se ela esta publicada/compartilhada para leitura e se o gid esta correto.'
          : raw
        setError(msg)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const numericSummaries = useMemo<NumericSummary[]>(() => {
    if (!headers.length || !rows.length) return []
    const list: NumericSummary[] = []
    headers.forEach((h) => {
      const nums = rows.map((r) => parseNumberBR(r[h])).filter((n): n is number => n != null)
      if (!nums.length) return
      const sum = nums.reduce((acc, n) => acc + n, 0)
      const min = Math.min(...nums)
      const max = Math.max(...nums)
      list.push({
        header: h,
        count: nums.length,
        sum,
        avg: sum / nums.length,
        min,
        max,
      })
    })
    return list.sort((a, b) => b.sum - a.sum)
  }, [headers, rows])

  const categoryCharts = useMemo(() => {
    if (!headers.length || !rows.length) return [] as Array<{ header: string; values: Array<{ label: string; count: number }> }>
    const numericHeaders = new Set(numericSummaries.map((n) => n.header))
    return headers
      .filter((h) => !numericHeaders.has(h))
      .slice(0, 3)
      .map((h) => {
        const freq = new Map<string, number>()
        rows.forEach((r) => {
          const k = String(r[h] ?? '').trim() || '(vazio)'
          freq.set(k, (freq.get(k) ?? 0) + 1)
        })
        const values = Array.from(freq.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
        return { header: h, values }
      })
      .filter((c) => c.values.length > 0)
  }, [headers, numericSummaries, rows])

  return (
    <section style={{ maxWidth: 1360, margin: '0 auto', padding: '0 12px 24px' }}>
      <h2 style={{ textAlign: 'center', margin: '10px 0 16px' }}>Estoque de Seguranca</h2>

      {loading ? <p style={{ color: '#94a3b8' }}>Carregando resumo da planilha...</p> : null}
      {error ? (
        <div style={{ border: '1px solid #7f1d1d', background: '#450a0a', color: '#fecaca', padding: 12, borderRadius: 8 }}>
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Card title="Linhas" value={String(rows.length)} />
            <Card title="Colunas" value={String(headers.length)} />
            <Card title="Metricas num." value={String(numericSummaries.length)} />
            <Card title="Origem" value={source || 'Resumo da Planilha'} />
          </div>

          <h3 style={{ margin: '8px 0' }}>Indicadores numericos</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['Campo', 'Qtd valores', 'Soma', 'Media', 'Min', 'Max'].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {numericSummaries.map((n) => (
                  <tr key={n.header}>
                    <td style={td}>{n.header}</td>
                    <td style={td}>{n.count}</td>
                    <td style={td}>{n.sum.toLocaleString('pt-BR')}</td>
                    <td style={td}>{n.avg.toLocaleString('pt-BR')}</td>
                    <td style={td}>{n.min.toLocaleString('pt-BR')}</td>
                    <td style={td}>{n.max.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {categoryCharts.length ? <h3 style={{ margin: '8px 0' }}>Graficos por categorias</h3> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
            {categoryCharts.map((chart) => {
              const max = Math.max(...chart.values.map((v) => v.count), 1)
              return (
                <div key={chart.header} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{chart.header}</div>
                  {chart.values.map((v) => (
                    <div key={v.label} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
                        <strong>{v.count}</strong>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: '#1f2937' }}>
                        <div
                          style={{
                            width: `${Math.max(4, Math.round((v.count / max) * 100))}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: 'linear-gradient(90deg,#22c55e,#3b82f6)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <h3 style={{ margin: '8px 0' }}>Dados completos (Resumo da Planilha)</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`r-${idx}`}>
                    {headers.map((h) => (
                      <td key={`${idx}-${h}`} style={td}>{r[h] || '-'}</td>
                    ))}
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

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--code-bg)' }}>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
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
