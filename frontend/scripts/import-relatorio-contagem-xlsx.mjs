/**
 * Importa Excel exportado pelo relatório (aba "Contagens") para contagens_estoque + inventario_planilha_linhas.
 *
 * Uso (PowerShell, na pasta frontend):
 *   $env:VITE_SUPABASE_URL="https://xxx.supabase.co"
 *   $env:VITE_SUPABASE_ANON_KEY="eyJ..."
 *   node scripts/import-relatorio-contagem-xlsx.mjs "C:\Users\...\relatorio-contagem_Dia-_28-03-2026.xlsx" --data 2026-03-28
 *
 * --data YYYY-MM-DD = data_contagem (obrigatório se não estiver no nome do arquivo)
 */

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'

const INVENTARIO_ARMAZEM_ABA_TITULOS = {
  1: 'CAMARA 11 - RUA V',
  2: 'CAMARA 11 - RUA U',
  3: 'CAMARA 12 - RUA X',
  4: 'CAMARA 12 - RUA Y',
  5: 'CAMARA 13 - RUA W',
  6: 'CAMARA 13 - RUA Z',
  7: 'CAMARA 21 - RUA A',
  8: 'CAMARA 21 - RUA B',
}
const RUA_BY_GRUPO = { 1: 'V', 2: 'U', 3: 'X', 4: 'Y', 5: 'W', 6: 'Z', 7: 'A', 8: 'B' }

function grupoFromCamaraRua(camara, rua) {
  const c = String(camara ?? '').trim().toUpperCase()
  const r = String(rua ?? '').trim().toUpperCase()
  for (let g = 1; g <= 8; g++) {
    const title = INVENTARIO_ARMAZEM_ABA_TITULOS[g]
    if (!title) continue
    const camaraPart = title.split(' - ')[0].trim().toUpperCase()
    if (camaraPart === c && RUA_BY_GRUPO[g] === r) return g
  }
  return null
}

function parseRodada(contagemCell) {
  const s = String(contagemCell ?? '')
  const m = s.match(/(\d+)\s*°?\s*CONTAGEM/i)
  if (m) return Math.min(4, Math.max(1, Number(m[1])))
  const n = Number.parseInt(s, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 4) return n
  return 1
}

function parseDateBR(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  const y = m[3]
  return `${y}-${mo}-${d}`
}

