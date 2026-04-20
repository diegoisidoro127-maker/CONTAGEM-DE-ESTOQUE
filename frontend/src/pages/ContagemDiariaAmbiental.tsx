import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
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

/** Data no eixo dos gráficos: dd/mm/aaaa (aproveita o mesmo formato do restante da tela). */
function formatAxisDateChart(ymd: string) {
  if (!ymd) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return formatDataBr(ymd)
  if (ymd.length >= 10) return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
  return ymd
}

/** Curva suave tipo Catmull-Rom → cúbicas de Bézier. */
function smoothLinePath(points: { x: number; y: number }[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M ${points[0].x} ${points[0].y}`
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(n - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

const chartCardStyle: CSSProperties = {
  borderRadius: 14,
  padding: 12,
  minWidth: 0,
  background: 'linear-gradient(165deg, rgba(36,38,48,.95) 0%, rgba(24,25,32,.98) 100%)',
  border: '1px solid rgba(255,255,255,.07)',
  boxShadow: '0 8px 32px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05)',
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
  const uid = useId().replace(/:/g, '')
  const gradId = `tgrad-${uid}`
  const width = 520
  const height = 218
  const padL = 48
  const padR = 14
  const padT = 16
  const padB = 40
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH

  const geom = useMemo(() => {
    const values = rows.map(valueOf)
    if (!values.length) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const safeMin = min === max ? min - 1 : min
    const safeMax = min === max ? max + 1 : max
    const rng = safeMax - safeMin
    const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
    const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
    const pts = rows.map((r, i) => ({ x: xAt(i), y: yAt(valueOf(r)) }))
    const lineD = smoothLinePath(pts)
    const last = pts[pts.length - 1]
    const first = pts[0]
    const areaD = `${lineD} L ${last.x.toFixed(2)} ${bottomY.toFixed(2)} L ${first.x.toFixed(2)} ${bottomY.toFixed(2)} Z`
    const yTicks = [safeMax, safeMin + rng / 2, safeMin].map((v) => ({ v, y: yAt(v) }))
    const n = rows.length
    const xIdx =
      n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
    const xLabels = [...new Set(xIdx)]
      .sort((a, b) => a - b)
      .map((i) => ({ x: xAt(i), text: formatAxisDateChart(rows[i].data_registro) }))
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    return { lineD, areaD, yTicks, xLabels, min, max, avg }
  }, [rows, valueOf, innerW, innerH, padL, padT, bottomY])

  return (
    <div style={chartCardStyle}>
      <div style={{ fontWeight: 700, marginBottom: 10, color, fontSize: 15, letterSpacing: '0.02em' }}>{title}</div>
      {!rows.length || !geom ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="55%" stopColor={color} stopOpacity={0.06} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={width} height={height} rx={6} fill="rgba(0,0,0,.15)" />
            {geom.yTicks.map((t, i) => (
              <line
                key={i}
                x1={padL}
                y1={t.y}
                x2={width - padR}
                y2={t.y}
                stroke="rgba(148,163,184,.14)"
                strokeDasharray="5 6"
                strokeWidth={1}
              />
            ))}
            <path d={geom.areaD} fill={`url(#${gradId})`} />
            <path
              d={geom.lineD}
              stroke={color}
              strokeWidth={2.75}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
            />
            {geom.yTicks.map((t, i) => (
              <text
                key={`yl-${i}`}
                x={padL - 8}
                y={t.y + 4}
                textAnchor="end"
                fill="#94a3b8"
                fontSize={10}
                fontFamily="system-ui, sans-serif"
              >
                {t.v.toFixed(1)}°
              </text>
            ))}
            <line
              x1={padL}
              y1={bottomY}
              x2={width - padR}
              y2={bottomY}
              stroke="rgba(148,163,184,.35)"
              strokeWidth={1.2}
            />
            <line
              x1={padL}
              y1={padT}
              x2={padL}
              y2={bottomY}
              stroke="rgba(148,163,184,.35)"
              strokeWidth={1.2}
            />
            {geom.xLabels.map((xl, i) => (
              <text
                key={`xl-${i}`}
                x={xl.x}
                y={height - 8}
                textAnchor="middle"
                fill="#64748b"
                fontSize={9}
                fontFamily="system-ui, sans-serif"
              >
                {xl.text}
              </text>
            ))}
          </svg>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
              marginTop: 12,
              fontSize: 11,
              color: 'var(--text, #9ca3af)',
              paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,.06)',
            }}
          >
            <span style={{ textAlign: 'center' }}>
              Min: <strong style={{ color: '#e2e8f0' }}>{geom.min.toFixed(1)}°C</strong>
            </span>
            <span style={{ textAlign: 'center' }}>
              Max: <strong style={{ color: '#e2e8f0' }}>{geom.max.toFixed(1)}°C</strong>
            </span>
            <span style={{ textAlign: 'center' }}>
              Média: <strong style={{ color: '#e2e8f0' }}>{geom.avg.toFixed(1)}°C</strong>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const COMBINED_SERIES = [
  { color: '#22c55e', valueOf: (r: TempRow) => r.camara11_temp, label: 'Câmara 11' },
  { color: '#38bdf8', valueOf: (r: TempRow) => r.camara12_temp, label: 'Câmara 12' },
  { color: '#f59e0b', valueOf: (r: TempRow) => r.camara13_temp, label: 'Câmara 13' },
] as const

