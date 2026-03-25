import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'

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

function formatDateTimeBR(iso: string) {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

function dateKeyFromIso(iso: string) {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function conferenteNome(r: ContagemRow) {
  if (!r.conferentes) return r.conferente_id
  if (Array.isArray(r.conferentes)) return r.conferentes[0]?.nome ?? r.conferente_id
  return r.conferentes.nome ?? r.conferente_id
}

function diaContagemLabel(r: ContagemRow) {
  const ymd = (r.data_contagem != null ? String(r.data_contagem) : '').slice(0, 10) || dateKeyFromIso(r.data_hora_contagem)
  return formatDateBR(ymd)
}

/** Paginação (15 + “Mostrar tudo”) vale para Relatório completo e Todas as contagens — mesmo componente. */
const RELATORIO_PAGE_SIZE = 15

type RelatorioContagemProps = {
  mode?: 'periodo' | 'dia'
}

export default function RelatorioContagem({ mode = 'periodo' }: RelatorioContagemProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingQuantidade, setEditingQuantidade] = useState<string>('')
  const [rowActionLoading, setRowActionLoading] = useState(false)

  const isDiaMode = mode === 'dia'

  const [startDate, setStartDate] = useState(() =>
    toISODateLocal(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  )
  const [endDate, setEndDate] = useState(() => toISODateLocal(new Date()))
  const [allTime, setAllTime] = useState(false)
  const [useSingleDay, setUseSingleDay] = useState(false)
  const [singleDay, setSingleDay] = useState(() => toISODateLocal(new Date()))
  const [rows, setRows] = useState<ContagemRow[]>([])
  const [relatorioPage, setRelatorioPage] = useState(1)
  const [relatorioShowAll, setRelatorioShowAll] = useState(false)
  const prevLoadingRef = useRef(false)

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

  async function load() {
    setLoading(true)
    setError('')
    setSuccess('')
    setRows([])

    try {
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
        foto_base64
      `
      const selectCompletoCompact = selectCompleto.replace(/\s+/g, '')

      let q = supabase
        .from('contagens_estoque')
        .select(selectCompletoCompact)
        .order('data_hora_contagem', { ascending: false })

      if (!allTime) {
        if (useSingleDay) {
          // filtro por DIA único de contagem (00:00 até 23:59)
          const startIso = `${singleDay}T00:00:00`
          const endIso = `${singleDay}T23:59:59`
          q = q.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
        } else {
          // filtro por INTERVALO (00:00 até 23:59)
          const startIso = `${startDate}T00:00:00`
          const endIso = `${endDate}T23:59:59`
          q = q.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
        }
      }

      const applyDatesFilters = (query: typeof q) => {
        if (allTime) return query
        if (useSingleDay) {
          const startIso = `${singleDay}T00:00:00`
          const endIso = `${singleDay}T23:59:59`
          return query.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
        }
        const startIso = `${startDate}T00:00:00`
        const endIso = `${endDate}T23:59:59`
        return query.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
      }

      const qFiltroCompleto = applyDatesFilters(q)
      const { data, error: qError } = await qFiltroCompleto.limit(20000)
      if (qError) throw qError

      setRows((data ?? []) as unknown as ContagemRow[])
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : ''
      // Se a tabela não tiver algumas colunas extras (ex.: data_fabricacao), faz fallback sem elas.
      if (String(e?.code ?? '') === '42703' || msg.toLowerCase().includes('does not exist')) {
        try {
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

          let q2 = supabase
            .from('contagens_estoque')
            .select(selectBasicoCompact)
            .order('data_hora_contagem', { ascending: false })

          if (!allTime) {
            if (useSingleDay) {
              const startIso = `${singleDay}T00:00:00`
              const endIso = `${singleDay}T23:59:59`
              q2 = q2.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
            } else {
              const startIso = `${startDate}T00:00:00`
              const endIso = `${endDate}T23:59:59`
              q2 = q2.gte('data_hora_contagem', startIso).lte('data_hora_contagem', endIso)
            }
          }

          const { data, error: qError2 } = await q2.limit(20000)
          if (qError2) throw qError2

          const mapped = (data ?? []).map((r: any) => ({
            ...r,
            data_fabricacao: null,
            data_validade: null,
            ean: null,
            dun: null,
            up_adicional: null,
            foto_base64: null,
          }))

          setRows(mapped as unknown as ContagemRow[])
          setError('')
          return
        } catch (e2: any) {
          setError(e2?.message ? String(e2.message) : 'Erro ao carregar relatório (fallback).')
          return
        }
      }

      setError(e?.message ? String(e.message) : 'Erro ao carregar relatório.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteRow(id: string) {
    if (!confirm('Deseja realmente excluir esta contagem?')) return
    setRowActionLoading(true)
    setError('')
    setSuccess('')

    const { error: delError } = await supabase.from('contagens_estoque').delete().eq('id', id)
    if (delError) {
      setError(`Erro ao excluir: ${delError.message}`)
    } else {
      setRows((prev) => prev.filter((r) => r.id !== id))
      setSuccess('Contagem excluída com sucesso.')
    }
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

    const { error: updError } = await supabase
      .from('contagens_estoque')
      .update({ quantidade_up: qtd })
      .eq('id', id)

    if (updError) {
      setError(`Erro ao atualizar quantidade: ${updError.message}`)
    } else {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, quantidade_up: qtd } : r)))
      setEditingId(null)
      setEditingQuantidade('')
      setSuccess('Quantidade atualizada com sucesso.')
    }
    setRowActionLoading(false)
  }

  function exportToExcel() {
    if (!rows.length) return

    const sheetRows = rows.map((r) => ({
      Conferente: conferenteNome(r),
      'Dia da contagem': diaContagemLabel(r),
      'Data e hora do registro': formatDateTimeBR(r.data_hora_contagem),
      'Código do produto': r.codigo_interno,
      Descrição: r.descricao,
      'Unidade de medida': r.unidade_medida ?? '',
      'Quantidade contada': r.quantidade_up,
      UP: r.up_adicional ?? '',
      'Data de fabricação': r.data_fabricacao ? formatDateBR(String(r.data_fabricacao).slice(0, 10)) : '',
      'Data de vencimento': r.data_validade ? formatDateBR(String(r.data_validade).slice(0, 10)) : '',
      Lote: r.lote ?? '',
      Observação: r.observacao ?? '',
      EAN: r.ean ?? '',
      DUN: r.dun ?? '',
      Foto: r.foto_base64 ? 'Sim' : 'Não',
    }))

    const ws = XLSX.utils.json_to_sheet(sheetRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contagens')
    const safeFile = dateRangeText.replace(/[/\\?*[\]:]/g, '-').replace(/\s+/g, '_')
    XLSX.writeFile(wb, `relatorio-contagem_${safeFile}.xlsx`)
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

          <button
            type="button"
            onClick={exportToExcel}
            disabled={loading || rows.length === 0}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #1b5e20',
              background: '#2e7d32',
              color: 'white',
              cursor: loading || rows.length === 0 ? 'not-allowed' : 'pointer',
              height: 40,
              opacity: loading || rows.length === 0 ? 0.5 : 1,
            }}
            title={rows.length === 0 ? 'Carregue o relatório antes de exportar' : 'Baixar planilha .xlsx'}
          >
            Exportar Excel
          </button>
        </div>

        {error ? <div style={{ color: '#b00020' }}>{error}</div> : null}
        {success ? <div style={{ color: '#0f7a0f' }}>{success}</div> : null}

        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            {relatorioPagination}
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1980 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Conferente</th>
                  <th style={thStyle}>Dia da contagem</th>
                  <th style={thStyle}>Data e hora do registro</th>
                  <th style={thStyle}>Código do produto</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle}>Unidade de medida</th>
                  <th style={thStyle}>Quantidade contada</th>
                  <th style={thStyle}>UP</th>
                  <th style={thStyle}>Data de fabricação</th>
                  <th style={thStyle}>Data de vencimento</th>
                  <th style={thStyle}>Lote</th>
                  <th style={thStyle}>Observação</th>
                  <th style={thStyle}>EAN</th>
                  <th style={thStyle}>DUN</th>
                  <th style={thStyle}>Foto</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{conferenteNome(r)}</td>
                    <td style={tdStyle}>{diaContagemLabel(r)}</td>
                    <td style={tdStyle}>{formatDateTimeBR(r.data_hora_contagem)}</td>
                    <td style={tdStyle}>{r.codigo_interno}</td>
                    <td style={tdStyle}>{r.descricao}</td>
                    <td style={tdStyle}>{r.unidade_medida ?? ''}</td>
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
                    <td style={tdStyle}>{r.up_adicional ?? ''}</td>
                    <td style={tdStyle}>
                      {r.data_fabricacao ? formatDateBR(String(r.data_fabricacao).slice(0, 10)) : ''}
                    </td>
                    <td style={tdStyle}>
                      {r.data_validade ? formatDateBR(String(r.data_validade).slice(0, 10)) : ''}
                    </td>
                    <td style={tdStyle}>{r.lote ?? ''}</td>
                    <td style={tdStyle}>{r.observacao ?? ''}</td>
                    <td style={tdStyle}>{r.ean ?? ''}</td>
                    <td style={tdStyle}>{r.dun ?? ''}</td>
                    <td style={tdStyle}>
                      {r.foto_base64 ? (
                        <img
                          src={`data:image/jpeg;base64,${r.foto_base64}`}
                          alt=""
                          style={{ maxWidth: 60, maxHeight: 45, objectFit: 'cover', borderRadius: 8 }}
                        />
                      ) : (
                        <span style={{ color: '#888', fontSize: 12 }}>Sem foto</span>
                      )}
                    </td>
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
                  </tr>
                ))}
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

