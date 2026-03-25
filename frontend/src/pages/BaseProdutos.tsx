import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '../lib/supabaseClient'

const TABELA_PRODUTOS = 'Todos os Produtos'
const PAGE_SIZE = 25

type ProdutoDbRow = {
  id: string
  codigo_interno: string
  descricao: string
  unidade_medida: string | null
  ean: string | null
  dun: string | null
}

function rowKey(r: ProdutoDbRow) {
  if (r.id && String(r.id).trim() !== '') return String(r.id)
  return `cod:${r.codigo_interno.trim()}`
}

export default function BaseProdutos() {
  const [rows, setRows] = useState<ProdutoDbRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterCodigo, setFilterCodigo] = useState('')
  const [filterDescricao, setFilterDescricao] = useState('')
  const [page, setPage] = useState(1)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  /** Linha em edição; EAN/DUN só editáveis quando esta chave coincide. */
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<{ ean: string | null; dun: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    setEditingKey(null)
    setSnapshot(null)
    try {
      let data: Record<string, unknown>[] | null = null
      let qErr: { message?: string; code?: string } | null = null
      const selFull = 'id,codigo_interno,descricao,unidade_medida,ean,dun'
      const selBasico = 'id,codigo_interno,descricao,ean,dun'
      const res = await supabase.from(TABELA_PRODUTOS).select(selFull).order('codigo_interno', { ascending: true }).limit(20000)
      data = res.data as Record<string, unknown>[] | null
      qErr = res.error
      if (qErr && (String(qErr.code) === '42703' || String(qErr.message ?? '').toLowerCase().includes('does not exist'))) {
        const res2 = await supabase.from(TABELA_PRODUTOS).select(selBasico).order('codigo_interno', { ascending: true }).limit(20000)
        data = res2.data as Record<string, unknown>[] | null
        qErr = res2.error
      }
      if (qErr) throw qErr
      const mapped: ProdutoDbRow[] = (data ?? []).map((r: Record<string, unknown>) => {
        const um = r.unidade_medida ?? r.unidade ?? r.UNIDADE
        return {
          id: String(r.id ?? ''),
          codigo_interno: String(r.codigo_interno ?? r.codigo ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade_medida:
            um != null && String(um).trim() !== '' ? String(um).trim() : null,
          ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean) : null,
          dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun) : null,
        }
      })
      setRows(mapped.filter((r) => r.codigo_interno.trim() !== ''))
      setPage(1)
      setSuccess(`${mapped.length} produto(s) carregado(s).`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao carregar a base.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const c = filterCodigo.trim().toLowerCase()
    const d = filterDescricao.trim().toLowerCase()
    return rows.filter((r) => {
      const okC = !c || r.codigo_interno.toLowerCase().includes(c)
      const okD = !d || r.descricao.toLowerCase().includes(d)
      return okC && okD
    })
  }, [rows, filterCodigo, filterDescricao])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const slice = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, pageSafe])

  function revertRow(k: string, snap: { ean: string | null; dun: string | null }) {
    setRows((prev) =>
      prev.map((r) => (rowKey(r) === k ? { ...r, ean: snap.ean, dun: snap.dun } : r)),
    )
  }

  function startEdit(r: ProdutoDbRow) {
    const k = rowKey(r)
    if (editingKey && editingKey !== k && snapshot) {
      revertRow(editingKey, snapshot)
    }
    setSnapshot({ ean: r.ean, dun: r.dun })
    setEditingKey(k)
  }

  function cancelEdit() {
    if (!editingKey || !snapshot) {
      setEditingKey(null)
      setSnapshot(null)
      return
    }
    revertRow(editingKey, snapshot)
    setEditingKey(null)
    setSnapshot(null)
  }

  function setField(key: string, field: 'ean' | 'dun', value: string) {
    setRows((prev) =>
      prev.map((r) => (rowKey(r) === key ? { ...r, [field]: value === '' ? null : value } : r)),
    )
  }

  async function saveRow(r: ProdutoDbRow) {
    const k = rowKey(r)
    setSavingKey(k)
    setError('')
    setSuccess('')
    try {
      const ean = r.ean != null && String(r.ean).trim() !== '' ? String(r.ean).trim() : null
      const dun = r.dun != null && String(r.dun).trim() !== '' ? String(r.dun).trim() : null
      let q = supabase.from(TABELA_PRODUTOS).update({ ean, dun })
      if (r.id && r.id.trim() !== '') {
        q = q.eq('id', r.id)
      } else if (r.codigo_interno.trim()) {
        q = q.eq('codigo_interno', r.codigo_interno.trim())
      } else {
        throw new Error('Sem id nem código para identificar a linha.')
      }
      const { error: uErr } = await q
      if (uErr) throw uErr
      setSuccess(`EAN/DUN salvos para ${r.codigo_interno}.`)
      setEditingKey(null)
      setSnapshot(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao salvar.')
    } finally {
      setSavingKey(null)
    }
  }

  const canEdit = (k: string) => editingKey === k

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px' }}>Base de dados — Todos os Produtos</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text, #666)', maxWidth: 720 }}>
        Lista carregada da tabela <code style={{ fontSize: 12 }}>public.&quot;{TABELA_PRODUTOS}&quot;</code>. Clique em{' '}
        <strong>Editar</strong> para liberar EAN e DUN; depois use <strong>Salvar</strong>. É necessário permissão de UPDATE
        no Supabase (RLS).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid #222',
            background: '#111',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Carregando…' : 'Carregar / atualizar lista'}
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Filtrar código
          <input
            value={filterCodigo}
            onChange={(e) => {
              setFilterCodigo(e.target.value)
              setPage(1)
            }}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', minWidth: 160 }}
            placeholder="código"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: '1 1 200px' }}>
          Filtrar descrição
          <input
            value={filterDescricao}
            onChange={(e) => {
              setFilterDescricao(e.target.value)
              setPage(1)
            }}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', width: '100%' }}
            placeholder="descrição"
          />
        </label>
      </div>

      {error ? <div style={{ color: '#b00020', marginBottom: 10 }}>{error}</div> : null}
      {success ? <div style={{ color: '#0f7a0f', marginBottom: 10 }}>{success}</div> : null}

      {filtered.length > 0 ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text, #888)', marginBottom: 8 }}>
            Mostrando {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} de{' '}
            {filtered.length} (total no cadastro: {rows.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Código</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle}>Unidade</th>
                  <th style={thStyle}>EAN</th>
                  <th style={thStyle}>DUN</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => {
                  const k = rowKey(r)
                  const saving = savingKey === k
                  const edit = canEdit(k)
                  return (
                    <tr key={k}>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{r.codigo_interno}</span>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 320 }}>{r.descricao}</td>
                      <td style={tdStyle}>{r.unidade_medida ?? '—'}</td>
                      <td style={tdStyle}>
                        <input
                          value={r.ean ?? ''}
                          onChange={(e) => setField(k, 'ean', e.target.value)}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            minWidth: 120,
                            maxWidth: 200,
                            opacity: edit ? 1 : 0.75,
                          }}
                          placeholder="EAN"
                          disabled={saving || !edit}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={r.dun ?? ''}
                          onChange={(e) => setField(k, 'dun', e.target.value)}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            minWidth: 120,
                            maxWidth: 200,
                            opacity: edit ? 1 : 0.75,
                          }}
                          placeholder="DUN"
                          disabled={saving || !edit}
                        />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {!edit ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => startEdit(r)}
                              style={btnPrimary}
                            >
                              Editar
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void saveRow(r)}
                                style={btnPrimary}
                              >
                                {saving ? 'Salvando…' : 'Salvar'}
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => cancelEdit()}
                                style={btnMuted}
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={navBtnStyle(pageSafe <= 1)}
              >
                Anterior
              </button>
              <span style={{ fontSize: 13 }}>
                Página {pageSafe} / {totalPages}
              </span>
              <button
                type="button"
                disabled={pageSafe >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={navBtnStyle(pageSafe >= totalPages)}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </>
      ) : !loading && rows.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text, #888)' }}>Clique em &quot;Carregar / atualizar lista&quot; para buscar os produtos.</p>
      ) : !loading && filtered.length === 0 && rows.length > 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text, #888)' }}>Nenhum produto com os filtros atuais.</p>
      ) : null}
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #222',
  background: '#111',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
}

const btnMuted: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #666',
  background: 'transparent',
  color: 'var(--text, #ccc)',
  cursor: 'pointer',
  fontSize: 12,
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border, #ccc)',
    background: disabled ? 'transparent' : '#111',
    color: disabled ? '#888' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
  }
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
  verticalAlign: 'middle',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #ccc',
  fontSize: 13,
  boxSizing: 'border-box',
}