function CombinedTempChart({ rows }: { rows: TempRow[] }) {
  const uid = useId().replace(/:/g, '')
  const width = 1100
  const height = 268
  const padL = 52
  const padR = 16
  const padT = 18
  const padB = 42
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH

  const chart = useMemo(() => {
    if (!rows.length) return null
    const allVals = rows.flatMap((r) => [r.camara11_temp, r.camara12_temp, r.camara13_temp])
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const safeMin = min === max ? min - 1 : min
    const safeMax = min === max ? max + 1 : max
    const rng = safeMax - safeMin
    const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
    const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
    const seriesPaths = COMBINED_SERIES.map((s, si) => {
      const pts = rows.map((r, i) => {
        const v = s.valueOf(r)
        return { x: xAt(i), y: yAt(v) }
      })
      return {
        lineD: smoothLinePath(pts),
        color: s.color,
        label: s.label,
        gradId: `cgrad-${uid}-${si}`,
      }
    })
    const yTicks = [safeMax, safeMin + rng / 2, safeMin].map((v) => ({ v, y: yAt(v) }))
    const n = rows.length
    const xIdx =
      n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
    const xLabels = [...new Set(xIdx)]
      .sort((a, b) => a - b)
      .map((i) => ({ x: xAt(i), text: formatAxisDateChart(rows[i].data_registro) }))
    return { seriesPaths, yTicks, xLabels, min, max }
  }, [rows, innerW, innerH, padL, padT, bottomY, uid])

  return (
    <div style={chartCardStyle}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 10,
          fontSize: 16,
          letterSpacing: '0.02em',
          background: 'linear-gradient(90deg, #a7f3d0, #6ee7b7)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Comparativo — Câmaras 11, 12 e 13
      </div>
      {!rows.length || !chart ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
            <defs>
              {chart.seriesPaths.map((p) => (
                <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={p.color} stopOpacity={0.2} />
                  <stop offset="70%" stopColor={p.color} stopOpacity={0.03} />
                  <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <rect x={0} y={0} width={width} height={height} rx={8} fill="rgba(0,0,0,.12)" />
            {chart.yTicks.map((t, i) => (
              <line
                key={i}
                x1={padL}
                y1={t.y}
                x2={width - padR}
                y2={t.y}
                stroke="rgba(148,163,184,.12)"
                strokeDasharray="5 6"
                strokeWidth={1}
              />
            ))}
            {chart.seriesPaths.map((p) => {
              const lineD = p.lineD
              const pts = rows.map((_, i) => ({
                x: padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2),
              }))
              const lastX = pts[pts.length - 1]?.x ?? padL
              const firstX = pts[0]?.x ?? padL
              const areaD = `${lineD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`
              return <path key={p.label} d={areaD} fill={`url(#${p.gradId})`} opacity={0.85} />
            })}
            {chart.seriesPaths.map((p) => (
              <path
                key={`line-${p.label}`}
                d={p.lineD}
                stroke={p.color}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 5px ${p.color}44)` }}
              />
            ))}
            {chart.yTicks.map((t, i) => (
              <text
                key={`cyl-${i}`}
                x={padL - 8}
                y={t.y + 4}
                textAnchor="end"
                fill="#94a3b8"
                fontSize={10}
                fontFamily="system-ui, sans-serif"
              >
                {t.v.toFixed(1)}°
              </text>
            ))}
            <line
              x1={padL}
              y1={bottomY}
              x2={width - padR}
              y2={bottomY}
              stroke="rgba(148,163,184,.35)"
              strokeWidth={1.2}
            />
            <line
              x1={padL}
              y1={padT}
              x2={padL}
              y2={bottomY}
              stroke="rgba(148,163,184,.35)"
              strokeWidth={1.2}
            />
            {chart.xLabels.map((xl, i) => (
              <text
                key={`cxl-${i}`}
                x={xl.x}
                y={height - 10}
                textAnchor="middle"
                fill="#64748b"
                fontSize={9}
                fontFamily="system-ui, sans-serif"
              >
                {xl.text}
              </text>
            ))}
          </svg>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              marginTop: 12,
              fontSize: 12,
              paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,.06)',
            }}
          >
            {chart.seriesPaths.map((p) => (
              <span key={p.label} style={{ color: p.color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                {p.label}
              </span>
            ))}
            <span style={{ color: 'var(--text, #9ca3af)', marginLeft: 'auto' }}>
              Escala: <strong style={{ color: '#cbd5e1' }}>{chart.min.toFixed(1)}°C</strong> —{' '}
              <strong style={{ color: '#cbd5e1' }}>{chart.max.toFixed(1)}°C</strong>
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

  /** Primeiro item = mais recente (data + horário do registro). */
  const ocupResumoDiaSalvo = useMemo(() => {
    const r = ocupRows[0]
    if (!r) return null
    const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
    const totalVaz = r.camara6_vazias + r.camara7_vazias + r.camara8_vazias
    const totalOcup = totalPos - totalVaz
    const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
    const percLivre = totalPos > 0 ? (totalVaz / totalPos) * 100 : 0
    return { r, totalPos, totalVaz, totalOcup, percOcup, percLivre }
  }, [ocupRows])

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '0 16px 22px', width: '100%', boxSizing: 'border-box' }}>
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

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <TinyLineChart title="Câmara 11" color="#22c55e" rows={tempRows} valueOf={(r) => r.camara11_temp} />
            <TinyLineChart title="Câmara 12" color="#38bdf8" rows={tempRows} valueOf={(r) => r.camara12_temp} />
            <TinyLineChart title="Câmara 13" color="#f59e0b" rows={tempRows} valueOf={(r) => r.camara13_temp} />
          </div>
          <CombinedTempChart rows={tempRows} />

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

          {ocupResumoDiaSalvo ? (
            <div
              style={{
                borderRadius: 16,
                padding: '22px 24px',
                marginBottom: 4,
                background: 'linear-gradient(135deg, rgba(14,165,233,.18) 0%, rgba(15,23,42,.95) 45%, rgba(8,47,72,.4) 100%)',
                border: '1px solid rgba(56,189,248,.4)',
                boxShadow: '0 14px 48px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.09)',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: '#7dd3fc',
                  marginBottom: 8,
                }}
              >
                Resumo do dia
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '12px 20px', marginBottom: 18 }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.15 }}>
                  {formatDataBr(ocupResumoDiaSalvo.r.data_registro)}
                </div>
                <div style={{ fontSize: 14, color: '#94a3b8' }}>
                  Registro às <strong style={{ color: '#e0f2fe' }}>{formatHoraRegistro(ocupResumoDiaSalvo.r.created_at)}</strong>
                  {' · '}
                  Conferente: <strong style={{ color: '#e0f2fe' }}>{ocupResumoDiaSalvo.r.conferente_nome}</strong>
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    background: 'rgba(0,0,0,.2)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    border: '1px solid rgba(56,189,248,.2)',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 6 }}>Posições ocupadas</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#38bdf8' }}>{ocupResumoDiaSalvo.totalOcup}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>de {ocupResumoDiaSalvo.totalPos} totais</div>
                </div>
                <div
                  style={{
                    background: 'rgba(0,0,0,.2)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    border: '1px solid rgba(52,211,153,.25)',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#6ee7b7', marginBottom: 6 }}>Posições livres</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#34d399' }}>{ocupResumoDiaSalvo.totalVaz}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>vagas vazias (soma das 3 câmaras)</div>
                </div>
                <div
                  style={{
                    background: 'rgba(0,0,0,.2)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    border: '1px solid rgba(251,191,36,.22)',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#fcd34d', marginBottom: 6 }}>% Ocupada</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fbbf24' }}>{ocupResumoDiaSalvo.percOcup.toFixed(0)}%</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>% livre: {ocupResumoDiaSalvo.percLivre.toFixed(0)}%</div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid rgba(255,255,255,.08)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                  fontSize: 13,
                  color: '#94a3b8',
                }}
              >
                <div>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Cam 6:</span> {ocupResumoDiaSalvo.r.camara6_vazias} vazias ·{' '}
                  {OCUP_TOTAL.camara6 - ocupResumoDiaSalvo.r.camara6_vazias} ocupadas
                </div>
                <div>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Cam 7:</span> {ocupResumoDiaSalvo.r.camara7_vazias} vazias ·{' '}
                  {OCUP_TOTAL.camara7 - ocupResumoDiaSalvo.r.camara7_vazias} ocupadas
                </div>
                <div>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Cam 8:</span> {ocupResumoDiaSalvo.r.camara8_vazias} vazias ·{' '}
                  {OCUP_TOTAL.camara8 - ocupResumoDiaSalvo.r.camara8_vazias} ocupadas
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                borderRadius: 14,
                padding: '18px 20px',
                marginBottom: 4,
                background: 'rgba(15,23,42,.6)',
                border: '1px dashed rgba(56,189,248,.3)',
                color: '#94a3b8',
                fontSize: 14,
              }}
            >
              <strong style={{ color: '#7dd3fc' }}>Resumo do dia:</strong> ainda não há lançamentos de ocupação salvos.
            </div>
          )}

          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Últimos lançamentos de ocupação</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={th}>Data</th>
                  <th style={th}>Conferente</th>
                  <th style={th}>Cam 6 (vazias)</th>
                  <th style={th}>Cam 7 (vazias)</th>
                  <th style={th}>Cam 8 (vazias)</th>
                  <th style={th}>Livre</th>
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
                      <td style={td}>{formatDataBr(r.data_registro)}</td>
                      <td style={td}>{r.conferente_nome}</td>
                      <td style={td}>{r.camara6_vazias}</td>
                      <td style={td}>{r.camara7_vazias}</td>
                      <td style={td}>{r.camara8_vazias}</td>
                      <td style={{ ...td, color: '#6ee7b7', fontWeight: 600 }}>{totalVaz}</td>
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
