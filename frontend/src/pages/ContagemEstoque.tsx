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
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
}

type ContagemPreviewRow = {
  // Data apenas (formato YYYY-MM-DD) para virar colunas tipo planilha
  data_key: string
  codigo_interno: string
  descricao: string
  quantidade_up: string | number
}

function formatDateKey(dateKey: string) {
  // YYYY-MM-DD -> DD/MM/YYYY
  const [y, m, d] = dateKey.split('-')
  if (!y || !m || !d) return dateKey
  return `${d}/${m}/${y}`
}

export default function ContagemEstoque() {
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)

  const [dataHoraContagem, setDataHoraContagem] = useState(() => toDatetimeLocalValue(new Date()))
  const [conferenteId, setConferenteId] = useState<string>('')

  const [codigoInterno, setCodigoInterno] = useState('')
  const [produto, setProduto] = useState<Produto | null>(null)
  const [produtoLoading, setProdutoLoading] = useState(false)
  const [produtoError, setProdutoError] = useState<string>('')

  const [lote, setLote] = useState('')
  const [quantidadeUp, setQuantidadeUp] = useState<string>('') // string p/ permitir vazio no input
  const [observacao, setObservacao] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>('')
  const [saveSuccess, setSaveSuccess] = useState<string>('')

  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRows, setPreviewRows] = useState<ContagemPreviewRow[]>([])

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
      // Aceita qualquer um: `codigo_interno`, `ean` ou `dun`.
      const baseSelect =
        'id,codigo_interno,descricao,unidade_medida,data_fabricacao,data_validade,ean,dun'

      // 1) Tenta por código interno
      const r1 = await supabase
        .from('produtos')
        .select(baseSelect)
        .eq('codigo_interno', codigo)
        .maybeSingle()

      // 2) Se não achar, tenta por EAN
      const r2 =
        !r1.data
          ? await supabase.from('produtos').select(baseSelect).eq('ean', codigo).maybeSingle()
          : { data: null as any, error: null as any }

      // 3) Se não achar, tenta por DUN
      const r3 =
        !r1.data && !r2.data
          ? await supabase.from('produtos').select(baseSelect).eq('dun', codigo).maybeSingle()
          : { data: null as any, error: null as any }

      const erro = r1.error ?? r2.error ?? r3.error
      const data = (r1.data ?? r2.data ?? r3.data) as Produto | null

      if (erro) {
        setProduto(null)
        setProdutoError('Erro ao buscar o produto.')
      } else if (!data) {
        setProduto(null)
        setProdutoError('Código não encontrado no cadastro de produtos.')
      } else {
        setProduto(data)
      }

      setProdutoLoading(false)
    }, 500)

    return () => clearTimeout(handle)
  }, [codigoInterno])

  const canSubmit = useMemo(() => {
    return Boolean(conferenteId) && Boolean(produto) && codigoInterno.trim().length > 0 && !saving
  }, [conferenteId, produto, codigoInterno, saving])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaveSuccess('')

    if (!produto) {
      setSaveError('Informe um código de produto válido (precisa existir na tabela `produtos`).')
      return
    }
    if (!conferenteId) {
      setSaveError('Selecione um conferente.')
      return
    }

    const qtd = quantidadeUp.trim() === '' ? 0 : Number(quantidadeUp.replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd < 0) {
      setSaveError('Quantidade (up) inválida.')
      return
    }

    const loteValue = lote.trim() === '' ? null : lote.trim()
    const observacaoValue = observacao.trim() === '' ? null : observacao.trim()

    setSaving(true)
    const { error } = await supabase.from('contagens_estoque').insert({
      data_hora_contagem: toISOStringFromDatetimeLocal(dataHoraContagem),
      conferente_id: conferenteId,
      produto_id: produto.id,
      codigo_interno: codigoInterno.trim(),
      descricao: produto.descricao,
      unidade_medida: produto.unidade_medida,
      data_fabricacao: produto.data_fabricacao,
      data_validade: produto.data_validade,
      ean: produto.ean,
      dun: produto.dun,
      quantidade_up: qtd,
      lote: loteValue,
      observacao: observacaoValue,
    })

    if (error) {
      setSaveError(`Erro ao salvar contagem: ${error.message}`)
      setSaveSuccess('')
    } else {
      setSaveSuccess('Linha salva com sucesso.')
      setSaveError('')
      // Mantém código para facilitar batidas em sequência no mesmo produto.
      setLote('')
      setObservacao('')
      setQuantidadeUp('') // opcional: volta pra vazio; ao enviar, vira 0
      await loadPreview()
    }
    setSaving(false)
  }

  async function loadPreview() {
    setPreviewLoading(true)
    const { data, error } = await supabase
      .from('contagens_estoque')
      .select('data_contagem,codigo_interno,descricao,quantidade_up')
      .order('data_hora_contagem', { ascending: false })
      .limit(800)

    if (error) {
      setSaveError(`Erro ao carregar prévia: ${error.message}`)
    } else {
      const mapped = (data ?? []).map((r: any) => ({
        data_key: String(r.data_contagem ?? 'invalid-date'),
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
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Contagem de Estoque</h2>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 12 }}>
          <label style={labelStyle}>
            Data e hora do registro
            <input
              type="datetime-local"
              value={dataHoraContagem}
              onChange={(e) => setDataHoraContagem(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ ...labelStyle, gridColumn: 'span 6' }}>
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
        </div>

        <label style={labelStyle}>
          Código do produto
          <input
            value={codigoInterno}
            onChange={(e) => setCodigoInterno(e.target.value)}
            placeholder="Ex: 12345"
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: 'span 7' }}>
            <label style={labelStyle}>
              Descrição
              <input value={produto?.descricao ?? ''} disabled={true} style={inputStyle} />
            </label>
            {produtoError ? (
              <div style={{ color: '#b00020', fontSize: 13, marginTop: 6 }}>{produtoError}</div>
            ) : null}
            {produtoLoading ? (
              <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>Buscando descrição...</div>
            ) : null}
          </div>

          <div style={{ gridColumn: 'span 5' }}>
            <label style={labelStyle}>
              Lote
              <input value={lote} onChange={(e) => setLote(e.target.value)} style={inputStyle} />
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 12 }}>
          <label style={{ ...labelStyle, gridColumn: 'span 4' }}>
            Quantidade (up)
            <input
              type="number"
              step="0.001"
              value={quantidadeUp}
              onChange={(e) => setQuantidadeUp(e.target.value)}
              style={inputStyle}
              disabled={!produto}
              placeholder="0"
              required={Boolean(produto)}
            />
          </label>

          <label style={{ ...labelStyle, gridColumn: 'span 8' }}>
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