function ymdFromFilename(name) {
  const m = String(name).match(/(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function isMissingInventarioColError(e) {
  const msg = String(e?.message ?? e ?? '')
    .toLowerCase()
  const code = String(e?.code ?? '')
  if (code === '42703') return true
  return (
    msg.includes('origem') ||
    msg.includes('inventario_repeticao') ||
    msg.includes('inventario_numero_contagem') ||
    msg.includes('schema cache')
  )
}

function loadEnv() {
  let url = process.env.VITE_SUPABASE_URL
  let key = process.env.VITE_SUPABASE_ANON_KEY
  const tryPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
  ]
  for (const p of tryPaths) {
    try {
      const raw = fs.readFileSync(p, 'utf8')
      for (const line of raw.split('\n')) {
        const u = line.match(/^VITE_SUPABASE_URL=(.*)$/)
        const k = line.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/)
        if (u) url = u[1].trim().replace(/^["']|["']$/g, '')
        if (k) key = k[1].trim().replace(/^["']|["']$/g, '')
      }
    } catch {
      /* ignore */
    }
  }
  return { url, key }
}

async function main() {
  const args = process.argv.slice(2)
  let filePath = args.find((a) => !a.startsWith('--'))
  let dataYmd = null
  const di = args.indexOf('--data')
  if (di >= 0 && args[di + 1]) dataYmd = args[di + 1]

  if (!filePath) {
    console.error('Uso: node scripts/import-relatorio-contagem-xlsx.mjs <arquivo.xlsx> [--data YYYY-MM-DD]')
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error('Arquivo não encontrado:', filePath)
    process.exit(1)
  }

  if (!dataYmd) dataYmd = ymdFromFilename(path.basename(filePath))
  if (!dataYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dataYmd)) {
    console.error('Defina a data com --data YYYY-MM-DD (ex.: --data 2026-03-28)')
    process.exit(1)
  }

  const { url, key } = loadEnv()
  if (!url || !key) {
    console.error(
      'Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente ou em frontend/.env',
    )
    process.exit(1)
  }

  const supabase = createClient(url, key)

  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (rows.length < 2) {
    console.error('Planilha vazia.')
    process.exit(1)
  }

  const header = rows[0].map((h) => String(h).trim())
  const idx = (name) => header.findIndex((h) => h === name)

  const iCam = idx('Câmara')
  const iRua = idx('Rua')
  const iPos = idx('POS')
  const iNiv = idx('Nível')
  const iCont = idx('Contagem')
  const iConf = idx('Conferente')
  const iCod = idx('Código do produto')
  const iDesc = idx('Descrição')
  const iUnd = idx('Unidade de medida')
  const iQtd = idx('Quantidade contada')
  const iFab = idx('Data de fabricação')
  const iVen = idx('Data de vencimento')
  const iLote = idx('Lote')
  const iUp = idx('UP')
  const iObs = idx('Observação')
  const iEan = idx('EAN')
  const iDun = idx('DUN')

  if (iCod < 0 || iQtd < 0 || iConf < 0) {
    console.error('Cabeçalho inválido: precisa Conferente, Código do produto, Quantidade contada.')
    process.exit(1)
  }

  const { data: confRows, error: confErr } = await supabase.from('conferentes').select('id,nome')
  if (confErr) throw confErr
  const confByNome = new Map(
    (confRows ?? []).map((r) => [String(r.nome ?? '').trim().toLowerCase(), String(r.id)]),
  )

  const dataHoraIso = new Date(`${dataYmd}T12:00:00`).toISOString()

  const payloads = []
  const planilhaMeta = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const nomeConf = String(row[iConf] ?? '').trim()
    if (!nomeConf) continue

    const conferente_id = confByNome.get(nomeConf.toLowerCase())
    if (!conferente_id) {
      throw new Error(`Conferente não encontrado no banco: "${nomeConf}". Cadastre em conferentes.`)
    }

    const codigo_interno = String(row[iCod] ?? '').trim()
    const qtdRaw = row[iQtd]
    const q = Number(String(qtdRaw).replace(',', '.'))
    if (!codigo_interno || !Number.isFinite(q) || q < 0) continue

    const grupo = grupoFromCamaraRua(row[iCam], row[iRua])
    if (grupo == null) {
      console.warn(`Linha ${r + 1}: não mapeou grupo para Câmara="${row[iCam]}" Rua="${row[iRua]}" — pulando planilha.`)
    }

    const numeroRodada = parseRodada(row[iCont])
    const df = iFab >= 0 ? parseDateBR(row[iFab]) : null
    const dv = iVen >= 0 ? parseDateBR(row[iVen]) : null
    const upRaw = iUp >= 0 ? String(row[iUp] ?? '').trim() : ''
    let up_adicional = null
    if (upRaw !== '') {
      const u = Number(upRaw.replace(',', '.'))
      if (Number.isFinite(u) && u >= 0) up_adicional = u
    }

    const payload = {
      data_contagem: dataYmd,
      data_hora_contagem: dataHoraIso,
      conferente_id,
      produto_id: null,
      codigo_interno,
      descricao: iDesc >= 0 ? String(row[iDesc] ?? '').trim() : '',
      unidade_medida: iUnd >= 0 ? String(row[iUnd] ?? '').trim() || null : null,
      quantidade_up: q,
      up_adicional,
      lote: iLote >= 0 ? String(row[iLote] ?? '').trim() || null : null,
      observacao: iObs >= 0 ? String(row[iObs] ?? '').trim() || null : null,
      data_fabricacao: df,
      data_validade: dv,
      ean: iEan >= 0 ? String(row[iEan] ?? '').trim() || null : null,
      dun: iDun >= 0 ? String(row[iDun] ?? '').trim() || null : null,
      foto_base64: null,
      origem: 'inventario',
      inventario_repeticao: null,
      inventario_numero_contagem: numeroRodada,
    }

    payloads.push(payload)
    planilhaMeta.push({
      grupo,
      rua: String(row[iRua] ?? '').trim() || (RUA_BY_GRUPO[grupo] ?? ''),
      posicao: iPos >= 0 ? Number(row[iPos]) || 0 : 0,
      nivel: iNiv >= 0 ? Number(row[iNiv]) || 0 : 0,
      numero_contagem: numeroRodada,
    })
  }

  if (payloads.length === 0) {
    console.error('Nenhuma linha válida para importar.')
    process.exit(1)
  }

  console.log(`Importando ${payloads.length} linhas em contagens_estoque (data_contagem=${dataYmd})...`)

  const CHUNK = 200
  const allIds = []

  for (let i = 0; i < payloads.length; i += CHUNK) {
    const chunk = payloads.slice(i, i + CHUNK)
    let { data: inserted, error: insErr } = await supabase.from('contagens_estoque').insert(chunk).select('id')
    if (insErr && isMissingInventarioColError(insErr)) {
      const stripped = chunk.map((r) => {
        const x = { ...r }
        delete x.origem
        delete x.inventario_repeticao
        delete x.inventario_numero_contagem
        return x
      })
      const res = await supabase.from('contagens_estoque').insert(stripped).select('id')
      inserted = res.data
      insErr = res.error
    }
    if (insErr) throw insErr
    for (const row of inserted ?? []) {
      if (row?.id) allIds.push(String(row.id))
    }
  }

  if (allIds.length !== payloads.length) {
    throw new Error(
      `Inserção incompleta: esperado ${payloads.length} ids, veio ${allIds.length}. Verifique RLS SELECT após INSERT.`,
    )
  }

  const planilhaRows = []
  for (let idx = 0; idx < payloads.length; idx++) {
    const meta = planilhaMeta[idx]
    const p = payloads[idx]
    if (meta.grupo == null) continue
    planilhaRows.push({
      conferente_id: p.conferente_id,
      data_inventario: dataYmd,
      grupo_armazem: meta.grupo,
      rua: String(meta.rua),
      posicao: meta.posicao,
      nivel: meta.nivel,
      numero_contagem: meta.numero_contagem,
      codigo_interno: p.codigo_interno,
      descricao: p.descricao,
      inventario_repeticao: p.inventario_repeticao,
      quantidade: p.quantidade_up,
      data_fabricacao: p.data_fabricacao,
      data_validade: p.data_validade,
      lote: p.lote,
      up_quantidade: p.up_adicional,
      observacao: p.observacao,
      produto_id: p.produto_id,
      contagens_estoque_id: allIds[idx],
    })
  }

  if (planilhaRows.length > 0) {
    console.log(`Inserindo ${planilhaRows.length} linhas em inventario_planilha_linhas...`)
    for (let i = 0; i < planilhaRows.length; i += CHUNK) {
      const chunk = planilhaRows.slice(i, i + CHUNK)
      const { error: plErr } = await supabase.from('inventario_planilha_linhas').insert(chunk)
      if (plErr) {
        console.warn('Aviso planilha (contagens já gravadas):', plErr.message)
        break
      }
    }
  }

  console.log('OK:', payloads.length, 'registros em contagens_estoque.', planilhaRows.length ? `${planilhaRows.length} em inventario_planilha_linhas (onde grupo foi reconhecido).` : '')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
