import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '../lib/supabaseClient'

const TABELA_PRODUTOS = 'Todos os Produtos'
const PAGE_SIZE = 25

type ProdutoDbRow = {
  id: string
  codigo_interno: string
  descricao: string
  /** Coluna `unidade` em "Todos os Produtos" (fallback: `unidade_medida` legado). */
  unidade: string | null
  ean: string | null
  dun: string | null
}

function rowKey(r: ProdutoDbRow) {
  if (r.id && String(r.id).trim() !== '') return String(r.id)
  return `cod:${r.codigo_interno.trim()}`
}

function normEanDun(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function isColumnMissingError(e: unknown): boolean {
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = (
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  ).toLowerCase()
  return code === '42703' || msg.includes('does not exist')
}

export default function BaseProdutos() {
  const [rows, setRows] = useState<ProdutoDbRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterCodigo, setFilterCodigo] = useState('')
  const [filterDescricao, setFilterDescricao] = useState('')
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editSnapshot, setEditSnapshot] = useState<ProdutoDbRow | null>(null)

  const [cadastroOpen, setCadastroOpen] = useState(false)
  const [cadastroCodigo, setCadastroCodigo] = useState('')
  const [cadastroDescricao, setCadastroDescricao] = useState('')
  const [cadastroUnidade, setCadastroUnidade] = useState('')
  const [cadastroEan, setCadastroEan] = useState('')
  const [cadastroDun, setCadastroDun] = useState('')
  const [cadastroSaving, setCadastroSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      let data: Record<string, unknown>[] | null = null
      let qErr: { message?: string; code?: string } | null = null
      const selFull = 'id,codigo_interno,descricao,unidade,ean,dun'
      const selLegado = 'id,codigo_interno,descricao,unidade_medida,ean,dun'
      const selBasico = 'id,codigo_interno,descricao,ean,dun'
      let res = await supabase.from(TABELA_PRODUTOS).select(selFull).order('codigo_interno', { ascending: true }).limit(20000)
      data = res.data as Record<string, unknown>[] | null
      qErr = res.error
      if (qErr && (String(qErr.code) === '42703' || String(qErr.message ?? '').toLowerCase().includes('does not exist'))) {
        res = await supabase.from(TABELA_PRODUTOS).select(selLegado).order('codigo_interno', { ascending: true }).limit(20000)
        data = res.data as Record<string, unknown>[] | null
        qErr = res.error
      }
      if (qErr && (String(qErr.code) === '42703' || String(qErr.message ?? '').toLowerCase().includes('does not exist'))) {
        res = await supabase.from(TABELA_PRODUTOS).select(selBasico).order('codigo_interno', { ascending: true }).limit(20000)
        data = res.data as Record<string, unknown>[] | null
        qErr = res.error
      }
      if (qErr) throw qErr
      const mapped: ProdutoDbRow[] = (data ?? []).map((r: Record<string, unknown>) => {
        const um = r.unidade ?? r.unidade_medida ?? r.UNIDADE
        return {
          id: String(r.id ?? ''),
          codigo_interno: String(r.codigo_interno ?? r.codigo ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade:
            um != null && String(um).trim() !== '' ? String(um).trim() : null,
          ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean) : null,
          dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun) : null,
        }
      })
      const list = mapped.filter((r) => r.codigo_interno.trim() !== '')
      setRows(list)
      setEditingKey(null)
      setEditSnapshot(null)
      setPage(1)
      setShowAll(false)
      setSuccess(`${list.length} produto(s) carregado(s).`)
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
    if (showAll) return filtered
    const start = (pageSafe - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, pageSafe, showAll])

  const rangeFrom =
    filtered.length === 0 ? 0 : showAll ? 1 : (pageSafe - 1) * PAGE_SIZE + 1
  const rangeTo =
    filtered.length === 0 ? 0 : showAll ? filtered.length : Math.min(pageSafe * PAGE_SIZE, filtered.length)

  function patchRow(key: string, patch: Partial<ProdutoDbRow>) {
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)))
  }

  function startEdit(r: ProdutoDbRow) {
    const k = rowKey(r)
    if (editingKey && editingKey !== k) {
      if (!confirm('Há outra linha em edição. Descartar alterações nela e editar esta?')) return
      cancelEditInternal()
    }
    setEditSnapshot({ ...r })
    setEditingKey(k)
    setError('')
    setSuccess('')
  }

  function cancelEditInternal() {
    if (editingKey && editSnapshot) {
      setRows((prev) => prev.map((x) => (rowKey(x) === editingKey ? { ...editSnapshot } : x)))
    }
    setEditingKey(null)
    setEditSnapshot(null)
  }

  function cancelEdit() {
    cancelEditInternal()
  }

  function buildFilterForRow(r: ProdutoDbRow) {
    if (r.id && r.id.trim() !== '') {
      return (q: ReturnType<typeof supabase.from>) => q.eq('id', r.id)
    }
    if (r.codigo_interno.trim()) {
      return (q: ReturnType<typeof supabase.from>) => q.eq('codigo_interno', r.codigo_interno.trim())
    }
    throw new Error('Sem id nem código para identificar a linha.')
  }

  async function saveRow(r: ProdutoDbRow) {
    const k = rowKey(r)
    setSavingKey(k)
    setError('')
    setSuccess('')
    try {
      const descricao = String(r.descricao ?? '').trim()
      if (!descricao) throw new Error('Descrição é obrigatória.')

      const ean = normEanDun(r.ean)
      const dun = normEanDun(r.dun)
      const unidadeRaw = String(r.unidade ?? '').trim()
      const unidade = unidadeRaw === '' ? null : unidadeRaw

      const runUpdate = (
        payload: Record<string, unknown>,
        filter: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>,
      ) => {
        let q = supabase.from(TABELA_PRODUTOS).update(payload)
        q = filter(q) as typeof q
        return q.select('id,codigo_interno').limit(1)
      }

      const tryUpdate = async (payload: Record<string, unknown>) => {
        let res = await runUpdate(payload, buildFilterForRow(r))
        if ((!res.data || res.data.length === 0) && !res.error && r.id && r.id.trim() !== '' && r.codigo_interno.trim()) {
          res = await runUpdate(payload, (q) => q.eq('codigo_interno', r.codigo_interno.trim()))
        }
        return res
      }

      let payload: Record<string, unknown> = { descricao, ean, dun, unidade }
      let { data, error: uErr } = await tryUpdate(payload)

      if (uErr && isColumnMissingError(uErr)) {
        const { unidade: _u, ...rest } = payload
        const r2 = await tryUpdate(rest)
        data = r2.data
        uErr = r2.error as typeof uErr
      }

      if (uErr && isColumnMissingError(uErr)) {
        const r3 = await tryUpdate({ descricao, ean, dun })
        data = r3.data
        uErr = r3.error as typeof uErr
      }

      if (uErr) throw uErr
      if (!data || data.length === 0) {
        throw new Error(
          'Nenhuma linha foi atualizada no banco (0 linhas). No Supabase, execute o script ' +
            'supabase/sql/rls_todos_os_produtos_crud.sql (RLS + GRANT). Se já executou, confira se o id/código da linha bate com o banco.',
        )
      }

      setSuccess(`Produto ${r.codigo_interno} atualizado no banco.`)
      setEditingKey(null)
      setEditSnapshot(null)
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao salvar.')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteRow(r: ProdutoDbRow) {
    if (!confirm(`Excluir permanentemente o produto ${r.codigo_interno} — ${r.descricao}?`)) return
    const k = rowKey(r)
    setDeletingKey(k)
    setError('')
    setSuccess('')
    try {
      let q = supabase.from(TABELA_PRODUTOS).delete()
      q = buildFilterForRow(r)(q)
      const { error: dErr } = await q
      if (dErr) throw dErr
      setSuccess(`Produto ${r.codigo_interno} excluído do banco.`)
      if (editingKey === k) {
        setEditingKey(null)
        setEditSnapshot(null)
      }
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao excluir.')
    } finally {
      setDeletingKey(null)
    }
  }

  async function cadastrarProduto() {
    const cod = cadastroCodigo.trim()
    const desc = cadastroDescricao.trim()
    if (!cod || !desc) {
      setError('Código e descrição são obrigatórios no cadastro.')
      return
    }
    setCadastroSaving(true)
    setError('')
    setSuccess('')
    try {
      const ean = normEanDun(cadastroEan)
      const dun = normEanDun(cadastroDun)
      const unidadeRaw = cadastroUnidade.trim()
      const unidade = unidadeRaw === '' ? null : unidadeRaw

      const tryInsert = async (payload: Record<string, unknown>) => {
        return supabase.from(TABELA_PRODUTOS).insert(payload).select('id,codigo_interno').limit(1)
      }

      let payload: Record<string, unknown> = {
        codigo_interno: cod,
        descricao: desc,
        ean,
        dun,
        unidade,
      }
      let { data, error: insErr } = await tryInsert(payload)

      if (insErr && isColumnMissingError(insErr)) {
        const { unidade: _u, ...rest } = payload
        const r2 = await tryInsert(rest)
        data = r2.data
        insErr = r2.error as typeof insErr
      }

      if (insErr && isColumnMissingError(insErr)) {
        const r3 = await tryInsert({
          codigo_interno: cod,
          descricao: desc,
          ean,
          dun,
          unidade_medida: unidade,
        })
        data = r3.data
        insErr = r3.error as typeof insErr
      }

      if (insErr && isColumnMissingError(insErr)) {
        const r4 = await tryInsert({ codigo_interno: cod, descricao: desc, ean, dun })
        data = r4.data
        insErr = r4.error as typeof insErr
      }

      if (insErr) throw insErr
      if (!data || data.length === 0) {
        throw new Error(
          'Insert não retornou linha. Verifique permissões RLS (INSERT) na tabela "Todos os Produtos".',
        )
      }

      setSuccess(`Produto ${cod} cadastrado no banco.`)
      setCadastroOpen(false)
      setCadastroCodigo('')
      setCadastroDescricao('')
      setCadastroUnidade('')
      setCadastroEan('')
      setCadastroDun('')
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Erro ao cadastrar.')
    } finally {
      setCadastroSaving(false)
    }
  }

  const canEditRow = (k: string) => editingKey === k

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px' }}>Base de dados — Todos os Produtos</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text, #666)', maxWidth: 720 }}>
        Lista da tabela <code style={{ fontSize: 12 }}>public.&quot;{TABELA_PRODUTOS}&quot;</code>. Use{' '}
        <strong>Editar</strong> para alterar descrição, unidade, EAN e DUN e depois <strong>Salvar</strong> — a gravação é
        confirmada no banco (se o Supabase retornar 0 linhas, aparece aviso de RLS). <strong>Excluir</strong> remove a
        linha. Permissões INSERT/UPDATE/DELETE via RLS. Se aparecer <strong>0 linhas</strong> ao salvar, execute no SQL
        Editor o arquivo{' '}
        <code style={{ fontSize: 12 }}>supabase/sql/rls_todos_os_produtos_crud.sql</code>.
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
        <button
          type="button"
          onClick={() => {
            setCadastroOpen((v) => !v)
            setError('')
          }}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid #1b5e20',
            background: '#2e7d32',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {cadastroOpen ? 'Fechar cadastro' : 'Cadastrar produtos'}
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Filtrar código
          <input
            value={filterCodigo}
            onChange={(e) => {
              setFilterCodigo(e.target.value)
              setPage(1)
              setShowAll(false)
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
              setShowAll(false)
            }}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', width: '100%' }}
            placeholder="descrição"
          />
        </label>
      </div>

      {cadastroOpen ? (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 10,
            border: '1px solid var(--border, #ccc)',
            background: 'var(--panel-bg, rgba(0,0,0,.04))',
            maxWidth: 560,
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Novo produto</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              Código do produto *
              <input
                value={cadastroCodigo}
                onChange={(e) => setCadastroCodigo(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px' }}
                placeholder="ex.: 01.01.0099"
                autoComplete="off"
              />
            </label>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              Descrição *
              <textarea
                value={cadastroDescricao}
                onChange={(e) => setCadastroDescricao(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px', minHeight: 72, resize: 'vertical' }}
                placeholder="Descrição do produto"
                rows={3}
              />
            </label>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              Unidade de medida
              <input
                value={cadastroUnidade}
                onChange={(e) => setCadastroUnidade(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px' }}
                placeholder="ex.: PT, CX"
                autoComplete="off"
              />
            </label>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              EAN
              <input
                value={cadastroEan}
                onChange={(e) => setCadastroEan(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px' }}
                autoComplete="off"
              />
            </label>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              DUN
              <input
                value={cadastroDun}
                onChange={(e) => setCadastroDun(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px' }}
                autoComplete="off"
              />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={cadastroSaving}
                onClick={() => void cadastrarProduto()}
                style={btnPrimary}
              >
                {cadastroSaving ? 'Salvando…' : 'Salvar novo produto'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div style={{ color: '#b00020', marginBottom: 10 }}>{error}</div> : null}
      {success ? <div style={{ color: '#0f7a0f', marginBottom: 10 }}>{success}</div> : null}

      {filtered.length > 0 ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text, #888)', marginBottom: 8 }}>
            {showAll
              ? `Exibindo todos os ${filtered.length} produto(s) filtrado(s) (total no cadastro: ${rows.length})`
              : `Mostrando ${rangeFrom}–${rangeTo} de ${filtered.length} · Página ${pageSafe} de ${totalPages} · ${PAGE_SIZE} por página (total no cadastro: ${rows.length})`}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Código do produto</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle}>Unidade de medida</th>
                  <th style={thStyle}>EAN</th>
                  <th style={thStyle}>DUN</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => {
                  const k = rowKey(r)
                  const saving = savingKey === k
                  const deleting = deletingKey === k
                  const edit = canEditRow(k)
                  return (
                    <tr key={k}>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{r.codigo_interno}</span>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 320 }}>
                        {edit ? (
                          <textarea
                            value={r.descricao}
                            onChange={(e) => patchRow(k, { descricao: e.target.value })}
                            style={{ ...inputStyle, width: '100%', minHeight: 56, resize: 'vertical' }}
                            rows={2}
                          />
                        ) : (
                          r.descricao
                        )}
                      </td>
                      <td style={tdStyle}>
                        {edit ? (
                          <input
                            value={r.unidade ?? ''}
                            onChange={(e) =>
                              patchRow(k, {
                                unidade: e.target.value.trim() === '' ? null : e.target.value,
                              })
                            }
                            style={{ ...inputStyle, width: 96 }}
                          />
                        ) : (
                          r.unidade ?? '—'
                        )}
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={r.ean ?? ''}
                          onChange={(e) => patchRow(k, { ean: e.target.value === '' ? null : e.target.value })}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            minWidth: 120,
                            maxWidth: 200,
                            opacity: edit ? 1 : 0.65,
                          }}
                          placeholder="EAN"
                          disabled={!edit || saving || deleting}
                          readOnly={!edit}
                          autoComplete="off"
                        />
                        {saving ? (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--text, #888)', marginTop: 4 }}>
                            Salvando…
                          </span>
                        ) : null}
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={r.dun ?? ''}
                          onChange={(e) => patchRow(k, { dun: e.target.value === '' ? null : e.target.value })}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            minWidth: 120,
                            maxWidth: 200,
                            opacity: edit ? 1 : 0.65,
                          }}
                          placeholder="DUN"
                          disabled={!edit || saving || deleting}
                          readOnly={!edit}
                          autoComplete="off"
                        />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {!edit ? (
                            <>
                              <button
                                type="button"
                                disabled={saving || deleting || !!editingKey}
                                onClick={() => startEdit(r)}
                                style={btnPrimary}
                                title={editingKey ? 'Termine ou cancele a outra edição' : undefined}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                disabled={saving || deleting || !!editingKey}
                                onClick={() => void deleteRow(r)}
                                style={btnDanger}
                              >
                                {deleting ? 'Excluindo…' : 'Excluir'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={saving || deleting}
                                onClick={() => void saveRow(r)}
                                style={btnPrimary}
                              >
                                {saving ? 'Salvando…' : 'Salvar'}
                              </button>
                              <button type="button" disabled={saving || deleting} onClick={() => cancelEdit()} style={btnMuted}>
                                Cancelar
                              </button>
                              <button
                                type="button"
                                disabled={saving || deleting}
                                onClick={() => void deleteRow(r)}
                                style={btnDanger}
                              >
                                Excluir
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
          {filtered.length > PAGE_SIZE || (filtered.length > 0 && showAll) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={showAll || pageSafe <= 1 || filtered.length === 0}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={navBtnStyle(showAll || pageSafe <= 1 || filtered.length === 0)}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={showAll || pageSafe >= totalPages || filtered.length === 0}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={navBtnStyle(showAll || pageSafe >= totalPages || filtered.length === 0)}
              >
                Próxima
              </button>
              {filtered.length > PAGE_SIZE ? (
                showAll ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(false)
                      setPage(1)
                    }}
                    style={navBtnStyle(false)}
                  >
                    Paginar ({PAGE_SIZE} por página)
                  </button>
                ) : (
                  <button type="button" onClick={() => setShowAll(true)} style={navBtnStyle(false)}>
                    Mostrar tudo
                  </button>
                )
              ) : null}
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

const btnDanger: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #8a0000',
  background: '#a30000',
  color: '#fff',
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
