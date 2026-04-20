import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '../lib/supabaseClient'

type TabKey = 'temperatura' | 'ocupacao'

type Conferente = { id: string; nome: string }

type TempRow = {
  id: string
  data_registro: string
  conferente_nome: string
  camara11_temp: number
  camara12_temp: number
  camara13_temp: number
  created_at: string
}

type OcupRow = {
  id: string
  data_registro: string
  conferente_nome: string
  camara6_vazias: number
  camara7_vazias: number
  camara8_vazias: number
  created_at: string
}

const OCUP_TOTAL = {
  camara6: 68,
  camara7: 136,
  camara8: 140,
} as const

function todayYmd() {
  return new Date().toISOString().slice(0, 10)
}

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asInt(v: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

function formatDataBr(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHoraRegistro(iso: string) {
  if (!iso?.trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function TinyLineChart({
  title,
  color,
  rows,
  valueOf,
}: {
  title: string
  color: string
  rows: TempRow[]
  valueOf: (r: TempRow) => number
}) {
  const width = 360
  const height = 160
  const pad = 28
  const pointsData = useMemo(() => {
    const values = rows.map(valueOf)
    if (!values.length) return { path: '', labels: [] as string[], min: 0, max: 0, avg: 0 }
    const min = Math.min(...values)
    const max = Math.max(...values)
    const safeMin = min === max ? min - 1 : min
    const safeMax = min === max ? max + 1 : max
    const stepX = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0
    const points = rows.map((r, idx) => {
      const v = valueOf(r)
      const x = pad + stepX * idx
      const norm = (v - safeMin) / (safeMax - safeMin)
      const y = height - pad - norm * (height - pad * 2)
      return { x, y, value: v, label: r.data_registro.slice(5) }
    })
    const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
    const avg = values.reduce((acc, n) => acc + n, 0) / values.length
    return { path, labels: points.map((p) => p.label), min, max, avg }
  }, [rows, valueOf])

  return (
    <div
      style={{
        border: '1px solid var(--border, #2e303a)',
        borderRadius: 12,
        padding: 10,
        background: 'var(--code-bg, #1f2028)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, color }}>
        {title}
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
            <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#64748b" strokeWidth="1" />
            <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#64748b" strokeWidth="1" />
            <path d={pointsData.path} stroke={color} strokeWidth="3" fill="none" />
          </svg>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text, #9ca3af)' }}>
            <span>Min: {pointsData.min.toFixed(1)}°C</span>
            <span>Max: {pointsData.max.toFixed(1)}°C</span>
            <span>Média: {pointsData.avg.toFixed(1)}°C</span>
          </div>
        </>
      )}
    </div>
  )
}

function CombinedTempChart({ rows }: { rows: TempRow[] }) {
  const width = 640
  const height = 200
  const pad = 36
  const series = useMemo(
    () =>
      [
        { color: '#22c55e', valueOf: (r: TempRow) => r.camara11_temp, label: 'Câmara 11' },
        { color: '#38bdf8', valueOf: (r: TempRow) => r.camara12_temp, label: 'Câmara 12' },
        { color: '#f59e0b', valueOf: (r: TempRow) => r.camara13_temp, label: 'Câmara 13' },
      ] as const,
    [],
  )

  const chart = useMemo(() => {
    if (!rows.length) return { paths: [] as { d: string; color: string; label: string }[], min: 0, max: 0 }
    const allVals = rows.flatMap((r) => [r.camara11_temp, r.camara12_temp, r.camara13_temp])
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const safeMin = min === max ? min - 1 : min
    const safeMax = min === max ? max + 1 : max
    const stepX = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0
    const paths = series.map((s) => {
      const pts = rows.map((r, idx) => {
        const v = s.valueOf(r)
        const x = pad + stepX * idx
        const norm = (v - safeMin) / (safeMax - safeMin)
        const y = height - pad - norm * (height - pad * 2)
        return { x, y }
      })
      const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
      return { d, color: s.color, label: s.label }
    })
    return { paths, min, max }
  }, [rows, series])

  return (
    <div
      style={{
        border: '1px solid var(--border, #2e303a)',
        borderRadius: 12,
        padding: 10,
        background: 'var(--code-bg, #1f2028)',
        gridColumn: '1 / -1',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, color: '#a7f3d0' }}>Comparativo — Câmaras 11, 12 e 13</div>
      {!rows.length ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
            <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#64748b" strokeWidth="1" />
            <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#64748b" strokeWidth="1" />
            {chart.paths.map((p) => (
              <path key={p.label} d={p.d} stroke={p.color} strokeWidth="2.5" fill="none" />
            ))}
          </svg>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 12 }}>
            {chart.paths.map((p) => (
              <span key={p.label} style={{ color: p.color, fontWeight: 600 }}>
                <span style={{ opacity: 0.9 }}>●</span> {p.label}
              </span>
            ))}
            <span style={{ color: 'var(--text, #9ca3af)' }}>
              Escala: {chart.min.toFixed(1)}°C — {chart.max.toFixed(1)}°C
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default function ContagemDiariaAmbiental() {
  const [tab, setTab] = useState<TabKey>('temperatura')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)
  const [tempConferenteId, setTempConferenteId] = useState('')
  const [tempData, setTempData] = useState(todayYmd())
  const [cam11, setCam11] = useState('')
  const [cam12, setCam12] = useState('')
  const [cam13, setCam13] = useState('')
  const [tempRows, setTempRows] = useState<TempRow[]>([])

  const [ocupConferenteId, setOcupConferenteId] = useState('')
  const [ocupData, setOcupData] = useState(todayYmd())
  const [vazias6, setVazias6] = useState('')
  const [vazias7, setVazias7] = useState('')
  const [vazias8, setVazias8] = useState('')
  const [ocupRows, setOcupRows] = useState<OcupRow[]>([])

  async function loadTempRows() {
    const { data, error: qErr } = await supabase
      .from('contagem_temperatura_camaras')
      .select('id,data_registro,conferente_nome,camara11_temp,camara12_temp,camara13_temp,created_at')
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60)
    if (qErr) throw qErr
    setTempRows((data || []).reverse().map((r) => ({ ...r, camara11_temp: asNum(r.camara11_temp), camara12_temp: asNum(r.camara12_temp), camara13_temp: asNum(r.camara13_temp) })))
  }

  async function loadConferentes() {
    const { data, error: qErr } = await supabase.from('conferentes').select('id,nome').order('nome')
    if (qErr) throw qErr
    setConferentes(data ?? [])
  }

  async function loadOcupRows() {
    const { data, error: qErr } = await supabase
      .from('contagem_ocupacao_camaras')
      .select('id,data_registro,conferente_nome,camara6_vazias,camara7_vazias,camara8_vazias,created_at')
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40)
    if (qErr) throw qErr
    setOcupRows(
      (data || []).map((r) => ({
        ...r,
        camara6_vazias: asNum(r.camara6_vazias),
        camara7_vazias: asNum(r.camara7_vazias),
        camara8_vazias: asNum(r.camara8_vazias),
      })),
    )
  }

  useEffect(() => {
    void (async () => {
      setError(null)
      try {
        setConferentesLoading(true)
        await Promise.all([loadTempRows(), loadOcupRows(), loadConferentes()])
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.message}. Se for tabela não encontrada, rode o SQL create_contagem_diaria_temperatura_ocupacao.sql.`
            : 'Erro ao carregar dados.',
        )
      } finally {
        setConferentesLoading(false)
      }
    })()
  }, [])

  async function salvarTemperatura() {
    setError(null)
    setOk(null)
    const nomeConf = conferentes.find((c) => c.id === tempConferenteId)?.nome?.trim() ?? ''
    if (!nomeConf) {
      setError('Selecione o conferente.')
      return
    }
    if (!tempData) {
      setError('Selecione a data.')
      return
    }
    if (cam11.trim() === '' || cam12.trim() === '' || cam13.trim() === '') {
      setError('Preencha as três temperaturas (Câmaras 11, 12 e 13).')
      return
    }
    setLoading(true)
    try {
      const payload = {
        data_registro: tempData,
        conferente_nome: nomeConf,
        camara11_temp: asNum(cam11),
        camara12_temp: asNum(cam12),
        camara13_temp: asNum(cam13),
      }
      const { error: insErr } = await supabase.from('contagem_temperatura_camaras').insert(payload)
      if (insErr) throw insErr
      setCam11('')
      setCam12('')
      setCam13('')
      await loadTempRows()
      setOk('Temperatura salva com sucesso.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar temperatura.')
    } finally {
      setLoading(false)
    }
  }

  async function salvarOcupacao() {
    setError(null)
    setOk(null)
    const nomeConfOcup = conferentes.find((c) => c.id === ocupConferenteId)?.nome?.trim() ?? ''
    if (!nomeConfOcup) {
      setError('Selecione o conferente.')
      return
    }
    if (!ocupData) {
      setError('Selecione a data.')
      return
    }
    if (vazias6.trim() === '' || vazias7.trim() === '' || vazias8.trim() === '') {
      setError('Preencha as posições vazias das 3 câmaras.')
      return
    }
    const v6 = asInt(vazias6)
    const v7 = asInt(vazias7)
    const v8 = asInt(vazias8)
    if (v6 > OCUP_TOTAL.camara6 || v7 > OCUP_TOTAL.camara7 || v8 > OCUP_TOTAL.camara8) {
      setError('Uma ou mais câmaras têm vagas maiores que o total de posições.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        data_registro: ocupData,
        conferente_nome: nomeConfOcup,
        camara6_vazias: v6,
        camara7_vazias: v7,
        camara8_vazias: v8,
      }
      const { error: insErr } = await supabase.from('contagem_ocupacao_camaras').insert(payload)
      if (insErr) throw insErr
      await loadOcupRows()
      setOk('Ocupação salva com sucesso.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar ocupação.')
    } finally {
      setLoading(false)
    }
  }

  /** Mais recentes primeiro — para histórico em tabela. */
  const tempHistoricoDesc = useMemo(() => [...tempRows].reverse(), [tempRows])

  const ocupResumoAtual = useMemo(() => {
    const v6 = asInt(vazias6)
    const v7 = asInt(vazias7)
    const v8 = asInt(vazias8)
    const o6 = Math.max(0, OCUP_TOTAL.camara6 - v6)
    const o7 = Math.max(0, OCUP_TOTAL.camara7 - v7)
    const o8 = Math.max(0, OCUP_TOTAL.camara8 - v8)
    const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
    const totalOcup = o6 + o7 + o8
    const totalVaz = v6 + v7 + v8
    return {
      o6,
      o7,
      o8,
      totalPos,
      totalOcup,
      totalVaz,
      percOcup: totalPos > 0 ? (totalOcup / totalPos) * 100 : 0,
      percLivre: totalPos > 0 ? (totalVaz / totalPos) * 100 : 0,
    }
  }, [vazias6, vazias7, vazias8])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 14px 18px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setTab('temperatura')}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${tab === 'temperatura' ? '#22c55e' : 'var(--border, #2e303a)'}`,
            background: tab === 'temperatura' ? '#22c55e' : 'transparent',
            color: tab === 'temperatura' ? '#06250f' : '#22c55e',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Temperatura
        </button>
        <button
          type="button"
          onClick={() => setTab('ocupacao')}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${tab === 'ocupacao' ? '#38bdf8' : 'var(--border, #2e303a)'}`,
            background: tab === 'ocupacao' ? '#38bdf8' : 'transparent',
            color: tab === 'ocupacao' ? '#082131' : '#38bdf8',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Ocupação
        </button>
      </div>

      {ok ? (
        <div style={{ marginBottom: 10, border: '1px solid #15803d', background: 'rgba(21,128,61,.2)', color: '#bbf7d0', borderRadius: 8, padding: '8px 10px' }}>
          {ok}
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 10, border: '1px solid #b91c1c', background: 'rgba(127,29,29,.35)', color: '#fecaca', borderRadius: 8, padding: '8px 10px' }}>
          {error}
        </div>
      ) : null}

      {tab === 'temperatura' ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#22c55e' }}>Lançar temperatura diária</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Conferente</span>
                <select
                  value={tempConferenteId}
                  onChange={(e) => setTempConferenteId(e.target.value)}
                  disabled={conferentesLoading}
                >
                  <option value="">{conferentesLoading ? 'Carregando...' : 'Selecione...'}</option>
                  {conferentes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Data</span>
                <input type="date" value={tempData} onChange={(e) => setTempData(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 11 (°C)</span>
                <input value={cam11} onChange={(e) => setCam11(e.target.value)} type="number" step="0.1" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 12 (°C)</span>
                <input value={cam12} onChange={(e) => setCam12(e.target.value)} type="number" step="0.1" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 13 (°C)</span>
                <input value={cam13} onChange={(e) => setCam13(e.target.value)} type="number" step="0.1" />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void salvarTemperatura()}
              disabled={loading}
              style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: '1px solid #16a34a', background: '#22c55e', color: '#052e16', fontWeight: 700 }}
            >
              {loading ? 'Salvando...' : 'Salvar temperatura'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <TinyLineChart title="Câmara 11" color="#22c55e" rows={tempRows} valueOf={(r) => r.camara11_temp} />
            <TinyLineChart title="Câmara 12" color="#38bdf8" rows={tempRows} valueOf={(r) => r.camara12_temp} />
            <TinyLineChart title="Câmara 13" color="#f59e0b" rows={tempRows} valueOf={(r) => r.camara13_temp} />
            <CombinedTempChart rows={tempRows} />
          </div>

          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#22c55e' }}>Histórico de registros (temperatura)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Conferente</th>
                  <th style={th}>Data</th>
                  <th style={th}>Hora do registro</th>
                  <th style={{ ...th, color: '#22c55e' }}>Câm. 11 (°C)</th>
                  <th style={{ ...th, color: '#38bdf8' }}>Câm. 12 (°C)</th>
                  <th style={{ ...th, color: '#f59e0b' }}>Câm. 13 (°C)</th>
                </tr>
              </thead>
              <tbody>
                {tempHistoricoDesc.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, color: 'var(--text, #9ca3af)' }}>
                      Nenhum registro ainda.
                    </td>
                  </tr>
                ) : (
                  tempHistoricoDesc.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{r.conferente_nome}</td>
                      <td style={td}>{formatDataBr(r.data_registro)}</td>
                      <td style={td}>{formatHoraRegistro(r.created_at)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara11_temp.toFixed(1)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara12_temp.toFixed(1)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara13_temp.toFixed(1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#38bdf8' }}>Lançar ocupação (somente posições vazias)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Conferente</span>
                <select
                  value={ocupConferenteId}
                  onChange={(e) => setOcupConferenteId(e.target.value)}
                  disabled={conferentesLoading}
                >
                  <option value="">{conferentesLoading ? 'Carregando...' : 'Selecione...'}</option>
                  {conferentes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Data</span>
                <input type="date" value={ocupData} onChange={(e) => setOcupData(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 6 — vazias</span>
                <input value={vazias6} onChange={(e) => setVazias6(e.target.value)} type="number" min="0" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 7 — vazias</span>
                <input value={vazias7} onChange={(e) => setVazias7(e.target.value)} type="number" min="0" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 8 — vazias</span>
                <input value={vazias8} onChange={(e) => setVazias8(e.target.value)} type="number" min="0" />
              </label>
            </div>

            <div style={{ marginTop: 12, border: '1px solid var(--border, #2e303a)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumo automático</div>
              <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
                <div>Câmara 6: {ocupResumoAtual.o6} ocupadas / {asInt(vazias6)} vazias (total {OCUP_TOTAL.camara6})</div>
                <div>Câmara 7: {ocupResumoAtual.o7} ocupadas / {asInt(vazias7)} vazias (total {OCUP_TOTAL.camara7})</div>
                <div>Câmara 8: {ocupResumoAtual.o8} ocupadas / {asInt(vazias8)} vazias (total {OCUP_TOTAL.camara8})</div>
                <div style={{ marginTop: 4, fontWeight: 700 }}>
                  Total: {ocupResumoAtual.totalOcup} ocupadas / {ocupResumoAtual.totalVaz} vazias
                  {' '}| % Ocupada: {ocupResumoAtual.percOcup.toFixed(0)}% | % Livre: {ocupResumoAtual.percLivre.toFixed(0)}%
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void salvarOcupacao()}
              disabled={loading}
              style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: '1px solid #0ea5e9', background: '#38bdf8', color: '#082f49', fontWeight: 700 }}
            >
              {loading ? 'Salvando...' : 'Salvar ocupação'}
            </button>
          </div>

          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Últimos lançamentos de ocupação</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Data</th>
                  <th style={th}>Conferente</th>
                  <th style={th}>Cam 6 (vazias)</th>
                  <th style={th}>Cam 7 (vazias)</th>
                  <th style={th}>Cam 8 (vazias)</th>
                  <th style={th}>Total ocupadas</th>
                  <th style={th}>% Ocupada</th>
                </tr>
              </thead>
              <tbody>
                {ocupRows.map((r) => {
                  const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
                  const totalVaz = r.camara6_vazias + r.camara7_vazias + r.camara8_vazias
                  const totalOcup = totalPos - totalVaz
                  const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
                  return (
                    <tr key={r.id}>
                      <td style={td}>{r.data_registro}</td>
                      <td style={td}>{r.conferente_nome}</td>
                      <td style={td}>{r.camara6_vazias}</td>
                      <td style={td}>{r.camara7_vazias}</td>
                      <td style={td}>{r.camara8_vazias}</td>
                      <td style={td}>{totalOcup}</td>
                      <td style={td}>{percOcup.toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 13,
}

const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 13,
}
