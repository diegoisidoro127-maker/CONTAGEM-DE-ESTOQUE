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
  camara11_vazias: number
  camara12_vazias: number
  camara13_vazias: number
  /** Somado ao total de ocupadas (além do cálculo pelas vazias). */
  avaria_acrescimo_ocupacao: number
  created_at: string
}

const OCUP_TOTAL = {
  camara11: 68,
  camara12: 136,
  camara13: 140,
} as const

const OCUP_TOTAL_POSICOES = OCUP_TOTAL.camara11 + OCUP_TOTAL.camara12 + OCUP_TOTAL.camara13

function ocupPercGeral(r: OcupRow): number {
  const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
  const totalOcup = OCUP_TOTAL_POSICOES - totalVaz + r.avaria_acrescimo_ocupacao
  return OCUP_TOTAL_POSICOES > 0 ? (totalOcup / OCUP_TOTAL_POSICOES) * 100 : 0
}

function ocupPercCam11(r: OcupRow): number {
  const c = OCUP_TOTAL.camara11
  return c > 0 ? ((c - r.camara11_vazias) / c) * 100 : 0
}

function ocupPercCam12(r: OcupRow): number {
  const c = OCUP_TOTAL.camara12
  return c > 0 ? ((c - r.camara12_vazias) / c) * 100 : 0
}

function ocupPercCam13(r: OcupRow): number {
  const c = OCUP_TOTAL.camara13
  return c > 0 ? ((c - r.camara13_vazias) / c) * 100 : 0
}

function ocupAvariaPercTotal(r: OcupRow): number {
  return OCUP_TOTAL_POSICOES > 0 ? (r.avaria_acrescimo_ocupacao / OCUP_TOTAL_POSICOES) * 100 : 0
}

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

