import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /** Data (YYYY-MM-DD) da última alteração do EAN no cadastro. */
  ean_alterado_em: string | null
  /** Data (YYYY-MM-DD) da última alteração do DUN no cadastro. */
  dun_alterado_em: string | null
  /** Só preenchido se o banco ainda expuser a coluna legada `ean_dun_alterado_em`. */
  ean_dun_alterado_em?: string | null
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

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function formatDateBRFromYmd(ymd: string | null | undefined): string {
  if (!ymd || String(ymd).trim() === '') return '—'
  const s = String(ymd).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(s)
  if (!m) return s
  return `${m[3]}/${m[2]}/${m[1]}`
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '')
}

/** Compara valor cadastrado com o lido no bipador (com ou sem dígitos só). */
function matchesBarcode(stored: string | null | undefined, scanned: string): boolean {
  const q = scanned.trim()
  if (!q) return false
  const a = normEanDun(stored)
  if (a != null && a === q) return true
  if (a != null && onlyDigits(a) !== '' && onlyDigits(a) === onlyDigits(q)) return true
  return false
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

  const [bipCodigoBarras, setBipCodigoBarras] = useState('')
  /** Quando definido, a tabela mostra só esta linha (produto encontrado pelo bip). */
  const [bipSoloKey, setBipSoloKey] = useState<string | null>(null)
  const bipInputRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map())

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

      const trySelect = async (cols: string) =>
        supabase.from(TABELA_PRODUTOS).select(cols).order('codigo_interno', { ascending: true }).limit(20000)

      const candidates = [
        `${selFull},ean_alterado_em,dun_alterado_em`,
        `${selFull},ean_dun_alterado_em`,
        selFull,
        `${selLegado},ean_alterado_em,dun_alterado_em`,
        `${selLegado},ean_dun_alterado_em`,
        selLegado,
        `${selBasico},ean_alterado_em,dun_alterado_em`,
        `${selBasico},ean_dun_alterado_em`,
        selBasico,
      ]

      let res = await trySelect(candidates[0])
      data = res.data as Record<string, unknown>[] | null
      qErr = res.error
      for (let i = 1; i < candidates.length && qErr && isColumnMissingError(qErr); i++) {
        res = await trySelect(candidates[i])
        data = res.data as Record<string, unknown>[] | null
        qErr = res.error
      }
      if (qErr) throw qErr
      const mapped: ProdutoDbRow[] = (data ?? []).map((r: Record<string, unknown>) => {
        const um = r.unidade ?? r.unidade_medida ?? r.UNIDADE
        const leg = r.ean_dun_alterado_em
        const legStr = leg != null && String(leg).trim() !== '' ? String(leg).slice(0, 10) : null
        const eanA = r.ean_alterado_em
        const dunA = r.dun_alterado_em
        const eanStr =
          eanA != null && String(eanA).trim() !== '' ? String(eanA).slice(0, 10) : legStr
        const dunStr =
          dunA != null && String(dunA).trim() !== '' ? String(dunA).slice(0, 10) : legStr
        return {
          id: String(r.id ?? ''),
          codigo_interno: String(r.codigo_interno ?? r.codigo ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade:
            um != null && String(um).trim() !== '' ? String(um).trim() : null,
          ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean) : null,
          dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun) : null,
          ean_alterado_em: eanStr,
          dun_alterado_em: dunStr,
          ean_dun_alterado_em: legStr,
        }
      })
      const list = mapped.filter((r) => r.codigo_interno.trim() !== '')
      setRows(list)
      setEditingKey(null)
      setEditSnapshot(null)
      setPage(1)
      setShowAll(false)
      setBipSoloKey(null)
      setBipCodigoBarras('')
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
    let list = rows.filter((r) => {
      const okC = !c || r.codigo_interno.toLowerCase().includes(c)
      const okD = !d || r.descricao.toLowerCase().includes(d)
      return okC && okD
    })
    if (bipSoloKey) {
      list = list.filter((r) => rowKey(r) === bipSoloKey)
    }
    return list
  }, [rows, filterCodigo, filterDescricao, bipSoloKey])

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

  function limparBipEFiltroSolo() {
    setBipSoloKey(null)
    setBipCodigoBarras('')
    setPage(1)
    setShowAll(false)
    setError('')
  }

  function buscarPorBipEanDun() {
    const q = bipCodigoBarras.trim()
    if (!q) {
      setError('Informe o código EAN ou DUN (ou use o leitor e pressione Enter).')
      setSuccess('')
      return
    }
    if (rows.length === 0) {
      setError('Carregue a lista primeiro.')
      setSuccess('')
      return
    }
    const found = rows.find((r) => matchesBarcode(r.ean, q) || matchesBarcode(r.dun, q))
    if (!found) {
      setError(`Nenhum produto com EAN ou DUN: ${q}`)
      setSuccess('')
      return
    }
    const soloK = rowKey(found)
    setBipSoloKey(soloK)
    setError('')
    setFilterCodigo('')
    setFilterDescricao('')
    setShowAll(false)
    setPage(1)
    startEdit(found)
    setSuccess(`Produto ${found.codigo_interno} — aberto para edição.`)
    setBipCodigoBarras('')
    window.setTimeout(() => bipInputRef.current?.focus(), 0)
  }

  useEffect(() => {
    if (!editingKey) return
    const t = window.setTimeout(() => {
      const el = rowRefs.current.get(editingKey)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [editingKey, pageSafe, showAll])

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

      const snap = editSnapshot
      const eanChanged = normEanDun(r.ean) !== normEanDun(snap?.ean)
      const dunChanged = normEanDun(r.dun) !== normEanDun(snap?.dun)
      const ean_alterado_em = eanChanged ? todayYmdLocal() : (r.ean_alterado_em ?? null)
      const dun_alterado_em = dunChanged ? todayYmdLocal() : (r.dun_alterado_em ?? null)
      const legacy_combo =
        eanChanged || dunChanged
          ? todayYmdLocal()
          : (r.ean_dun_alterado_em ?? snap?.ean_dun_alterado_em ?? null)

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

      const updateTries: Record<string, unknown>[] = [
        { descricao, ean, dun, unidade, ean_alterado_em, dun_alterado_em },
        { descricao, ean, dun, ean_alterado_em, dun_alterado_em },
        { descricao, ean, dun, unidade, ean_dun_alterado_em: legacy_combo },
        { descricao, ean, dun, ean_dun_alterado_em: legacy_combo },
        { descricao, ean, dun, unidade },
        { descricao, ean, dun },
      ]

      let data: { id: unknown; codigo_interno: unknown }[] | null = null
      let uErr: { message?: string; code?: string } | null = null
      for (const payload of updateTries) {
        const res = await tryUpdate(payload)
        data = res.data as typeof data
        uErr = res.error
        if (!uErr) break
        if (!isColumnMissingError(uErr)) break
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
      const trimmedCod = r.codigo_interno.trim()

      if (r.id && String(r.id).trim() !== '') {
        const { data: del, error: dErr } = await supabase
          .from(TABELA_PRODUTOS)
          .delete()
          .eq('id', r.id)
          .select('id')
        if (dErr) throw dErr
        if (!del?.length) throw new Error('Nenhuma linha excluída (id não encontrado no banco).')
      } else {
        const { data: delExact, error: e1 } = await supabase
          .from(TABELA_PRODUTOS)
          .delete()
          .eq('codigo_interno', trimmedCod)
          .select('id')
        if (e1) throw e1
        if (!delExact?.length) {
          const { data: all, error: lErr } = await supabase.from(TABELA_PRODUTOS).select('id,codigo_interno').limit(20000)
          if (lErr) throw lErr
          const exactValues = [
            ...new Set(
              (all ?? [])
                .filter((row) => String(row.codigo_interno ?? '').trim() === trimmedCod)
                .map((row) => String(row.codigo_interno ?? '')),
            ),
          ]
          if (exactValues.length === 0) {
            throw new Error(
              'Nenhuma linha com esse código. Se no Supabase o código parece igual ao digitado, ele pode ter espaços — rode supabase/sql/normalize_todos_os_produtos_codigo_trim.sql ou use delete com trim() no SQL Editor.',
            )
          }
          let total = 0
          for (const exact of exactValues) {
            const { data: del, error: de } = await supabase
              .from(TABELA_PRODUTOS)
              .delete()
              .eq('codigo_interno', exact)
              .select('id')
            if (de) throw de
            total += del?.length ?? 0
          }
          if (total === 0) throw new Error('Exclusão não removeu linhas.')
        }
      }

      setSuccess(`Produto ${trimmedCod} excluído do banco.`)
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

      const patchNew: Record<string, unknown> = {}
      if (ean != null) patchNew.ean_alterado_em = todayYmdLocal()
      if (dun != null) patchNew.dun_alterado_em = todayYmdLocal()
      const legacyIns =
        ean != null || dun != null ? { ean_dun_alterado_em: todayYmdLocal() as string } : {}

      const insertTries: Record<string, unknown>[] = [
        { codigo_interno: cod, descricao: desc, ean, dun, unidade, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade },
        { codigo_interno: cod, descricao: desc, ean, dun },
      ]

      let data: { id: unknown; codigo_interno: unknown }[] | null = null
      let insErr: { message?: string; code?: string } | null = null
      for (const p of insertTries) {
        const res = await tryInsert(p)
        data = res.data as typeof data
        insErr = res.error
        if (!insErr) break
        if (!isColumnMissingError(insErr)) break
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
        confirmada no banco (se o Supabase retornar 0 linhas, aparece aviso de RLS). As colunas{' '}
        <strong>Alteração EAN</strong> e <strong>Alteração DUN</strong> mostram o dia da última alteração de cada código
        (execute <code style={{ fontSize: 12 }}>supabase/sql/alter_todos_os_produtos_ean_dun_alterado_em.sql</code> no
        Supabase se necessário).         <strong>Excluir</strong> remove a linha. No painel Supabase (Table Editor), a exclusão exige{' '}
        <strong>chave primária</strong> em <code style={{ fontSize: 12 }}>id</code> e linhas sem{' '}
        <code style={{ fontSize: 12 }}>id</code> não podem ser apagadas pela UI — rode{' '}
        <code style={{ fontSize: 12 }}>supabase/sql/alter_todos_os_produtos_primary_key.sql</code>. Se o DELETE no
        SQL com <code style={{ fontSize: 12 }}>where codigo_interno = &apos;…&apos;</code> afetar 0 linhas, o código
        no banco pode ter espaços — use <code style={{ fontSize: 12 }}>trim(both from codigo_interno)</code> ou rode{' '}
        <code style={{ fontSize: 12 }}>supabase/sql/normalize_todos_os_produtos_codigo_trim.sql</code>. Permissões
        INSERT/UPDATE/DELETE via RLS. Se aparecer <strong>0 linhas</strong> ao salvar, execute no SQL Editor o arquivo{' '}
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
              setBipSoloKey(null)
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
              setBipSoloKey(null)
              setPage(1)
              setShowAll(false)
            }}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', width: '100%' }}
            placeholder="descrição"
          />
        </label>
      </div>

      <div style={{ width: '100%', marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text, #ccc)' }}>
            <strong>Bipar EAN ou DUN</strong> — mostra só esse produto na lista e abre para edição.{' '}
            <strong>Limpar</strong> ou campo vazio: lista completa de novo.
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              ref={bipInputRef}
              value={bipCodigoBarras}
              onChange={(e) => {
                const v = e.target.value
                setBipCodigoBarras(v)
                if (v.trim() === '') {
                  setBipSoloKey(null)
                  setError('')
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  buscarPorBipEanDun()
                }
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Aponte o leitor aqui e bip — ou digite e Enter"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #555)',
                flex: '1 1 260px',
                minWidth: 200,
                maxWidth: 480,
                fontSize: 15,
                fontFamily: 'monospace',
                background: 'var(--input-bg, #1a1a1a)',
                color: 'var(--text, #eee)',
              }}
              aria-label="Buscar produto por código EAN ou DUN"
            />
            <button
              type="button"
              onClick={() => buscarPorBipEanDun()}
              disabled={loading}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid #1565c0',
                background: '#1976d2',
                color: '#fff',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 13,
              }}
            >
              Buscar
            </button>
            <button
              type="button"
              onClick={() => limparBipEFiltroSolo()}
              disabled={loading}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid #666',
                background: 'transparent',
                color: 'var(--text, #eee)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 13,
              }}
              title="Mostrar todos os produtos de novo"
            >
              Limpar
            </button>
          </div>
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
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1400 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Código do produto</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle} title="Quem contou vem do relatório de contagens, não deste cadastro">
                    Conferente
                  </th>
                  <th style={thStyle}>Unidade de medida</th>
                  <th style={thStyle}>EAN</th>
                  <th style={thStyle}>DUN</th>
                  <th style={{ ...thStyle, minWidth: 110 }}>Alteração EAN</th>
                  <th style={{ ...thStyle, minWidth: 110 }}>Alteração DUN</th>
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
                    <tr
                      key={k}
                      ref={(el) => {
                        if (el) rowRefs.current.set(k, el)
                        else rowRefs.current.delete(k)
                      }}
                    >
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
                      <td
                        style={{ ...tdStyle, color: 'var(--text-muted, #888)', fontSize: 12 }}
                        title="Não armazenado no cadastro; use Relatório completo ou Todas as contagens para ver o conferente por lançamento."
                      >
                        —
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
                      <td
                        style={{
                          ...tdStyle,
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text, #bbb)',
                        }}
                        title="Última alteração do EAN no cadastro"
                      >
                        {formatDateBRFromYmd(r.ean_alterado_em)}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text, #bbb)',
                        }}
                        title="Última alteração do DUN no cadastro"
                      >
                        {formatDateBRFromYmd(r.dun_alterado_em)}
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
  borderBottom: '1px solid var(--border, #444)',
  textAlign: 'left',
  padding: 8,
  fontWeight: 700,
  fontSize: 13,
  background: 'var(--table-head-bg, rgba(255,255,255,.08))',
  color: 'var(--text, #eee)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border, #333)',
  padding: 8,
  fontSize: 13,
  verticalAlign: 'middle',
  color: 'var(--text, #eee)',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #ccc',
  fontSize: 13,
  boxSizing: 'border-box',
}
