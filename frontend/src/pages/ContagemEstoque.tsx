import { useEffect, useMemo, useRef, useState } from 'react'
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
  id: string
  data_hora_contagem: string
  codigo_interno: string
  descricao: string
  quantidade_up: number
  lote: string | null
  observacao: string | null
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

function formatDateBRFromIso(isoLike: string) {
  const dt = new Date(isoLike)
  if (Number.isNaN(dt.getTime())) return isoLike
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`
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
  /** datalist HTML não abre a lista ao clicar na seta; usamos lista própria */
  const [codigoListOpen, setCodigoListOpen] = useState(false)
  const [descricaoListOpen, setDescricaoListOpen] = useState(false)
  const codigoWrapRef = useRef<HTMLDivElement>(null)
  const descricaoWrapRef = useRef<HTMLDivElement>(null)

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

  const productByDescricao = useMemo(() => {
    const map = new Map<string, ProductOption>()
    for (const p of productOptions) map.set(p.descricao.trim().toLowerCase(), p)
    return map
  }, [productOptions])

  const SUGGEST_LIMIT = 400
  const codigoSuggestions = useMemo(() => {
    const q = codigoInterno.trim().toLowerCase()
    const list = q
      ? productOptions.filter((p) => p.codigo.toLowerCase().includes(q))
      : productOptions
    return list.slice(0, SUGGEST_LIMIT)
  }, [productOptions, codigoInterno])

  const descricaoSuggestions = useMemo(() => {
    const q = descricaoInput.trim().toLowerCase()
    const list = q
      ? productOptions.filter((p) => p.descricao.toLowerCase().includes(q))
      : productOptions
    return list.slice(0, SUGGEST_LIMIT)
  }, [productOptions, descricaoInput])

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      const t = ev.target as Node
      if (codigoWrapRef.current && !codigoWrapRef.current.contains(t)) setCodigoListOpen(false)
      if (descricaoWrapRef.current && !descricaoWrapRef.current.contains(t)) setDescricaoListOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

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
    const datasOk = (() => {
      if (!dataFabricacao || !dataVencimento) return true
      // Formato do input é YYYY-MM-DD, então comparação lexicográfica funciona como data.
      return dataVencimento >= dataFabricacao
    })()

    return (
      Boolean(conferenteId) &&
      codigoInterno.trim().length > 0 &&
      (descricaoInput.trim().length > 0 || Boolean(produto?.descricao)) &&
      datasOk &&
      !saving
    )
  }, [conferenteId, codigoInterno, descricaoInput, produto?.descricao, saving, dataFabricacao, dataVencimento])

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

    if (dataFabricacao && dataVencimento && dataVencimento < dataFabricacao) {
      setSaveError('Data de vencimento não pode ser menor que a data de fabricação.')
      return
    }

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

    const dataContagemKey = String(payload.data_hora_contagem).slice(0, 10) // YYYY-MM-DD

    // Regra: ao salvar no mesmo dia com mesmo codigo_interno + descricao, somar quantidade e manter uma única linha.
    // (Assim a prévia e o Sheet ficam agregados.)
    let saveError: any = null
    const { data: existentes, error: existentesError } = await supabase
      .from('contagens_estoque')
      .select('id,quantidade_up,lote,observacao')
      .eq('data_contagem', dataContagemKey)
      .eq('codigo_interno', payload.codigo_interno)
      .eq('descricao', payload.descricao)

    if (existentesError) {
      saveError = existentesError
    } else if (existentes && existentes.length > 0) {
      const qtdExistente = existentes.reduce((acc: number, r: any) => acc + Number(r.quantidade_up ?? 0), 0)
      const totalQtd = qtdExistente + qtd

      const updateFields: Record<string, any> = { quantidade_up: totalQtd }
      if (loteValue !== null) updateFields.lote = loteValue
      if (observacaoValue !== null) updateFields.observacao = observacaoValue

      // Para a planilha, mantém lote/obs anteriores se o usuário não preencheu na nova entrada.
      if (loteValue === null) payload.lote = existentes[0].lote ?? null
      if (observacaoValue === null) payload.observacao = existentes[0].observacao ?? null

      const firstId = existentes[0].id

      const { error: updError } = await supabase.from('contagens_estoque').update(updateFields).eq('id', firstId)
      if (updError) saveError = updError
      else {
        const otherIds = existentes.slice(1).map((r: any) => r.id)
        if (otherIds.length) {
          const { error: delError } = await supabase.from('contagens_estoque').delete().in('id', otherIds)
          if (delError) saveError = delError
        }
      }

      if (!saveError) {
        payload.quantidade_up = totalQtd
      }
    } else {
      let { error } = await supabase.from('contagens_estoque').insert(payload)
      // Se o banco ainda não tiver as colunas, tenta salvar sem elas.
      if (error && String(error.code ?? '') === '42703') {
        delete payload.data_fabricacao
        delete payload.data_validade
        delete payload.up
        const retry = await supabase.from('contagens_estoque').insert(payload)
        error = retry.error
      }
      if (error) saveError = error
    }

    if (saveError) {
      setSaveError(`Erro ao salvar contagem: ${saveError.message ?? String(saveError)}`)
      setSaveSuccess('')
    } else {
      setSaveSuccess(
        sheetWebhookUrl
          ? 'Linha salva com sucesso. Enviando para a planilha…'
          : 'Linha salva com sucesso. (Para Google Sheets: defina VITE_SHEET_WEBHOOK_URL no Render e faça um novo deploy.)',
      )
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

      // Envio opcional para Google Sheets (não bloqueia a ação principal).
      if (sheetWebhookUrl) {
        const conferenteNome = conferentes.find((c) => c.id === conferenteId)?.nome ?? conferenteId
        sendToSheetInBackground(sheetWebhookUrl, {
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
        }).then((ok) => {
          if (!ok) {
            setSaveError('Salvei no banco, mas falhou o envio para o Sheet (webhook). Verifique a URL /exec e o Apps Script.')
          }
        })
      }
    }
    setSaving(false)
  }

  async function loadPreview() {
    setPreviewLoading(true)
    const pad = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const startIso = `${dayKey}T00:00:00`
    const endIso = `${dayKey}T23:59:59`

    const { data, error } = await supabase
      .from('contagens_estoque')
      .select('id,data_hora_contagem,codigo_interno,descricao,quantidade_up,lote,observacao')
      .gte('data_hora_contagem', startIso)
      .lte('data_hora_contagem', endIso)
      .order('data_hora_contagem', { ascending: false })
      .limit(2000)

    if (error) {
      setSaveError(`Erro ao carregar prévia: ${error.message}`)
    } else {
      const mapped = (data ?? []).map((r: any) => ({
        id: String(r.id),
        data_hora_contagem: String(r.data_hora_contagem ?? ''),
        codigo_interno: String(r.codigo_interno ?? ''),
        descricao: String(r.descricao ?? ''),
        quantidade_up: Number(r.quantidade_up ?? 0),
        lote: r.lote ?? null,
        observacao: r.observacao ?? null,
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

  const [editingPreviewId, setEditingPreviewId] = useState<string | null>(null)
  const [editingPreviewQuantidade, setEditingPreviewQuantidade] = useState<string>('')
  const [previewRowActionLoading, setPreviewRowActionLoading] = useState(false)
  const [previewRowError, setPreviewRowError] = useState('')
  const [previewFilterCodigo, setPreviewFilterCodigo] = useState('')
  const [previewFilterDescricao, setPreviewFilterDescricao] = useState('')
  const [previewFilterData, setPreviewFilterData] = useState('')
  const [previewFilterLote, setPreviewFilterLote] = useState('')
  const [previewFilterObs, setPreviewFilterObs] = useState('')

  async function handlePreviewDelete(id: string) {
    if (!confirm('Deseja realmente excluir esta contagem?')) return
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const row = previewRows.find((r) => r.id === id)
      const { error } = await supabase.from('contagens_estoque').delete().eq('id', id)
      if (error) throw error

      // Planilha: ao excluir, limpar apenas a quantidade (não remover a linha).
      if (sheetWebhookUrl && row) {
        const dataContagem = String(row.data_hora_contagem).slice(0, 10)
        void sendToSheetInBackground(sheetWebhookUrl, {
          tipo: 'clear_qty',
          data_hora_contagem: row.data_hora_contagem,
          data_contagem: dataContagem,
          codigo_interno: row.codigo_interno,
          descricao: row.descricao,
          aba: 'CONTAGEM DE ESTOQUE FISICA',
        })
      }

      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')
      await loadPreview()
    } catch (e: any) {
      setPreviewRowError(`Erro ao excluir: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function handlePreviewSave(id: string) {
    const qtd = Number(editingPreviewQuantidade.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setPreviewRowError('Quantidade inválida para atualização.')
      return
    }
    setPreviewRowError('')
    setPreviewRowActionLoading(true)
    try {
      const row = previewRows.find((r) => r.id === id)
      const { error } = await supabase.from('contagens_estoque').update({ quantidade_up: qtd }).eq('id', id)
      if (error) throw error
      setEditingPreviewId(null)
      setEditingPreviewQuantidade('')

      // Planilha: ao editar, atualizar a quantidade na linha já existente.
      if (sheetWebhookUrl && row) {
        const dataContagem = String(row.data_hora_contagem).slice(0, 10)
        void sendToSheetInBackground(sheetWebhookUrl, {
          tipo: 'edit_qty',
          data_hora_contagem: row.data_hora_contagem,
          data_contagem: dataContagem,
          codigo_interno: row.codigo_interno,
          descricao: row.descricao,
          quantidade_contada: qtd,
          aba: 'CONTAGEM DE ESTOQUE FISICA',
        })
      }

      await loadPreview()
    } catch (e: any) {
      setPreviewRowError(`Erro ao atualizar quantidade: ${e?.message ? String(e.message) : 'verifique'}`)
    } finally {
      setPreviewRowActionLoading(false)
    }
  }

  async function sendToSheetInBackground(webhookUrl: string, body: Record<string, any>): Promise<boolean> {
    const json = JSON.stringify(body)
    // Google Apps Script Web App: application/json dispara preflight CORS que costuma falhar
    // (o navegador cancela o POST antes de chegar ao doPost). text/plain evita o preflight.
    const plainHeaders = { 'Content-Type': 'text/plain;charset=utf-8' }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(webhookUrl.trim(), {
        method: 'POST',
        headers: plainHeaders,
        body: json,
        signal: controller.signal,
        credentials: 'omit',
      })
      clearTimeout(timeout)
      // Ajuda a diagnosticar no DevTools (aba Network); resposta pode ser opaca em alguns casos.
      if (import.meta.env.DEV && !res.ok) {
        console.warn('[Sheets webhook]', res.status, res.statusText)
      }
      return !!res.ok
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[Sheets webhook] fetch falhou, tentando no-cors:', err)
      try {
        await fetch(webhookUrl.trim(), {
          method: 'POST',
          mode: 'no-cors',
          body: json,
          credentials: 'omit',
        })
        return true
      } catch {
        // silencioso: planilha é opcional
        return false
      }
    }
  }

  function renderPreviewTable() {
    const filteredRows = previewRows.filter((r) => {
      const codigoOk =
        !previewFilterCodigo.trim() || r.codigo_interno.toLowerCase().includes(previewFilterCodigo.trim().toLowerCase())
      const descricaoOk =
        !previewFilterDescricao.trim() ||
        r.descricao.toLowerCase().includes(previewFilterDescricao.trim().toLowerCase())
      const dataOk = !previewFilterData || String(r.data_hora_contagem).slice(0, 10) === previewFilterData
      const loteOk =
        !previewFilterLote.trim() || String(r.lote ?? '').toLowerCase().includes(previewFilterLote.trim().toLowerCase())
      const obsOk =
        !previewFilterObs.trim() || String(r.observacao ?? '').toLowerCase().includes(previewFilterObs.trim().toLowerCase())
      return codigoOk && descricaoOk && dataOk && loteOk && obsOk
    })

    return (
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        {previewRowError ? <div style={{ color: '#b00020', marginBottom: 8 }}>{previewRowError}</div> : null}
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, whiteSpace: 'normal' }}>
                Código
                <input
                  value={previewFilterCodigo}
                  onChange={(e) => setPreviewFilterCodigo(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, whiteSpace: 'normal' }}>
                Descrição
                <input
                  value={previewFilterDescricao}
                  onChange={(e) => setPreviewFilterDescricao(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, whiteSpace: 'normal' }}>
                Data (dd/mm/aaaa)
                <input
                  type="date"
                  value={previewFilterData}
                  onChange={(e) => setPreviewFilterData(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={thStyle}>Qtd (up)</th>
              <th style={{ ...thStyle, whiteSpace: 'normal' }}>
                Lote
                <input
                  value={previewFilterLote}
                  onChange={(e) => setPreviewFilterLote(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={{ ...thStyle, whiteSpace: 'normal' }}>
                Obs
                <input
                  value={previewFilterObs}
                  onChange={(e) => setPreviewFilterObs(e.target.value)}
                  placeholder="filtrar"
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, width: '100%' }}
                />
              </th>
              <th style={thStyle}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              return (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.codigo_interno}</td>
                  <td style={tdStyle}>{r.descricao}</td>
                  <td style={tdStyle}>{formatDateBRFromIso(r.data_hora_contagem)}</td>
                  <td style={tdStyle}>
                    {editingPreviewId === r.id ? (
                      <input
                        type="number"
                        step="0.001"
                        value={editingPreviewQuantidade}
                        onChange={(e) => setEditingPreviewQuantidade(e.target.value)}
                        style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 8, width: 120 }}
                      />
                    ) : (
                      r.quantidade_up
                    )}
                  </td>
                  <td style={tdStyle}>{r.lote ?? ''}</td>
                  <td style={tdStyle}>{r.observacao ?? ''}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {editingPreviewId === r.id ? (
                        <>
                          <button
                            type="button"
                            style={buttonStyle}
                            onClick={() => handlePreviewSave(r.id)}
                            disabled={previewRowActionLoading}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#444' }}
                            onClick={() => {
                              setEditingPreviewId(null)
                              setEditingPreviewQuantidade('')
                              setPreviewRowError('')
                            }}
                            disabled={previewRowActionLoading}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            style={buttonStyle}
                            onClick={() => {
                              setEditingPreviewId(r.id)
                              setEditingPreviewQuantidade(String(r.quantidade_up))
                              setPreviewRowError('')
                            }}
                            disabled={previewRowActionLoading}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#8a0000' }}
                            onClick={() => handlePreviewDelete(r.id)}
                            disabled={previewRowActionLoading}
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
          <div ref={codigoWrapRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
              <input
                value={codigoInterno}
                onChange={(e) => {
                  const v = e.target.value
                  setCodigoInterno(v)
                  const matched = applyProductByCode(v.trim())
                  if (!matched && produto && produto.codigo_interno !== v) {
                    setProduto(null)
                  }
                }}
                onBlur={() => {
                  const code = codigoInterno.trim()
                  const matched = applyProductByCode(code)
                  if (!matched && !descricaoInput.trim()) {
                    setProduto(null)
                  }
                }}
                onFocus={() => setCodigoListOpen(true)}
                style={{
                  ...inputStyle,
                  flex: 1,
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  borderRight: 'none',
                }}
                disabled={productOptionsLoading}
                placeholder={productOptionsLoading ? 'Carregando códigos...' : 'Digite o código...'}
              />
              <button
                type="button"
                aria-label="Abrir lista de códigos"
                aria-expanded={codigoListOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCodigoListOpen((o) => !o)}
                disabled={productOptionsLoading}
                style={{
                  padding: '0 12px',
                  border: '1px solid var(--border, #ccc)',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  borderTopRightRadius: 8,
                  borderBottomRightRadius: 8,
                  background: 'var(--code-bg, #f4f3ec)',
                  color: 'var(--text-h, #111)',
                  cursor: productOptionsLoading ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ▼
              </button>
            </div>
            {codigoListOpen ? (
              <ul
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 4px)',
                  margin: 0,
                  width: '100%',
                  padding: 4,
                  listStyle: 'none',
                  maxHeight: 260,
                  overflowY: 'auto',
                  background: 'var(--code-bg, #fff)',
                  border: '1px solid var(--border, #ccc)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow, 0 4px 12px rgba(0,0,0,.12))',
                  zIndex: 9999,
                }}
              >
                {productOptionsLoading ? (
                  <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>Carregando...</li>
                ) : codigoSuggestions.length === 0 ? (
                  <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>
                    {productOptions.length === 0
                      ? 'Nenhum produto carregado (confira a tabela e RLS no Supabase).'
                      : 'Nenhum código encontrado para o que você digitou.'}
                  </li>
                ) : (
                  codigoSuggestions.map((p) => (
                    <li
                      key={p.codigo}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCodigoInterno(p.codigo)
                        applyProductByCode(p.codigo)
                        setCodigoListOpen(false)
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        color: 'var(--text-h, #111)',
                        fontSize: 14,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--accent-bg, rgba(170,59,255,.1))'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <strong>{p.codigo}</strong>
                      <span style={{ color: 'var(--text, #666)', marginLeft: 8, fontWeight: 400 }}>
                        {p.descricao}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: isMobile ? 'auto' : 'span 4' }}>
            <label style={labelStyle}>
              Descrição
              <div ref={descricaoWrapRef} style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
                  <input
                    value={descricaoInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setDescricaoInput(v)
                      const match = productByDescricao.get(v.trim().toLowerCase())
                      if (match) {
                        setCodigoInterno(match.codigo)
                        applyProductByCode(match.codigo)
                      }
                    }}
                    onBlur={() => {
                      const match = productByDescricao.get(descricaoInput.trim().toLowerCase())
                      if (match) {
                        setCodigoInterno(match.codigo)
                        applyProductByCode(match.codigo)
                      }
                    }}
                    onFocus={() => setDescricaoListOpen(true)}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderRight: 'none',
                    }}
                    disabled={productOptionsLoading}
                    placeholder={productOptionsLoading ? 'Carregando descrições...' : 'Digite a descrição...'}
                  />
                  <button
                    type="button"
                    aria-label="Abrir lista de descrições"
                    aria-expanded={descricaoListOpen}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setDescricaoListOpen((o) => !o)}
                    disabled={productOptionsLoading}
                    style={{
                      padding: '0 12px',
                      border: '1px solid var(--border, #ccc)',
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      borderTopRightRadius: 8,
                      borderBottomRightRadius: 8,
                      background: 'var(--code-bg, #f4f3ec)',
                      color: 'var(--text-h, #111)',
                      cursor: productOptionsLoading ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ▼
                  </button>
                </div>
                {descricaoListOpen ? (
                  <ul
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 'calc(100% + 4px)',
                      margin: 0,
                      width: '100%',
                      padding: 4,
                      listStyle: 'none',
                      maxHeight: 260,
                      overflowY: 'auto',
                      background: 'var(--code-bg, #fff)',
                      border: '1px solid var(--border, #ccc)',
                      borderRadius: 8,
                      boxShadow: 'var(--shadow, 0 4px 12px rgba(0,0,0,.12))',
                      zIndex: 9999,
                    }}
                  >
                    {productOptionsLoading ? (
                      <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>Carregando...</li>
                    ) : descricaoSuggestions.length === 0 ? (
                      <li style={{ padding: 8, color: 'var(--text, #666)', fontSize: 14 }}>
                        {productOptions.length === 0
                          ? 'Nenhum produto carregado (confira a tabela e RLS no Supabase).'
                          : 'Nenhuma descrição encontrada para o que você digitou.'}
                      </li>
                    ) : (
                      descricaoSuggestions.map((p) => (
                        <li
                          key={`sug-desc-${p.codigo}`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setDescricaoInput(p.descricao)
                            setCodigoInterno(p.codigo)
                            applyProductByCode(p.codigo)
                            setDescricaoListOpen(false)
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            color: 'var(--text-h, #111)',
                            fontSize: 14,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent-bg, rgba(170,59,255,.1))'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <span style={{ color: 'var(--text, #666)', marginRight: 8, fontWeight: 600 }}>
                            {p.codigo}
                          </span>
                          {p.descricao}
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
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

