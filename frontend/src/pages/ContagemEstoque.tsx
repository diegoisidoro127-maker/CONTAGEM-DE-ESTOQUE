import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '../lib/supabaseClient'
import { toDatetimeLocalValue, toISOStringFromDatetimeLocal } from '../lib/datetime'

type Conferente = {
  id: string
  nome: string
}

type Produto = {
  id: string
  codigo_interno: string
  descricao: string
  unidade_medida: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
}

type ContagemPreviewRow = {
  // Data apenas (formato YYYY-MM-DD) para virar colunas tipo planilha
  data_key: string
  codigo_interno: string
  descricao: string
  quantidade_up: string | number
}

type ProductOption = {
  id: string
  codigo: string
  descricao: string
  unidade_medida: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
}

function toLocalDateKey(isoLike: string) {
  const dt = new Date(isoLike)
  if (Number.isNaN(dt.getTime())) return 'invalid-date'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function formatDateKey(dateKey: string) {
  // YYYY-MM-DD -> DD/MM/YYYY
  const [y, m, d] = dateKey.split('-')
  if (!y || !m || !d) return dateKey
  return `${d}/${m}/${y}`
}

function pickFirstString(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

function toDateInputValue(v?: string | null) {
  if (!v) return ''
  const str = String(v)
  const m = str.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : ''
}

function isUuid(value: string | null | undefined) {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export default function ContagemEstoque() {
  const sheetWebhookUrl = import.meta.env.VITE_SHEET_WEBHOOK_URL as string | undefined
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)
  const [showAddConferente, setShowAddConferente] = useState(false)
  const [newConferenteNome, setNewConferenteNome] = useState('')
  const [addingConferente, setAddingConferente] = useState(false)

  // Relógio de contagem: usuário informa o início e o campo segue atualizando automaticamente.
  const [clockBaseMs, setClockBaseMs] = useState(() => Date.now())
  const [clockRealStartMs, setClockRealStartMs] = useState(() => Date.now())
  const [clockTick, setClockTick] = useState(0)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const [conferenteId, setConferenteId] = useState<string>('')

  const [codigoInterno, setCodigoInterno] = useState('')
  const [descricaoInput, setDescricaoInput] = useState('')
  const [produto, setProduto] = useState<Produto | null>(null)
  const [produtoLoading, setProdutoLoading] = useState(false)
  const [produtoError, setProdutoError] = useState<string>('')
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [productOptionsLoading, setProductOptionsLoading] = useState(false)

  const [lote, setLote] = useState('')
  const [dataFabricacao, setDataFabricacao] = useState('')
  const [dataVencimento, setDataVencimento] = useState('')
  const [quantidadeContada, setQuantidadeContada] = useState<string>('') // quantidade principal da contagem
  const [quantidadeUp, setQuantidadeUp] = useState<string>('') // campo UP adicional
  const [observacao, setObservacao] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>('')
  const [saveSuccess, setSaveSuccess] = useState<string>('')

  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRows, setPreviewRows] = useState<ContagemPreviewRow[]>([])

  useEffect(() => {
    const id = setInterval(() => setClockTick((v) => v + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const dataHoraContagem = useMemo(() => {
    const elapsed = Date.now() - clockRealStartMs
    return toDatetimeLocalValue(new Date(clockBaseMs + elapsed))
  }, [clockBaseMs, clockRealStartMs, clockTick])

  useEffect(() => {
    ;(async () => {
      setConferentesLoading(true)
      setSaveError('')
      const { data, error } = await supabase.from('conferentes').select('id,nome').order('nome')
      if (error) {
        setSaveError(`Erro ao carregar conferentes: ${error.message}`)
        setConferentes([])
      } else {
        setConferentes(data ?? [])
      }
      setConferentesLoading(false)
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      setProductOptionsLoading(true)
      const tabelas = ['Todos os Produtos', 'todos_os_produtos', 'todos_produtos', 'produtos']
      let loaded: ProductOption[] = []
      let lastLoadError: string | null = null

      for (const tabela of tabelas) {
        // Carrega a linha inteira para não quebrar caso a tabela não tenha "id"
        // (na base "Todos os Produtos" normalmente temos row_index/codigo_interno/descricao).
        const { data, error } = await supabase.from(tabela).select('*').limit(10000)

        if (error) {
          const code = String(error.code ?? '')
          // ignora tabela ausente / não cacheada no PostgREST e tenta próxima
          if (code === '42P01' || code === 'PGRST205' || code === '42703') continue
          lastLoadError = error.message ?? 'erro ao carregar produtos'
          continue
        }

        if (data?.length) {
          const mapped = (data as Array<Record<string, any>>)
            .map((row) => {
              const codigo = pickFirstString(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto'])
              const descricao = pickFirstString(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto'])
              if (!codigo) return null
              return {
                id: String(row.id ?? row.row_index ?? row.dataset_id ?? codigo),
                codigo,
                descricao: descricao || 'Produto sem descrição',
                unidade_medida:
                  pickFirstString(row, ['unidade_medida', 'unidade', 'UNIDADE', 'und']) || null,
                data_fabricacao: row.data_fabricacao ?? null,
                data_validade: row.data_validade ?? null,
                ean: row.ean ?? null,
                dun: row.dun ?? null,
              } as ProductOption
            })
            .filter(Boolean) as ProductOption[]

          loaded = mapped
          break
        }
      }

      // remove duplicados por código
      const byCode = new Map<string, ProductOption>()
      for (const p of loaded) {
        if (!byCode.has(p.codigo)) byCode.set(p.codigo, p)
      }
      const normalized = Array.from(byCode.values())
      setProductOptions(normalized)
      if (!normalized.length && lastLoadError) {
        setProdutoError(`Erro ao carregar produtos da base: ${lastLoadError}`)
      }
      setProductOptionsLoading(false)
    })()
  }, [])

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) map.set(p.codigo, p)
    return map
  }, [productOptions])

  function applyProductByCode(codigo: string) {
    const p = productByCode.get(codigo)
    if (!p) return false
    setProduto({
      id: p.id,
      codigo_interno: p.codigo,
      descricao: p.descricao,
      unidade_medida: p.unidade_medida,
      data_fabricacao: p.data_fabricacao ?? null,
      data_validade: p.data_validade ?? null,
      ean: p.ean ?? null,
      dun: p.dun ?? null,
    })
    setDescricaoInput(p.descricao)
    setDataFabricacao(toDateInputValue(p.data_fabricacao))
    setDataVencimento(toDateInputValue(p.data_validade))
    setProdutoError('')
    return true
  }

  // Busca automática do produto pelo `codigo_interno`
  useEffect(() => {
    const codigo = codigoInterno.trim()
    setProdutoError('')

    if (!codigo) {
      setProduto(null)
      return
    }

    const handle = setTimeout(async () => {
      setProdutoLoading(true)

      // Primeiro tenta no cache local da tabela de produtos carregada
      if (applyProductByCode(codigo)) {
        setProdutoLoading(false)
        return
      }

      // Busca em múltiplas tabelas para suportar a base importada ("Todos os Produtos")
      const tabelas = ['produtos', 'Todos os Produtos', 'todos_os_produtos', 'todos_produtos']
      const colunasBusca = ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto', 'ean', 'dun']

      let found: Produto | null = null
      let lastMeaningfulError: any = null

      for (const tabela of tabelas) {
        for (const coluna of colunasBusca) {
          const resp = await supabase.from(tabela).select('*').eq(coluna, codigo).limit(1).maybeSingle()

          // Ignora "coluna não existe" e "tabela não existe", tenta próxima opção.
          if (resp.error) {
            const code = String(resp.error.code ?? '')
            const msg = String(resp.error.message ?? '').toLowerCase()
            if (code !== '42703' && code !== '42P01' && code !== 'PGRST205' && !msg.includes('schema cache')) {
              lastMeaningfulError = resp.error
            }
            continue
          }

          if (resp.data) {
            const row = resp.data as Record<string, any>
            const descricao = pickFirstString(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto'])
            const codigoInterno =
              pickFirstString(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto']) || codigo
            const unidade = pickFirstString(row, ['unidade_medida', 'UNIDADE', 'unidade', 'und']) || null

            found = {
              id: String(row.id ?? codigoInterno),
              codigo_interno: codigoInterno,
              descricao: descricao || 'Produto sem descrição',
              unidade_medida: unidade,
              data_fabricacao: row.data_fabricacao ?? null,
              data_validade: row.data_validade ?? null,
              ean: row.ean ?? null,
              dun: row.dun ?? null,
            }
            break
          }
        }
        if (found) break
      }

      if (!found && lastMeaningfulError) {
        setProduto(null)
        setProdutoError(`Erro ao buscar o produto: ${lastMeaningfulError.message ?? 'verifique o cadastro'}`)
      } else if (!found) {
        setProduto(null)
        setProdutoError('Código não encontrado no cadastro de produtos.')
      } else {
        setProduto(found)
      }

      setProdutoLoading(false)
    }, 500)

    return () => clearTimeout(handle)
  }, [codigoInterno, productByCode])

  const canSubmit = useMemo(() => {
    return (
      Boolean(conferenteId) &&
      codigoInterno.trim().length > 0 &&
      (descricaoInput.trim().length > 0 || Boolean(produto?.descricao)) &&
      !saving
    )
  }, [conferenteId, codigoInterno, descricaoInput, produto?.descricao, saving])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaveSuccess('')

    if (!conferenteId) {
      setSaveError('Selecione um conferente.')
      return
    }
    if (!codigoInterno.trim()) {
      setSaveError('Informe o código do produto.')
      return
    }
    const descricaoFinal = (descricaoInput.trim() || produto?.descricao || '').trim()
    if (!descricaoFinal) {
      setSaveError('Informe a descrição do produto.')
      return
    }

    const qtd = quantidadeContada.trim() === '' ? 0 : Number(quantidadeContada.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setSaveError('Quantidade contada inválida.')
      return
    }

    const loteValue = lote.trim() === '' ? null : lote.trim()
    const observacaoValue = observacao.trim() === '' ? null : observacao.trim()

    setSaving(true)
    const payload: Record<string, any> = {
      data_hora_contagem: toISOStringFromDatetimeLocal(dataHoraContagem),
      conferente_id: conferenteId,
      produto_id: isUuid(produto?.id) ? produto?.id : null,
      codigo_interno: codigoInterno.trim(),
      descricao: descricaoFinal,
      unidade_medida: produto?.unidade_medida ?? null,
      quantidade_up: qtd,
      lote: loteValue,
      observacao: observacaoValue,
    }

    if (dataFabricacao) payload.data_fabricacao = dataFabricacao
    if (dataVencimento) payload.data_validade = dataVencimento
    if (quantidadeUp.trim() !== '') payload.up = Number(quantidadeUp.replace(',', '.'))

    let { error } = await supabase.from('contagens_estoque').insert(payload)
    // Se o banco ainda não tiver as colunas, tenta salvar sem elas.
    if (error && String(error.code ?? '') === '42703') {
      delete payload.data_fabricacao
      delete payload.data_validade
      delete payload.up
      const retry = await supabase.from('contagens_estoque').insert(payload)
      error = retry.error
    }

    if (error) {
      setSaveError(`Erro ao salvar contagem: ${error.message}`)
      setSaveSuccess('')
    } else {
      // Envio opcional para Google Sheets (aba CONTAGEM DE ESTOQUE FISICA)
      // Não bloqueia o fluxo principal se o webhook estiver indisponível.
      if (sheetWebhookUrl) {
        try {
          const conferenteNome =
            conferentes.find((c) => c.id === conferenteId)?.nome ??
            conferenteId

          await fetch(sheetWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_hora_contagem: payload.data_hora_contagem,
              data_contagem: String(payload.data_hora_contagem).slice(0, 10),
              codigo_interno: payload.codigo_interno,
              descricao: payload.descricao,
              quantidade_contada: payload.quantidade_up,
              up: payload.up ?? null,
              lote: payload.lote ?? null,
              observacao: payload.observacao ?? null,
              conferente: conferenteNome,
              aba: 'CONTAGEM DE ESTOQUE FISICA',
            }),
          })
        } catch {
          // Sem throw para não impedir o salvamento no Supabase
        }
      }

      setSaveSuccess('Linha salva com sucesso.')
      setSaveError('')
      // Mantém código para facilitar batidas em sequência no mesmo produto.
      setLote('')
      setDataFabricacao('')
      setDataVencimento('')
      setObservacao('')
      setQuantidadeContada('')
      setQuantidadeUp('') // opcional: volta pra vazio; ao enviar, vira 0
      setCodigoInterno('')
      setDescricaoInput('')
      setProduto(null)
      await loadPreview()
    }
    setSaving(false)
  }

  async function loadPreview() {
    setPreviewLoading(true)
    const { data, error } = await supabase
      .from('contagens_estoque')
      .select('data_hora_contagem,codigo_interno,descricao,quantidade_up')
      .order('data_hora_contagem', { ascending: false })
      .limit(800)

    if (error) {
      setSaveError(`Erro ao carregar prévia: ${error.message}`)
    } else {
      const mapped = (data ?? []).map((r: any) => ({
        data_key: toLocalDateKey(String(r.data_hora_contagem ?? '')),
        codigo_interno: String(r.codigo_interno ?? ''),
        descricao: String(r.descricao ?? ''),
        quantidade_up: r.quantidade_up,
      })) as ContagemPreviewRow[]

      setPreviewRows(mapped)
    }
    setPreviewLoading(false)
  }

  useEffect(() => {
    // carrega uma primeira prévia
    loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const previewColumns = useMemo(() => {
    const seen = new Set<string>()
    const cols: string[] = []
    for (const r of previewRows) {
      if (!seen.has(r.data_key)) {
        seen.add(r.data_key)
        cols.push(r.data_key)
      }
      if (cols.length >= 6) break // mantém a tabela legível
    }
    return cols
  }, [previewRows])

  const previewRowMap = useMemo(() => {
    const map = new Map<string, { descricao: string; values: Record<string, number> }>()
    for (const r of previewRows) {
      const key = r.codigo_interno
      if (!map.has(key)) map.set(key, { descricao: r.descricao, values: {} })

      const v = typeof r.quantidade_up === 'number' ? r.quantidade_up : Number(String(r.quantidade_up))
      const add = Number.isFinite(v) ? v : 0
      const prev = map.get(key)!.values[r.data_key] ?? 0
      map.get(key)!.values[r.data_key] = prev + add
    }
    return map
  }, [previewRows])

  function renderPreviewTable() {
    const rows: Array<{ key: string; codigo: string; desc: string }> = []
    for (const [codigo, meta] of previewRowMap.entries()) {
      rows.push({ key: codigo, codigo, desc: meta.descricao })
    }
    rows.sort((a, b) => a.codigo.localeCompare(b.codigo))

    return (
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Descrição</th>
              {previewColumns.map((col) => (
                <th key={col} style={thStyle}>
                  {formatDateKey(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meta = previewRowMap.get(row.key)!
              return (
                <tr key={row.key}>
                  <td style={tdStyle}>{row.codigo}</td>
                  <td style={tdStyle}>{row.desc}</td>
                  {previewColumns.map((col) => (
                    <td key={col} style={tdStyle}>
                      {meta.values[col] ?? 0}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ padding: isMobile ? 10 : 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Contagem de Estoque</h2>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={labelStyle}>
            Data e hora do registro
            <input
              type="datetime-local"
              value={dataHoraContagem}
              onChange={(e) => {
                const dt = new Date(e.target.value)
                if (!Number.isNaN(dt.getTime())) {
                  setClockBaseMs(dt.getTime())
                  setClockRealStartMs(Date.now())
                }
              }}
              style={inputStyle}
            />
          </label>

          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 6' }}>
            Conferente
            <select
              value={conferenteId}
              onChange={(e) => setConferenteId(e.target.value)}
              style={inputStyle}
              disabled={conferentesLoading}
            >
              <option value="">Selecione...</option>
              {conferentes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 6', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={() => setShowAddConferente((v) => !v)}
              disabled={addingConferente}
              style={buttonStyle}
            >
              {showAddConferente ? 'Cancelar' : 'Cadastrar conferente'}
            </button>

            {showAddConferente ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
                  gap: 8,
                  alignItems: 'end',
                }}
              >
                <div style={labelStyle}>
                  Nome do conferente
                  <input
                    value={newConferenteNome}
                    onChange={(e) => setNewConferenteNome(e.target.value)}
                    style={inputStyle}
                    placeholder="Ex: João Silva"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const nome = newConferenteNome.trim()
                    if (!nome) return
                    setAddingConferente(true)
                    setSaveError('')

                    const { data, error } = await supabase
                      .from('conferentes')
                      .insert({ nome })
                      .select('id,nome')
                      .maybeSingle()

                    if (error) {
                      if (error.code === '42501' || String(error.message).toLowerCase().includes('row-level security')) {
                        setSaveError(
                          'Sem permissão para cadastrar conferente no banco. Rode o SQL de policy (RLS) no Supabase para liberar insert em conferentes.'
                        )
                      } else {
                        setSaveError(`Erro ao cadastrar conferente: ${error.message}`)
                      }
                    } else if (data?.id) {
                      setConferenteId(data.id)
                      setNewConferenteNome('')
                      setShowAddConferente(false)
                      // recarrega lista para consistência visual
                      const { data: list } = await supabase.from('conferentes').select('id,nome').order('nome')
                      setConferentes(list ?? [])
                    }

                    setAddingConferente(false)
                  }}
                  disabled={addingConferente}
                  style={buttonStyle}
                >
                  {addingConferente ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <label style={labelStyle}>
          Código do produto
          <select
            value={codigoInterno}
            onChange={(e) => {
              const v = e.target.value
              setCodigoInterno(v)
              const matched = applyProductByCode(v)
              if (!matched && produto && produto.codigo_interno !== v) {
                setProduto(null)
                setDescricaoInput('')
              }
            }}
            style={inputStyle}
            disabled={productOptionsLoading}
          >
            <option value="">
              {productOptionsLoading ? 'Carregando códigos...' : 'Selecione o código...'}
            </option>
            {productOptions.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: isMobile ? 'auto' : 'span 4' }}>
            <label style={labelStyle}>
              Descrição
              <select
                value={produto?.codigo_interno || ''}
                onChange={(e) => {
                  const code = e.target.value
                  setCodigoInterno(code)
                  if (code) {
                    applyProductByCode(code)
                  } else {
                    setDescricaoInput('')
                    setProduto(null)
                  }
                }}
                style={inputStyle}
                disabled={productOptionsLoading}
              >
                <option value="">
                  {productOptionsLoading ? 'Carregando descrições...' : 'Selecione a descrição...'}
                </option>
                {productOptions.map((p) => (
                  <option key={`desc-${p.codigo}`} value={p.codigo}>
                    {p.descricao}
                  </option>
                ))}
              </select>
            </label>
            {produtoError ? (
              <div style={{ color: '#b00020', fontSize: 13, marginTop: 6 }}>{produtoError}</div>
            ) : null}
            {produtoLoading ? (
              <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>Buscando descrição...</div>
            ) : null}
          </div>

          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 2' }}>
            Quantidade contada
            <input
              type="number"
              step="0.001"
              value={quantidadeContada}
              onChange={(e) => setQuantidadeContada(e.target.value)}
              style={inputStyle}
              placeholder="Digite a quantidade"
            />
          </label>

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 3' }}>
            <label style={labelStyle}>
              Data de fabricação
              <input
                type="date"
                value={dataFabricacao}
                onChange={(e) => setDataFabricacao(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ gridColumn: isMobile ? 'auto' : 'span 3' }}>
            <label style={labelStyle}>
              Data de vencimento
              <input
                type="date"
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 3' }}>
            UP
            <input
              type="number"
              step="0.001"
              value={quantidadeUp}
              onChange={(e) => setQuantidadeUp(e.target.value)}
              style={inputStyle}
              placeholder="Digite o UP"
            />
          </label>

          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 6' }}>
            Lote
            <input value={lote} onChange={(e) => setLote(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: isMobile ? 'auto' : 'span 8' }}>
            Observação
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <button type="submit" disabled={!canSubmit} style={buttonStyle}>
            {saving ? 'Salvando...' : 'Salvar linha'}
          </button>
          {saveError ? <div style={{ color: '#b00020' }}>{saveError}</div> : null}
          {saveSuccess ? <div style={{ color: '#0f7a0f' }}>{saveSuccess}</div> : null}
        </div>
      </form>

      <div style={{ marginTop: 26 }}>
        <h3>Prévia estilo planilha (cada data vira uma coluna)</h3>
        <div style={{ color: '#555', fontSize: 13, marginTop: 6 }}>
          Mostrando até as 6 últimas datas encontradas. Atualize após inserir linhas.
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
          <button
            type="button"
            onClick={() => loadPreview()}
            disabled={previewLoading}
            style={buttonStyle}
          >
            {previewLoading ? 'Atualizando...' : 'Atualizar prévia'}
          </button>
        </div>
        {previewRows.length ? renderPreviewTable() : <div style={{ marginTop: 10 }}>Sem dados ainda.</div>}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
}

const inputStyle: React.CSSProperties = {
  padding: '10px 10px',
  border: '1px solid #ccc',
  borderRadius: 8,
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #222',
  background: '#111',
  color: 'white',
  cursor: 'pointer',
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