/** Metadados opcionais para tooltip (linhas de temperatura/ocupação no Supabase). */
function rowMetaForTooltip(r: { data_registro: string }): { conferente?: string; hora?: string } {
  const o = r as Record<string, unknown>
  const nome = o.conferente_nome
  const created = o.created_at
  return {
    conferente: typeof nome === 'string' && nome.trim() ? nome : undefined,
    hora: typeof created === 'string' && created.trim() ? formatHoraRegistro(created) : undefined,
  }
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

function TinyLineChart<T extends { data_registro: string }>({
  title,
  color,
  rows,
  valueOf,
  valueSuffix = '°C',
  decimals = 1,
  axisCaption,
  denseTimeline,
  showSeriesInsight,
}: {
  title: string
  color: string
  rows: T[]
  valueOf: (r: T) => number
  /** Sufixo nos eixos e no rodapé (ex.: °C, %, pos.). */
  valueSuffix?: string
  decimals?: number
  /** Texto curto no canto do gráfico; default = valueSuffix. */
  axisCaption?: string
  /** Mais marcas no eixo X (do primeiro ao último lançamento). */
  denseTimeline?: boolean
  /** Último ponto destacado + bloco início / fim / variação. */
  showSeriesInsight?: boolean
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
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)

  const capAxis = axisCaption ?? valueSuffix
  const fmt = (v: number) => v.toFixed(decimals)

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
    let xIdx: number[]
    if (denseTimeline) {
      if (n <= 1) xIdx = [0]
      else if (n <= 7) xIdx = Array.from({ length: n }, (_, i) => i)
      else {
        xIdx = [0]
        for (let k = 1; k <= 5; k++) xIdx.push(Math.round(((n - 1) * k) / 6))
        xIdx.push(n - 1)
        xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
      }
    } else {
      xIdx = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
    }
    const xLabels = [...new Set(xIdx)]
      .sort((a, b) => a - b)
      .map((i) => ({ x: xAt(i), text: formatAxisDateChart(rows[i].data_registro) }))
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const firstVal = values[0]
    const lastVal = values[values.length - 1]
    const lastPt = pts[pts.length - 1]
    return {
      lineD,
      areaD,
      yTicks,
      xLabels,
      min,
      max,
      avg,
      firstVal,
      lastVal,
      lastPt,
      delta: lastVal - firstVal,
      xAt,
      yAt,
    }
  }, [rows, valueOf, innerW, innerH, padL, padT, bottomY, denseTimeline])

  const onSvgMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!rows.length || !geom) return
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
    [rows.length, geom, width, padL, padR, innerW],
  )

  const onSvgLeave = useCallback(() => setTip(null), [])

  return (
    <div style={chartCardStyle}>
      <div style={{ fontWeight: 700, marginBottom: 10, color, fontSize: 15, letterSpacing: '0.02em' }}>{title}</div>
      {!rows.length || !geom ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <div style={{ position: 'relative' }}>
            {tip != null && rows[tip.idx] ? (
              <div
                style={{
                  position: 'absolute',
                  left: `${tip.pxPct}%`,
                  top: 4,
                  transform: 'translateX(-50%)',
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 200,
                  maxWidth: 280,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(15,23,42,.96)',
                  border: `1px solid ${color}55`,
                  boxShadow: '0 12px 36px rgba(0,0,0,.5)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: '#e0f2fe', marginBottom: 6 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                {(() => {
                  const m = rowMetaForTooltip(rows[tip.idx])
                  return m.conferente || m.hora ? (
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>
                      {m.conferente ? <span style={{ color: '#94a3b8' }}>{m.conferente}</span> : null}
                      {m.conferente && m.hora ? <span style={{ color: '#475569' }}> · </span> : null}
                      {m.hora ? <span>{m.hora}</span> : null}
                    </div>
                  ) : null
                })()}
                <div style={{ color }}>
                  Valor:{' '}
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(valueOf(rows[tip.idx]))}
                    {valueSuffix}
                  </strong>
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
            {tip != null ? (
              <line
                x1={geom.xAt(tip.idx)}
                y1={padT}
                x2={geom.xAt(tip.idx)}
                y2={bottomY}
                stroke="rgba(148,163,184,.35)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ) : null}
            <path
              d={geom.lineD}
              stroke={color}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 8px ${color}66)` }}
            />
            {tip != null ? (
              <circle
                cx={geom.xAt(tip.idx)}
                cy={geom.yAt(valueOf(rows[tip.idx]))}
                r={6}
                fill={color}
                stroke="rgba(15,23,42,.92)"
                strokeWidth={2}
              />
            ) : showSeriesInsight && geom.lastPt ? (
              <circle
                cx={geom.lastPt.x}
                cy={geom.lastPt.y}
                r={5}
                fill={color}
                stroke="rgba(15,23,42,.9)"
                strokeWidth={2}
              />
            ) : null}
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
                {fmt(t.v)}
                {valueSuffix}
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
              {capAxis}
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
          </div>
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
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(geom.min)}
                {valueSuffix}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 220, gap: 12 }}>
              <span>Máx.</span>
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(geom.max)}
                {valueSuffix}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 220, gap: 12 }}>
              <span>Média</span>
              <strong style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(geom.avg)}
                {valueSuffix}
              </strong>
            </div>
            {showSeriesInsight && rows.length >= 2 ? (
              <div
                style={{
                  width: '100%',
                  maxWidth: 360,
                  marginTop: 4,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,.22)',
                  border: '1px solid rgba(255,255,255,.06)',
                  display: 'grid',
                  gap: 8,
                  fontSize: 11,
                  color: '#94a3b8',
                }}
              >
                <div style={{ fontWeight: 700, color: '#cbd5e1', fontSize: 11 }}>Tendência no período exibido</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    Início ({formatAxisDateChart(rows[0].data_registro)})
                  </span>
                  <strong style={{ color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(geom.firstVal)}
                    {valueSuffix}
                  </strong>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                  <span>Fim ({formatAxisDateChart(rows[rows.length - 1].data_registro)})</span>
                  <strong style={{ color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(geom.lastVal)}
                    {valueSuffix}
                  </strong>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                  <span>Variação (fim − início)</span>
                  <strong
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: geom.delta > 0.0001 ? '#6ee7b7' : geom.delta < -0.0001 ? '#fca5a5' : '#e2e8f0',
                    }}
                  >
                    {geom.delta > 0 ? '+' : ''}
                    {fmt(geom.delta)}
                    {valueSuffix}
                  </strong>
                </div>
              </div>
            ) : null}
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

const COMBINED_OCP_SERIES = [
  { color: '#f0f9ff', valueOf: ocupPercGeral, label: 'Geral (11+12+13 + avaria)', strokeWidth: 3.35 },
  { color: '#22c55e', valueOf: ocupPercCam11, label: 'Câmara 11', strokeWidth: 2.7 },
  { color: '#38bdf8', valueOf: ocupPercCam12, label: 'Câmara 12', strokeWidth: 2.7 },
  { color: '#f59e0b', valueOf: ocupPercCam13, label: 'Câmara 13', strokeWidth: 2.7 },
] as const

function CombinedOcupacaoChart({ rows }: { rows: OcupRow[] }) {
  const uid = useId().replace(/:/g, '')
  const width = 1100
  const height = 292
  const padL = 54
  const padR = 18
  const padT = 20
  const padB = 50
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)

  const chart = useMemo(() => {
    if (!rows.length) return null
    const allVals = rows.flatMap((r) => COMBINED_OCP_SERIES.map((s) => s.valueOf(r)))
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const pad = (max - min) * 0.06 || 1
    const safeMin = min === max ? min - pad : min - pad * 0.35
    const safeMax = min === max ? max + pad : max + pad * 0.35
    const rng = safeMax - safeMin
    const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
    const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
    const seriesPaths = COMBINED_OCP_SERIES.map((s, si) => {
      const pts = rows.map((r, i) => {
        const v = s.valueOf(r)
        return { x: xAt(i), y: yAt(v) }
      })
      return {
        lineD: smoothLinePath(pts),
        color: s.color,
        label: s.label,
        strokeWidth: s.strokeWidth,
        gradId: `ocp-grad-${uid}-${si}`,
      }
    })
    const yTicks = linearYTicks(safeMin, safeMax, yAt, 6)
    const n = rows.length
    const xIdx =
      n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
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
    <div style={{ ...chartCardStyle, padding: 16 }}>
      <div
        style={{
          fontWeight: 800,
          marginBottom: 6,
          fontSize: 18,
          letterSpacing: '0.02em',
          background: 'linear-gradient(90deg, #bae6fd, #38bdf8, #7dd3fc)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Comparativo — ocupação %
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.45 }}>
        Linha <strong style={{ color: '#e2e8f0' }}>geral</strong> inclui avaria no total ocupado. As outras três curvas são só as câmaras 11, 12 e 13 (percentual sobre a capacidade de cada uma).
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
              background: 'rgba(0,0,0,.22)',
              borderRadius: 12,
              border: '1px solid rgba(56,189,248,.12)',
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
                  border: `1px solid ${p.color === '#f0f9ff' ? 'rgba(240,249,255,.45)' : `${p.color}55`}`,
                  background: `${p.color === '#f0f9ff' ? 'rgba(240,249,255,.12)' : `${p.color}14`}`,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: p.color,
                    boxShadow: `0 0 10px ${p.color === '#f0f9ff' ? 'rgba(240,249,255,.5)' : p.color}`,
                  }}
                />
                {p.label}
              </span>
            ))}
            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
              Passe o mouse para ver valores, conferente e avaria na data
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
                  minWidth: 240,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(15,23,42,.96)',
                  border: '1px solid rgba(56,189,248,.4)',
                  boxShadow: '0 12px 40px rgba(0,0,0,.5)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: '#e0f2fe', marginBottom: 4 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
                  {rows[tip.idx].conferente_nome}
                  <span style={{ color: '#475569' }}> · </span>
                  {formatHoraRegistro(rows[tip.idx].created_at)}
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  <div style={{ color: '#f0f9ff' }}>
                    Geral: <strong>{ocupPercGeral(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#22c55e' }}>
                    Câm. 11: <strong>{ocupPercCam11(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#38bdf8' }}>
                    Câm. 12: <strong>{ocupPercCam12(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#f59e0b' }}>
                    Câm. 13: <strong>{ocupPercCam13(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      paddingTop: 8,
                      borderTop: '1px solid rgba(255,255,255,.08)',
                      color: '#fdba74',
                    }}
                  >
                    Avaria: <strong>{rows[tip.idx].avaria_acrescimo_ocupacao}</strong> pos. (
                    {ocupAvariaPercTotal(rows[tip.idx]).toFixed(1)}% do armazém)
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
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.16} />
                    <stop offset="55%" stopColor={p.color} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <rect x={0} y={0} width={width} height={height} rx={10} fill="rgba(0,0,0,.2)" />
              {chart.xLabels.map((xl, i) => (
                <line
                  key={`oxg-${i}`}
                  x1={xl.x}
                  y1={padT}
                  x2={xl.x}
                  y2={bottomY}
                  stroke="rgba(148,163,184,.08)"
                  strokeWidth={1}
                />
              ))}
              {chart.yTicks.map((t, i) => (
                <line
                  key={`oy-${i}`}
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
                  stroke="rgba(56,189,248,.4)"
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
                return <path key={p.label} d={areaD} fill={`url(#${p.gradId})`} opacity={0.5} />
              })}
              {chart.seriesPaths.map((p) => (
                <path
                  key={`oline-${p.label}`}
                  d={p.lineD}
                  stroke={p.color}
                  strokeWidth={p.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 6px ${p.color === '#f0f9ff' ? 'rgba(240,249,255,.45)' : `${p.color}55`})` }}
                />
              ))}
              {tip != null
                ? COMBINED_OCP_SERIES.map((s) => {
                    const v = s.valueOf(rows[tip.idx])
                    const cx = chart.xAt(tip.idx)
                    const cy = chart.yAt(v)
                    return (
                      <circle
                        key={`od-${s.label}`}
                        cx={cx}
                        cy={cy}
                        r={s.strokeWidth > 3 ? 5.5 : 5}
                        fill={s.color}
                        stroke="rgba(15,23,42,.92)"
                        strokeWidth={2}
                      />
                    )
                  })
                : null}
              {chart.yTicks.map((t, i) => (
                <text
                  key={`oyl-${i}`}
                  x={padL - 10}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="#cbd5e1"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {t.v.toFixed(1)}%
                </text>
              ))}
              <text x={padL} y={padT - 2} fill="#64748b" fontSize={10} fontFamily="system-ui, sans-serif">
                % ocupada
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
                  key={`oxl-${i}`}
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
              Faixa no gráfico: <strong style={{ color: '#e2e8f0' }}>{chart.min.toFixed(1)} %</strong> a{' '}
              <strong style={{ color: '#e2e8f0' }}>{chart.max.toFixed(1)} %</strong>
            </span>
            <span style={{ color: '#64748b' }}>
              {rows.length} lançamento(s) no histórico carregado
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
  o11: number
  o12: number
  o13: number
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

function OcupacaoCamaras111213Secao({
  labels,
  resumoDia,
  resumoRascunho,
  rows,
  conferenteId,
  setConferenteId,
  dataYmd,
  setDataYmd,
  v11,
  setV11,
  v12,
  setV12,
  v13,
  setV13,
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
  v11: string
  setV11: (v: string) => void
  v12: string
  setV12: (v: string) => void
  v13: string
  setV13: (v: string) => void
  vAvaria: string
  setVAvaria: (v: string) => void
  onSalvar: () => void
  loading: boolean
  conferentesLoading: boolean
  conferentes: Conferente[]
}) {
  const t = TEMA_OCP
  const inOcupNum: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 10px',
    borderRadius: 6,
    minHeight: 30,
    fontSize: 14,
    lineHeight: 1.25,
  }
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
            borderRadius: 12,
            padding: '8px 12px 10px',
            background: t.resumoGradient,
            border: t.resumoBorder,
            boxShadow: '0 8px 28px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06)',
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: t.tituloResumo,
              marginBottom: 1,
              textAlign: 'center',
            }}
          >
            {labels.resumo}
          </div>
          <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginBottom: 6, lineHeight: 1.3 }}>
            Último registro salvo (data · horário · conferente)
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 8,
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div style={{ paddingRight: 2 }}>
              <div
                style={{
                  fontSize: 9,
                  color: '#64748b',
                  marginBottom: 2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Data do lançamento
              </div>
              <div style={{ fontSize: 'clamp(17px, 3.2vw, 22px)', fontWeight: 800, color: '#f8fafc', lineHeight: 1.05 }}>
                {formatDataBr(resumoDia.r.data_registro)}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 6,
                padding: '6px 8px',
                background: 'rgba(0,0,0,.22)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>Horário do registro</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e0f2fe', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                  {formatHoraRegistro(resumoDia.r.created_at)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>Conferente</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#bae6fd', lineHeight: 1.15 }}>{resumoDia.r.conferente_nome}</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                background: 'rgba(0,0,0,.28)',
                borderRadius: 10,
                padding: '8px 12px',
                border: t.kpiOcupBorder,
                boxShadow: '0 2px 14px rgba(0,0,0,.2)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 10, color: t.kpiOcupTitulo, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Ocupação
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(56,189,248,.2)',
                  borderBottom: '1px solid rgba(56,189,248,.2)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Posições ocupadas</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalOcup}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>% Ocupada</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: t.kpiOcupValor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.percOcup.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.35, marginTop: 6 }}>
                Base: <strong style={{ color: '#94a3b8' }}>{resumoDia.totalPos}</strong> posições totais (câm. 11+12+13). O total ocupado inclui o acréscimo de avaria.
              </div>
            </div>

            <div
              style={{
                background: 'rgba(0,0,0,.28)',
                borderRadius: 10,
                padding: '8px 12px',
                border: '1px solid rgba(52,211,153,.4)',
                boxShadow: '0 2px 14px rgba(0,0,0,.2)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 10, color: '#6ee7b7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Livres
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(52,211,153,.25)',
                  borderBottom: '1px solid rgba(52,211,153,.25)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Posições livres</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#ecfdf5', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalVaz}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>% Livre</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#34d399', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.percLivre.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.35, marginTop: 6 }}>
                Soma das vagas vazias informadas nas três câmaras; percentual sobre o total do armazém ({resumoDia.totalPos} pos.).
              </div>
            </div>

            <div
              style={{
                background: 'rgba(0,0,0,.28)',
                borderRadius: 10,
                padding: '8px 12px',
                border: '1px solid rgba(249,115,22,.45)',
                boxShadow: '0 2px 14px rgba(0,0,0,.2)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 10, color: t.avariaDestaque, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Avaria (acréscimo na ocupação)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(249,115,22,.28)',
                  borderBottom: '1px solid rgba(249,115,22,.28)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quantidade</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.avariaDestaque, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.r.avaria_acrescimo_ocupacao}
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fdba74', marginLeft: 4 }}>pos.</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>% sobre o armazém</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fb923c', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalPos > 0
                      ? ((resumoDia.r.avaria_acrescimo_ocupacao / resumoDia.totalPos) * 100).toFixed(1)
                      : '0.0'}
                    %
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.35, marginTop: 6 }}>
                Valor somado ao total de ocupadas no mesmo lançamento. Percentual calculado sobre as {resumoDia.totalPos} posições totais.
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, letterSpacing: '0.03em' }}>
            Detalhe por câmara (último registro)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {(
              [
                { id: 11, v: resumoDia.r.camara11_vazias, cap: OCUP_TOTAL.camara11 },
                { id: 12, v: resumoDia.r.camara12_vazias, cap: OCUP_TOTAL.camara12 },
                { id: 13, v: resumoDia.r.camara13_vazias, cap: OCUP_TOTAL.camara13 },
              ] as const
            ).map((c) => {
              const oc = c.cap - c.v
              const pct = c.cap > 0 ? (oc / c.cap) * 100 : 0
              return (
                <div
                  key={c.id}
                  style={{
                    background: 'rgba(0,0,0,.2)',
                    borderRadius: 10,
                    padding: '8px 10px',
                    border: t.camBorda,
                  }}
                >
                  <div style={{ fontWeight: 700, color: t.camTitulo, marginBottom: 1, fontSize: 12 }}>Câmara {c.id}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{c.cap} posições no total</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span>
                      <span style={{ color: '#6ee7b7' }}>Vazias</span> <strong style={{ color: '#ecfdf5' }}>{c.v}</strong>
                    </span>
                    <span>
                      <span style={{ color: t.ocupSpan }}>Ocupadas</span> <strong style={{ color: '#f0f9ff' }}>{oc}</strong>
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, pct))}%`,
                        borderRadius: 999,
                        background: t.barFill,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 9, color: '#64748b', marginTop: 4, textAlign: 'right' }}>{pct.toFixed(0)}% ocupada nesta câmara</div>
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
        </div>
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#94a3b8',
              marginBottom: 6,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Vagas vazias e avaria
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '8px 10px',
              width: '100%',
              alignItems: 'end',
            }}
          >
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: '#cbd5e1' }}>Câm. 11 — vazias</span>
              <input value={v11} onChange={(e) => setV11(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: '#cbd5e1' }}>Câm. 12 — vazias</span>
              <input value={v12} onChange={(e) => setV12(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: '#cbd5e1' }}>Câm. 13 — vazias</span>
              <input value={v13} onChange={(e) => setV13(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: t.avariaDestaque }}>Avaria — acréscimo</span>
              <input
                value={vAvaria}
                onChange={(e) => setVAvaria(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                style={inOcupNum}
              />
            </label>
          </div>
          <p
            style={{
              fontSize: 10,
              color: '#64748b',
              margin: '8px 0 0',
              lineHeight: 1.4,
            }}
          >
            O valor de <strong style={{ color: t.avariaDestaque }}>Avaria</strong> soma-se ao total de ocupadas no mesmo
            lançamento (câmaras 11, 12 e 13).
          </p>
        </div>

        <div style={{ marginTop: 12, border: '1px solid var(--border, #2e303a)', borderRadius: 10, padding: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumo automático (rascunho)</div>
          <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            <div>
              Câmara 11: {resumoRascunho.o11} ocupadas / {asInt(v11)} vazias (total {OCUP_TOTAL.camara11})
            </div>
            <div>
              Câmara 12: {resumoRascunho.o12} ocupadas / {asInt(v12)} vazias (total {OCUP_TOTAL.camara12})
            </div>
            <div>
              Câmara 13: {resumoRascunho.o13} ocupadas / {asInt(v13)} vazias (total {OCUP_TOTAL.camara13})
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
              <th style={th}>Cam 11 (vazias)</th>
              <th style={th}>Cam 12 (vazias)</th>
              <th style={th}>Cam 13 (vazias)</th>
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
                const totalPos = OCUP_TOTAL.camara11 + OCUP_TOTAL.camara12 + OCUP_TOTAL.camara13
                const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
                const av = r.avaria_acrescimo_ocupacao
                const totalOcup = totalPos - totalVaz + av
                const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
                return (
                  <tr key={r.id}>
                    <td style={td}>{formatDataBr(r.data_registro)}</td>
                    <td style={td}>{r.conferente_nome}</td>
                    <td style={td}>{r.camara11_vazias}</td>
                    <td style={td}>{r.camara12_vazias}</td>
                    <td style={td}>{r.camara13_vazias}</td>
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
  const [vazias11, setVazias11] = useState('')
  const [vazias12, setVazias12] = useState('')
  const [vazias13, setVazias13] = useState('')
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
        'id,data_registro,conferente_nome,camara11_vazias,camara12_vazias,camara13_vazias,avaria_acrescimo_ocupacao,created_at',
      )
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
    if (qErr) throw qErr
    setOcupRows(
      (data || []).map((r) => ({
        ...r,
        camara11_vazias: asNum((r as { camara11_vazias?: unknown }).camara11_vazias),
        camara12_vazias: asNum((r as { camara12_vazias?: unknown }).camara12_vazias),
        camara13_vazias: asNum((r as { camara13_vazias?: unknown }).camara13_vazias),
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
            ? `${e.message}. Confira: create_contagem_diaria_temperatura_ocupacao.sql, alter_contagem_ocupacao_camaras_rename_vazias_678_para_111213.sql e alter_contagem_ocupacao_camaras_add_avaria_acrescimo.sql.`
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
    if (vazias11.trim() === '' || vazias12.trim() === '' || vazias13.trim() === '') {
      setError('Preencha as posições vazias das câmaras 11, 12 e 13.')
      return
    }
    const n11 = asInt(vazias11)
    const n12 = asInt(vazias12)
    const n13 = asInt(vazias13)
    const avAc = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
    if (n11 > OCUP_TOTAL.camara11 || n12 > OCUP_TOTAL.camara12 || n13 > OCUP_TOTAL.camara13) {
      setError('Uma ou mais câmaras têm vagas maiores que o total de posições.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        data_registro: ocupData,
        conferente_nome: nomeConfOcup,
        camara11_vazias: n11,
        camara12_vazias: n12,
        camara13_vazias: n13,
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
    const v11 = asInt(vazias11)
    const v12 = asInt(vazias12)
    const v13 = asInt(vazias13)
    const o11 = Math.max(0, OCUP_TOTAL.camara11 - v11)
    const o12 = Math.max(0, OCUP_TOTAL.camara12 - v12)
    const o13 = Math.max(0, OCUP_TOTAL.camara13 - v13)
    const totalPos = OCUP_TOTAL.camara11 + OCUP_TOTAL.camara12 + OCUP_TOTAL.camara13
    const avariaAcrescimo = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
    const totalOcup = o11 + o12 + o13 + avariaAcrescimo
    const totalVaz = v11 + v12 + v13
    return {
      o11,
      o12,
      o13,
      totalPos,
      totalOcup,
      totalVaz,
      avariaAcrescimo,
      percOcup: totalPos > 0 ? (totalOcup / totalPos) * 100 : 0,
      percLivre: totalPos > 0 ? (totalVaz / totalPos) * 100 : 0,
    }
  }, [vazias11, vazias12, vazias13, ocupAvariaAcrescimo])

  /** Primeiro item = mais recente (data + horário do registro). */
  const ocupResumoDiaSalvo = useMemo(() => {
    const r = ocupRows[0]
    if (!r) return null
    const totalPos = OCUP_TOTAL.camara11 + OCUP_TOTAL.camara12 + OCUP_TOTAL.camara13
    const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
    const av = r.avaria_acrescimo_ocupacao
    const totalOcup = totalPos - totalVaz + av
    const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
    const percLivre = totalPos > 0 ? (totalVaz / totalPos) * 100 : 0
    return { r, totalPos, totalVaz, totalOcup, percOcup, percLivre }
  }, [ocupRows])

  /** Ordem cronológica para eixo X dos gráficos (mais antigo → mais recente). */
  const ocupRowsChrono = useMemo(() => [...ocupRows].reverse(), [ocupRows])

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
            Ocupação (câmaras 11, 12 e 13)
          </div>

          <OcupacaoCamaras111213Secao
            labels={{
              resumo: 'Resumo do dia',
              form: 'Lançar ocupação (vagas vazias nas câmaras 11, 12 e 13 + avaria, se houver)',
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
            v11={vazias11}
            setV11={setVazias11}
            v12={vazias12}
            setV12={setVazias12}
            v13={vazias13}
            setV13={setVazias13}
            vAvaria={ocupAvariaAcrescimo}
            setVAvaria={setOcupAvariaAcrescimo}
            onSalvar={salvarOcupacao}
            loading={loading}
            conferentesLoading={conferentesLoading}
            conferentes={conferentes}
          />

          <div
            style={{
              borderRadius: 16,
              padding: '18px 18px 22px',
              background:
                'linear-gradient(152deg, rgba(8,47,72,.42) 0%, rgba(15,23,42,.94) 40%, rgba(17,24,39,.98) 100%)',
              border: '1px solid rgba(56,189,248,.32)',
              boxShadow: '0 18px 56px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.07)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#7dd3fc',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Histórico visual
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', marginBottom: 8, letterSpacing: '-0.02em' }}>
              Evolução da ocupação nos lançamentos
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55, margin: '0 0 18px', maxWidth: 920 }}>
              O gráfico agrupado mostra a curva <strong style={{ color: '#e2e8f0' }}>geral</strong> (com avaria) e as
              três câmaras lado a lado — passe o mouse para ver conferente, horário e avaria naquele ponto. Abaixo, cada
              série em detalhe, com eixo temporal mais denso e a variação entre o primeiro e o último registro exibido.
            </p>

            <CombinedOcupacaoChart rows={ocupRowsChrono} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
                gap: 14,
                marginTop: 18,
              }}
            >
              <div style={{ gridColumn: '1 / -1' }}>
                <TinyLineChart
                  title="% Ocupada geral (11+12+13, inclui avaria)"
                  color="#38bdf8"
                  rows={ocupRowsChrono}
                  valueOf={ocupPercGeral}
                  valueSuffix="%"
                  decimals={1}
                  axisCaption="%"
                  denseTimeline
                  showSeriesInsight
                />
              </div>
              <TinyLineChart
                title="% Ocupada — Câmara 11"
                color="#22c55e"
                rows={ocupRowsChrono}
                valueOf={ocupPercCam11}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showSeriesInsight
              />
              <TinyLineChart
                title="% Ocupada — Câmara 12"
                color="#38bdf8"
                rows={ocupRowsChrono}
                valueOf={ocupPercCam12}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showSeriesInsight
              />
              <TinyLineChart
                title="% Ocupada — Câmara 13"
                color="#f59e0b"
                rows={ocupRowsChrono}
                valueOf={ocupPercCam13}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showSeriesInsight
              />
              <TinyLineChart
                title="Avaria — quantidade (posições)"
                color="#fb923c"
                rows={ocupRowsChrono}
                valueOf={(r) => r.avaria_acrescimo_ocupacao}
                valueSuffix=" pos."
                decimals={0}
                axisCaption="pos."
                denseTimeline
                showSeriesInsight
              />
              <TinyLineChart
                title="Avaria — % do total de posições"
                color="#fdba74"
                rows={ocupRowsChrono}
                valueOf={ocupAvariaPercTotal}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showSeriesInsight
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}