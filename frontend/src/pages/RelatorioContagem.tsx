import { useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '../lib/supabaseClient'

type ContagemRow = {
  id: string
  data_contagem?: string
  data_hora_contagem: string
  conferente_id: string
  conferentes?: { nome: string } | Array<{ nome: string }> | null

  codigo_interno: string
  descricao: string
  unidade_medida: string | null

  quantidade_up: number
  lote: string | null
  observacao: string | null

  produto_id: string | null
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
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

export default function RelatorioContagem() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingQuantidade, setEditingQuantidade] = useState<string>('')
  const [rowActionLoading, setRowActionLoading] = useState(false)

  const [startDate, setStartDate] = useState(() => toISODateLocal(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
  const [endDate, setEndDate] = useState(() => toISODateLocal(new Date()))
  const [allTime, setAllTime] = useState(false)
  const [useSingleDay, setUseSingleDay] = useState(false)
  const [singleDay, setSingleDay] = useState(() => toISODateLocal(new Date()))
  const [rows, setRows] = useState<ContagemRow[]>([])

  const dateRangeText = useMemo(() => {
    if (allTime) return 'Todas as datas'
    if (useSingleDay) return `Dia: ${formatDateBR(singleDay)}`
    return `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`
  }, [allTime, useSingleDay, singleDay, startDate, endDate])

  async function load() {
    setLoading(true)
    setError('')
    setSuccess('')
    setRows([])

    try {
      const select = `
        id,
        data_hora_contagem,
        conferente_id,
        conferentes(nome),
        produto_id,
        codigo_interno,
        descricao,
        unidade_medida,
        quantidade_up,
        lote,
        observacao,
        data_fabricacao,
        data_validade,
        ean,
        dun
      `
      // Mantemos tudo numa linha (menos chance de parse estranho no PostgREST)
      const selectCompact = select.replace(/\s+/g, '')

      let q = supabase
        .from('contagens_estoque')
        .select(selectCompact)
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

      const { data, error: qError } = await q.limit(20000)
      if (qError) throw qError

      setRows((data ?? []) as unknown as ContagemRow[])
    } catch (e: any) {
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

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <h2>Relatório completo por data de contagem</h2>

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
        </div>

        {error ? <div style={{ color: '#b00020' }}>{error}</div> : null}
        {success ? <div style={{ color: '#0f7a0f' }}>{success}</div> : null}

        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1200 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Data (dia)</th>
                  <th style={thStyle}>Data/hora</th>
                  <th style={thStyle}>Conferente</th>
                  <th style={thStyle}>Código</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle}>Un.</th>
                  <th style={thStyle}>Qtd (up)</th>
                  <th style={thStyle}>Lote</th>
                  <th style={thStyle}>Obs</th>
                  <th style={thStyle}>Fabric.</th>
                  <th style={thStyle}>Validade</th>
                  <th style={thStyle}>EAN</th>
                  <th style={thStyle}>DUN</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{formatDateBR(dateKeyFromIso(r.data_hora_contagem))}</td>
                    <td style={tdStyle}>{formatDateTimeBR(r.data_hora_contagem)}</td>
                    <td style={tdStyle}>
                      {(() => {
                        if (!r.conferentes) return r.conferente_id
                        if (Array.isArray(r.conferentes)) return r.conferentes[0]?.nome ?? r.conferente_id
                        return r.conferentes.nome ?? r.conferente_id
                      })()}
                    </td>
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
                    <td style={tdStyle}>{r.lote ?? ''}</td>
                    <td style={tdStyle}>{r.observacao ?? ''}</td>
                    <td style={tdStyle}>{r.data_fabricacao ? formatDateBR(r.data_fabricacao) : ''}</td>
                    <td style={tdStyle}>{r.data_validade ? formatDateBR(r.data_validade) : ''}</td>
                    <td style={tdStyle}>{r.ean ?? ''}</td>
                    <td style={tdStyle}>{r.dun ?? ''}</td>
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

