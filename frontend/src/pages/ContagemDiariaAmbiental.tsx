import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
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
  /** Somado ao total de ocupadas (além do cálculo pelas vazias). */
  avaria_acrescimo_ocupacao: number
  created_at: string
}

const OCUP_TOTAL = {
  camara6: 68,
  camara7: 136,
  camara8: 140,
} as const

/** Linhas por página nos históricos (temperatura e ocupação). */
const HIST_PAGE_SIZE = 5

function HistoricoPaginacaoBar({
  page,
  totalItems,
  pageSize,
  onPageChange,
  accent,
}: {
  page: number
  totalItems: number
  pageSize: number
  onPageChange: (p: number) => void
  accent: string
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages
  if (totalItems === 0) return null
  const btn = (disabled: boolean): CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${disabled ? 'var(--border, #2e303a)' : accent}`,
    background: disabled ? 'transparent' : 'rgba(255,255,255,.06)',
    color: disabled ? '#64748b' : accent,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
  })
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginTop: 12,
      }}
    >
      <span style={{ fontSize: 13, color: '#94a3b8' }}>
        Página {page} de {totalPages} · {totalItems} registro(s)
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!canPrev} style={btn(!canPrev)} onClick={() => onPageChange(page - 1)}>
          Anterior
        </button>
        <button type="button" disabled={!canNext} style={btn(!canNext)} onClick={() => onPageChange(page + 1)}>
          Próxima
        </button>
      </div>
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

/** Marcas lineares no eixo Y (mais legível que só 3 linhas). */
function linearYTicks(safeMin: number, safeMax: number, yAt: (v: number) => number, count = 5) {
  const ticks: { v: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const v = safeMax - (safeMax - safeMin) * t
    ticks.push({ v, y: yAt(v) })
  }
  return ticks
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
  const padB = 44
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
    const yTicks = linearYTicks(safeMin, safeMax, yAt, 5)
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
            <rect x={0} y={0} width={width} height={height} rx={8} fill="rgba(0,0,0,.18)" />
            {geom.xLabels.map((xl, i) => (
              <line
                key={`xg-${i}`}
                x1={xl.x}
                y1={padT}
                x2={xl.x}
                y2={bottomY}
                stroke="rgba(148,163,184,.08)"
                strokeWidth={1}
              />
            ))}
            {geom.yTicks.map((t, i) => (
              <line
                key={i}
                x1={padL}
                y1={t.y}
                x2={width - padR}
                y2={t.y}
                stroke="rgba(148,163,184,.2)"
                strokeDasharray="4 8"
                strokeWidth={1}
              />
            ))}
            <path d={geom.areaD} fill={`url(#${gradId})`} />
            <path
              d={geom.lineD}
              stroke={color}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 8px ${color}66)` }}
            />
            {geom.yTicks.map((t, i) => (
              <text
                key={`yl-${i}`}
                x={padL - 10}
                y={t.y + 4}
                textAnchor="end"
                fill="#cbd5e1"
                fontSize={11}
                fontFamily="system-ui, sans-serif"
              >
                {t.v.toFixed(1)}°C
              </text>
            ))}
            <line
              x1={padL}
              y1={bottomY}
              x2={width - padR}
              y2={bottomY}
              stroke="rgba(148,163,184,.45)"
              strokeWidth={1.5}
            />
            <line
              x1={padL}
              y1={padT}
              x2={padL}
              y2={bottomY}
              stroke="rgba(148,163,184,.45)"
              strokeWidth={1.5}
            />
            <text
              x={padL}
              y={padT - 4}
              fill="#64748b"
              fontSize={10}
              fontFamily="system-ui, sans-serif"
            >
              °C
            </text>
            {geom.xLabels.map((xl, i) => (
              <text
                key={`xl-${i}`}
                x={xl.x}
                y={height - 10}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={10}
                fontFamily="system-ui, sans-serif"
              >
                {xl.text}
              </text>
            ))}
          </svg>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              marginTop: 12,
              fontSize: 12,
              color: 'var(--text, #9ca3af)',
              paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,.08)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 220, gap: 12 }}>
              <span>Min.</span>
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{geom.min.toFixed(1)} °C</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 220, gap: 12 }}>
              <span>Máx.</span>
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{geom.max.toFixed(1)} °C</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 220, gap: 12 }}>
              <span>Média</span>
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{geom.avg.toFixed(1)} °C</strong>
            </div>
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
  const height = 278
  const padL = 54
  const padR = 18
  const padT = 20
  const padB = 48
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)

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
    const yTicks = linearYTicks(safeMin, safeMax, yAt, 5)
    const n = rows.length
    const xIdx =
      n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
    const xLabels = [...new Set(xIdx)]
      .sort((a, b) => a - b)
      .map((i) => ({ x: xAt(i), text: formatAxisDateChart(rows[i].data_registro) }))
    return { seriesPaths, yTicks, xLabels, min, max, xAt, yAt }
  }, [rows, innerW, innerH, padL, padT, bottomY, uid])

  const onSvgMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!rows.length || !chart) return
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width
      const n = rows.length
      if (vx < padL || vx > width - padR) {
        setTip(null)
        return
      }
      const step = n > 1 ? innerW / (n - 1) : 0
      let idx = n <= 1 ? 0 : Math.round((vx - padL) / step)
      idx = Math.max(0, Math.min(n - 1, idx))
      const xCenter = padL + step * idx
      setTip({ idx, pxPct: (xCenter / width) * 100 })
    },
    [rows.length, chart, width, padL, padR, innerW],
  )

  const onSvgLeave = useCallback(() => setTip(null), [])

  return (
    <div style={chartCardStyle}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 8,
          fontSize: 17,
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
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
              padding: '10px 12px',
              background: 'rgba(0,0,0,.2)',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,.06)',
            }}
          >
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginRight: 4 }}>Legenda</span>
            {chart.seriesPaths.map((p) => (
              <span
                key={p.label}
                style={{
                  color: '#e2e8f0',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${p.color}55`,
                  background: `${p.color}14`,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                {p.label}
              </span>
            ))}
            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
              Passe o mouse no gráfico para ver valores por data
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            {tip != null && rows[tip.idx] ? (
              <div
                style={{
                  position: 'absolute',
                  left: `${tip.pxPct}%`,
                  top: 6,
                  transform: 'translateX(-50%)',
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 200,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'rgba(15,23,42,.94)',
                  border: '1px solid rgba(56,189,248,.35)',
                  boxShadow: '0 12px 40px rgba(0,0,0,.45)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: '#e0f2fe', marginBottom: 8 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#22c55e' }}>
                    Câm. 11: <strong>{rows[tip.idx].camara11_temp.toFixed(1)} °C</strong>
                  </div>
                  <div style={{ color: '#38bdf8' }}>
                    Câm. 12: <strong>{rows[tip.idx].camara12_temp.toFixed(1)} °C</strong>
                  </div>
                  <div style={{ color: '#f59e0b' }}>
                    Câm. 13: <strong>{rows[tip.idx].camara13_temp.toFixed(1)} °C</strong>
                  </div>
                </div>
              </div>
            ) : null}
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', cursor: 'crosshair' }}
              onMouseMove={onSvgMove}
              onMouseLeave={onSvgLeave}
            >
              <defs>
                {chart.seriesPaths.map((p) => (
                  <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.14} />
                    <stop offset="55%" stopColor={p.color} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <rect x={0} y={0} width={width} height={height} rx={10} fill="rgba(0,0,0,.16)" />
              {chart.xLabels.map((xl, i) => (
                <line
                  key={`cxg-${i}`}
                  x1={xl.x}
                  y1={padT}
                  x2={xl.x}
                  y2={bottomY}
                  stroke="rgba(148,163,184,.09)"
                  strokeWidth={1}
                />
              ))}
              {chart.yTicks.map((t, i) => (
                <line
                  key={i}
                  x1={padL}
                  y1={t.y}
                  x2={width - padR}
                  y2={t.y}
                  stroke="rgba(148,163,184,.2)"
                  strokeDasharray="4 8"
                  strokeWidth={1}
                />
              ))}
              {tip != null ? (
                <line
                  x1={chart.xAt(tip.idx)}
                  y1={padT}
                  x2={chart.xAt(tip.idx)}
                  y2={bottomY}
                  stroke="rgba(56,189,248,.35)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              ) : null}
              {chart.seriesPaths.map((p) => {
                const lineD = p.lineD
                const pts = rows.map((_, i) => ({
                  x: padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2),
                }))
                const lastX = pts[pts.length - 1]?.x ?? padL
                const firstX = pts[0]?.x ?? padL
                const areaD = `${lineD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`
                return <path key={p.label} d={areaD} fill={`url(#${p.gradId})`} opacity={0.55} />
              })}
              {chart.seriesPaths.map((p) => (
                <path
                  key={`line-${p.label}`}
                  d={p.lineD}
                  stroke={p.color}
                  strokeWidth={2.85}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 6px ${p.color}55)` }}
                />
              ))}
              {tip != null
                ? COMBINED_SERIES.map((s) => {
                    const v = s.valueOf(rows[tip.idx])
                    const cx = chart.xAt(tip.idx)
                    const cy = chart.yAt(v)
                    return (
                      <circle
                        key={`dot-${s.label}`}
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={s.color}
                        stroke="rgba(15,23,42,.92)"
                        strokeWidth={2}
                      />
                    )
                  })
                : null}
              {chart.yTicks.map((t, i) => (
                <text
                  key={`cyl-${i}`}
                  x={padL - 10}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="#cbd5e1"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {t.v.toFixed(1)}°C
                </text>
              ))}
              <text x={padL} y={padT - 2} fill="#64748b" fontSize={10} fontFamily="system-ui, sans-serif">
                °C
              </text>
              <line
                x1={padL}
                y1={bottomY}
                x2={width - padR}
                y2={bottomY}
                stroke="rgba(148,163,184,.45)"
                strokeWidth={1.5}
              />
              <line
                x1={padL}
                y1={padT}
                x2={padL}
                y2={bottomY}
                stroke="rgba(148,163,184,.45)"
                strokeWidth={1.5}
              />
              {chart.xLabels.map((xl, i) => (
                <text
                  key={`cxl-${i}`}
                  x={xl.x}
                  y={height - 12}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize={10}
                  fontFamily="system-ui, sans-serif"
                >
                  {xl.text}
                </text>
              ))}
            </svg>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 12,
              fontSize: 12,
              paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,.08)',
              color: '#94a3b8',
            }}
          >
            <span>
              Escala vertical: <strong style={{ color: '#e2e8f0' }}>{chart.min.toFixed(1)} °C</strong> a{' '}
              <strong style={{ color: '#e2e8f0' }}>{chart.max.toFixed(1)} °C</strong>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

type OcupResumoSalvo = {
  r: OcupRow
  totalPos: number
  totalVaz: number
  totalOcup: number
  percOcup: number
  percLivre: number
}

type OcupResumoRascunho = {
  o6: number
  o7: number
  o8: number
  totalPos: number
  totalOcup: number
  totalVaz: number
  avariaAcrescimo: number
  percOcup: number
  percLivre: number
}

const TEMA_OCP = {
  resumoGradient:
    'linear-gradient(145deg, rgba(14,165,233,.2) 0%, rgba(15,23,42,.96) 42%, rgba(8,47,72,.45) 100%)',
  resumoBorder: '1px solid rgba(56,189,248,.45)',
  tituloResumo: '#7dd3fc',
  kpiOcupBorder: '1px solid rgba(56,189,248,.28)',
  kpiOcupTitulo: '#7dd3fc',
  kpiOcupValor: '#38bdf8',
  camTitulo: '#7dd3fc',
  camBorda: '1px solid rgba(56,189,248,.15)',
  barFill: 'linear-gradient(90deg, #38bdf8, #0ea5e9)',
  ocupSpan: '#38bdf8',
  emptyBorder: '1px dashed rgba(56,189,248,.35)',
  emptyStrong: '#7dd3fc',
  formTitulo: '#38bdf8',
  btnBorder: '1px solid #0ea5e9',
  btnBg: '#38bdf8',
  btnColor: '#082f49',
  tabelaLivre: '#6ee7b7',
  avariaDestaque: '#fdba74',
} as const

function OcupacaoCamaras678Secao({
  labels,
  resumoDia,
  resumoRascunho,
  rows,
  conferenteId,
  setConferenteId,
  dataYmd,
  setDataYmd,
  v6,
  setV6,
  v7,
  setV7,
  v8,
  setV8,
  vAvaria,
  setVAvaria,
  onSalvar,
  loading,
  conferentesLoading,
  conferentes,
}: {
  labels: { resumo: string; form: string; tabela: string; emptyHint: string }
  resumoDia: OcupResumoSalvo | null
  resumoRascunho: OcupResumoRascunho
  rows: OcupRow[]
  conferenteId: string
  setConferenteId: (v: string) => void
  dataYmd: string
  setDataYmd: (v: string) => void
  v6: string
  setV6: (v: string) => void
  v7: string
  setV7: (v: string) => void
  v8: string
  setV8: (v: string) => void
  vAvaria: string
  setVAvaria: (v: string) => void
  onSalvar: () => void
  loading: boolean
  conferentesLoading: boolean
  conferentes: Conferente[]
}) {
  const t = TEMA_OCP
  const [histPage, setHistPage] = useState(1)
  useEffect(() => {
    setHistPage(1)
  }, [rows])
  const rowsPagina = useMemo(
    () => rows.slice((histPage - 1) * HIST_PAGE_SIZE, histPage * HIST_PAGE_SIZE),
    [rows, histPage],
  )
  return (
    <>
      {resumoDia ? (
        <div
          style={{
            borderRadius: 16,
            padding: '20px 22px 22px',
            background: t.resumoGradient,
            border: t.resumoBorder,
            boxShadow: '0 16px 52px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.1)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: t.tituloResumo,
              marginBottom: 4,
              textAlign: 'center',
            }}
          >
            {labels.resumo}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 18 }}>
            Último registro salvo (data do lançamento · horário · conferente)
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 20,
              alignItems: 'start',
              marginBottom: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Data do lançamento
              </div>
              <div style={{ fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 800, color: '#f8fafc', lineHeight: 1.1 }}>
                {formatDataBr(resumoDia.r.data_registro)}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gap: 12,
                padding: '12px 16px',
                background: 'rgba(0,0,0,.22)',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Horário do registro</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#e0f2fe', fontVariantNumeric: 'tabular-nums' }}>
                  {formatHoraRegistro(resumoDia.r.created_at)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Conferente</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#bae6fd' }}>{resumoDia.r.conferente_nome}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
            <div
              style={{
                background: 'rgba(0,0,0,.22)',
                borderRadius: 12,
                padding: '16px 14px',
                border: t.kpiOcupBorder,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 12, color: t.kpiOcupTitulo, fontWeight: 600, marginBottom: 8 }}>Ocupadas</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: t.kpiOcupValor, lineHeight: 1 }}>{resumoDia.totalOcup}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.35 }}>
                Das {resumoDia.totalPos} posições no total (câm. 6+7+8)
              </div>
            </div>
            <div
              style={{
                background: 'rgba(0,0,0,.22)',
                borderRadius: 12,
                padding: '16px 14px',
                border: '1px solid rgba(52,211,153,.3)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 600, marginBottom: 8 }}>Livres</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#34d399', lineHeight: 1 }}>{resumoDia.totalVaz}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.35 }}>
                Soma das vagas vazias informadas nas três câmaras
              </div>
            </div>
            <div
              style={{
                background: 'rgba(0,0,0,.22)',
                borderRadius: 12,
                padding: '16px 14px',
                border: '1px solid rgba(251,191,36,.28)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 12, color: '#fcd34d', fontWeight: 600, marginBottom: 8 }}>Percentual</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#fbbf24', lineHeight: 1 }}>
                {resumoDia.percOcup.toFixed(0)}% <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>ocup.</span>
              </div>
              <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 8 }}>Livre: {resumoDia.percLivre.toFixed(0)}%</div>
            </div>
          </div>

          <div
            style={{
              marginBottom: 18,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(249,115,22,.12)',
              border: '1px solid rgba(249,115,22,.35)',
              textAlign: 'center',
              fontSize: 13,
              color: '#cbd5e1',
            }}
          >
            Avaria somada à ocupação:{' '}
            <strong style={{ color: t.avariaDestaque, fontVariantNumeric: 'tabular-nums' }}>
              {resumoDia.r.avaria_acrescimo_ocupacao}
            </strong>{' '}
            posição(ões)
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 10, letterSpacing: '0.04em' }}>
            Detalhe por câmara (último registro)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {(
              [
                { id: 6, v: resumoDia.r.camara6_vazias, cap: OCUP_TOTAL.camara6 },
                { id: 7, v: resumoDia.r.camara7_vazias, cap: OCUP_TOTAL.camara7 },
                { id: 8, v: resumoDia.r.camara8_vazias, cap: OCUP_TOTAL.camara8 },
              ] as const
            ).map((c) => {
              const oc = c.cap - c.v
              const pct = c.cap > 0 ? (oc / c.cap) * 100 : 0
              return (
                <div
                  key={c.id}
                  style={{
                    background: 'rgba(0,0,0,.2)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    border: t.camBorda,
                  }}
                >
                  <div style={{ fontWeight: 700, color: t.camTitulo, marginBottom: 2 }}>Câmara {c.id}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{c.cap} posições no total</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                    <span>
                      <span style={{ color: '#6ee7b7' }}>Vazias</span> <strong style={{ color: '#ecfdf5' }}>{c.v}</strong>
                    </span>
                    <span>
                      <span style={{ color: t.ocupSpan }}>Ocupadas</span> <strong style={{ color: '#f0f9ff' }}>{oc}</strong>
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, pct))}%`,
                        borderRadius: 999,
                        background: t.barFill,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, textAlign: 'right' }}>{pct.toFixed(0)}% ocupada nesta câmara</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            borderRadius: 14,
            padding: '18px 20px',
            background: 'rgba(15,23,42,.65)',
            border: t.emptyBorder,
            color: '#94a3b8',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          <strong style={{ color: t.emptyStrong }}>{labels.resumo}:</strong> {labels.emptyHint}
        </div>
      )}

      <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: t.formTitulo }}>{labels.form}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Conferente</span>
            <select value={conferenteId} onChange={(e) => setConferenteId(e.target.value)} disabled={conferentesLoading}>
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
            <input type="date" value={dataYmd} onChange={(e) => setDataYmd(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Câmara 6 — vazias</span>
            <input value={v6} onChange={(e) => setV6(e.target.value)} type="number" min="0" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Câmara 7 — vazias</span>
            <input value={v7} onChange={(e) => setV7(e.target.value)} type="number" min="0" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Câmara 8 — vazias</span>
            <input value={v8} onChange={(e) => setV8(e.target.value)} type="number" min="0" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ color: t.avariaDestaque }}>Avaria — acréscimo em ocupadas</span>
            <input value={vAvaria} onChange={(e) => setVAvaria(e.target.value)} type="number" min="0" placeholder="0" />
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>
              Somado ao total de posições ocupadas (registro único com as câmaras 6, 7 e 8).
            </span>
          </label>
        </div>

        <div style={{ marginTop: 12, border: '1px solid var(--border, #2e303a)', borderRadius: 10, padding: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumo automático (rascunho)</div>
          <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            <div>
              Câmara 6: {resumoRascunho.o6} ocupadas / {asInt(v6)} vazias (total {OCUP_TOTAL.camara6})
            </div>
            <div>
              Câmara 7: {resumoRascunho.o7} ocupadas / {asInt(v7)} vazias (total {OCUP_TOTAL.camara7})
            </div>
            <div>
              Câmara 8: {resumoRascunho.o8} ocupadas / {asInt(v8)} vazias (total {OCUP_TOTAL.camara8})
            </div>
            <div style={{ color: t.avariaDestaque }}>
              Avaria (acréscimo): {resumoRascunho.avariaAcrescimo} posição(ões)
            </div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              Total ocupadas (câmaras + avaria): {resumoRascunho.totalOcup} · Vagas livres (soma vazias):{' '}
              {resumoRascunho.totalVaz} | % Ocupada: {resumoRascunho.percOcup.toFixed(0)}% | % Livre:{' '}
              {resumoRascunho.percLivre.toFixed(0)}%
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void onSalvar()}
          disabled={loading}
          style={{
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 8,
            border: t.btnBorder,
            background: t.btnBg,
            color: t.btnColor,
            fontWeight: 700,
          }}
        >
          {loading ? 'Salvando...' : 'Salvar ocupação'}
        </button>
      </div>

      <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{labels.tabela}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              <th style={th}>Data</th>
              <th style={th}>Conferente</th>
              <th style={th}>Cam 6 (vazias)</th>
              <th style={th}>Cam 7 (vazias)</th>
              <th style={th}>Cam 8 (vazias)</th>
              <th style={{ ...th, color: t.avariaDestaque }}>Avaria (+ ocup.)</th>
              <th style={th}>Livre</th>
              <th style={th}>Total ocupadas</th>
              <th style={th}>% Ocupada</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...td, color: 'var(--text, #9ca3af)' }}>
                  Nenhum lançamento ainda.
                </td>
              </tr>
            ) : (
              rowsPagina.map((r) => {
                const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
                const totalVaz = r.camara6_vazias + r.camara7_vazias + r.camara8_vazias
                const av = r.avaria_acrescimo_ocupacao
                const totalOcup = totalPos - totalVaz + av
                const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
                return (
                  <tr key={r.id}>
                    <td style={td}>{formatDataBr(r.data_registro)}</td>
                    <td style={td}>{r.conferente_nome}</td>
                    <td style={td}>{r.camara6_vazias}</td>
                    <td style={td}>{r.camara7_vazias}</td>
                    <td style={td}>{r.camara8_vazias}</td>
                    <td style={{ ...td, color: t.avariaDestaque, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {av}
                    </td>
                    <td style={{ ...td, color: t.tabelaLivre, fontWeight: 600 }}>{totalVaz}</td>
                    <td style={td}>{totalOcup}</td>
                    <td style={td}>{percOcup.toFixed(0)}%</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <HistoricoPaginacaoBar
          page={histPage}
          totalItems={rows.length}
          pageSize={HIST_PAGE_SIZE}
          onPageChange={setHistPage}
          accent={t.formTitulo}
        />
      </div>
    </>
  )
}

export default function ContagemDiariaAmbiental() {
  const [tempHistPage, setTempHistPage] = useState(1)
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
  const [ocupAvariaAcrescimo, setOcupAvariaAcrescimo] = useState('')
  const [ocupRows, setOcupRows] = useState<OcupRow[]>([])

  async function loadTempRows() {
    const { data, error: qErr } = await supabase
      .from('contagem_temperatura_camaras')
      .select('id,data_registro,conferente_nome,camara11_temp,camara12_temp,camara13_temp,created_at')
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
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
      .select(
        'id,data_registro,conferente_nome,camara6_vazias,camara7_vazias,camara8_vazias,avaria_acrescimo_ocupacao,created_at',
      )
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
    if (qErr) throw qErr
    setOcupRows(
      (data || []).map((r) => ({
        ...r,
        camara6_vazias: asNum(r.camara6_vazias),
        camara7_vazias: asNum(r.camara7_vazias),
        camara8_vazias: asNum(r.camara8_vazias),
        avaria_acrescimo_ocupacao: asNum(
          (r as { avaria_acrescimo_ocupacao?: unknown }).avaria_acrescimo_ocupacao,
        ),
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
            ? `${e.message}. Confira os SQL: create_contagem_diaria_temperatura_ocupacao.sql e alter_contagem_ocupacao_camaras_add_avaria_acrescimo.sql.`
            : 'Erro ao carregar dados.',
        )
      } finally {
        setConferentesLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    setTempHistPage(1)
  }, [tempRows])

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
    const avAc = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
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
        avaria_acrescimo_ocupacao: avAc,
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
  const tempHistoricoPagina = useMemo(
    () =>
      tempHistoricoDesc.slice((tempHistPage - 1) * HIST_PAGE_SIZE, tempHistPage * HIST_PAGE_SIZE),
    [tempHistoricoDesc, tempHistPage],
  )

  const ocupResumoAtual = useMemo(() => {
    const v6 = asInt(vazias6)
    const v7 = asInt(vazias7)
    const v8 = asInt(vazias8)
    const o6 = Math.max(0, OCUP_TOTAL.camara6 - v6)
    const o7 = Math.max(0, OCUP_TOTAL.camara7 - v7)
    const o8 = Math.max(0, OCUP_TOTAL.camara8 - v8)
    const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
    const avariaAcrescimo = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
    const totalOcup = o6 + o7 + o8 + avariaAcrescimo
    const totalVaz = v6 + v7 + v8
    return {
      o6,
      o7,
      o8,
      totalPos,
      totalOcup,
      totalVaz,
      avariaAcrescimo,
      percOcup: totalPos > 0 ? (totalOcup / totalPos) * 100 : 0,
      percLivre: totalPos > 0 ? (totalVaz / totalPos) * 100 : 0,
    }
  }, [vazias6, vazias7, vazias8, ocupAvariaAcrescimo])

  /** Primeiro item = mais recente (data + horário do registro). */
  const ocupResumoDiaSalvo = useMemo(() => {
    const r = ocupRows[0]
    if (!r) return null
    const totalPos = OCUP_TOTAL.camara6 + OCUP_TOTAL.camara7 + OCUP_TOTAL.camara8
    const totalVaz = r.camara6_vazias + r.camara7_vazias + r.camara8_vazias
    const av = r.avaria_acrescimo_ocupacao
    const totalOcup = totalPos - totalVaz + av
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
                  tempHistoricoPagina.map((r) => (
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
            <HistoricoPaginacaoBar
              page={tempHistPage}
              totalItems={tempHistoricoDesc.length}
              pageSize={HIST_PAGE_SIZE}
              onPageChange={setTempHistPage}
              accent="#22c55e"
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Ocupação (câmaras 6, 7 e 8)
          </div>
          <OcupacaoCamaras678Secao
            labels={{
              resumo: 'Resumo do dia',
              form: 'Lançar ocupação (vagas vazias por câmara + avaria, se houver)',
              tabela: 'Últimos lançamentos de ocupação',
              emptyHint:
                'ainda não há lançamentos salvos. Preencha o formulário abaixo e salve para ver o resumo aqui.',
            }}
            resumoDia={ocupResumoDiaSalvo}
            resumoRascunho={ocupResumoAtual}
            rows={ocupRows}
            conferenteId={ocupConferenteId}
            setConferenteId={setOcupConferenteId}
            dataYmd={ocupData}
            setDataYmd={setOcupData}
            v6={vazias6}
            setV6={setVazias6}
            v7={vazias7}
            setV7={setVazias7}
            v8={vazias8}
            setV8={setVazias8}
            vAvaria={ocupAvariaAcrescimo}
            setVAvaria={setOcupAvariaAcrescimo}
            onSalvar={salvarOcupacao}
            loading={loading}
            conferentesLoading={conferentesLoading}
            conferentes={conferentes}
          />
        </div>
      )}
    </div>
  )
}