/**
 * Importa Excel exportado pelo relatório (aba "Contagens") para contagens_estoque + inventario_planilha_linhas.
 *
 * Uso (PowerShell, na pasta frontend):
 *   $env:VITE_SUPABASE_URL="https://xxx.supabase.co"
 *   $env:VITE_SUPABASE_ANON_KEY="eyJ..."
 *   node scripts/import-relatorio-contagem-xlsx.mjs "C:\Users\...\relatorio-contagem_Dia-_28-03-2026.xlsx" --data 2026-03-28
 *
 * Só gerar SQL (sem gravar pela API):
 *   node scripts/import-relatorio-contagem-xlsx.mjs "...\arquivo.xlsx" --data 2026-03-28 --sql-only
 *   node scripts/import-relatorio-contagem-xlsx.mjs "...\arquivo.xlsx" --data 2026-03-28 --sql-only --out ..\supabase\sql\import_relatorio_manual.sql
 *
 * Preencher EAN, DUN e unidade a partir de "Todos os Produtos" (requer .env com Supabase):
 *   --enrich-ean-dun   obriga credenciais; falha se não houver .env
 *   --no-enrich-ean-dun   não consulta o cadastro
 *   Com .env e sem --no-enrich-ean-dun, enriquece automaticamente.
 *
 * --data YYYY-MM-DD = data_contagem (obrigatório se não estiver no nome do arquivo)
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import {
  buildStagingFromXlsxBuffer,
  generatePostgresImportSql,
  ymdFromFilename,
} from './relatorio-xlsx-import-core.mjs'
import { enrichStagingEanDunFromTodosOsProdutos } from './enrich-staging-ean-dun-supabase.mjs'

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
  const sqlOnly = args.includes('--sql-only')
  const outIdx = args.indexOf('--out')
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : null

  if (!filePath) {
    console.error(
      'Uso: node scripts/import-relatorio-contagem-xlsx.mjs <arquivo.xlsx> [--data YYYY-MM-DD] [--sql-only] [--out caminho.sql] [--enrich-ean-dun | --no-enrich-ean-dun]',
    )
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

  const buf = fs.readFileSync(filePath)
  let { staging, dataHoraIso, warnings } = buildStagingFromXlsxBuffer(buf, dataYmd)
  for (const w of warnings) console.warn(w)

  if (staging.length === 0) {
    console.error('Nenhuma linha válida para importar.')
    process.exit(1)
  }

  const noEnrich = args.includes('--no-enrich-ean-dun')
  const forceEnrich = args.includes('--enrich-ean-dun')
  const { url: envUrl, key: envKey } = loadEnv()

  if (forceEnrich && (!envUrl || !envKey)) {
    console.error(
      'Para --enrich-ean-dun, configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em frontend/.env (ou variáveis de ambiente).',
    )
    process.exit(1)
  }

  const shouldEnrich = !noEnrich && envUrl && envKey
  if (shouldEnrich) {
    const sb = createClient(envUrl, envKey)
    staging = await enrichStagingEanDunFromTodosOsProdutos(sb, staging)
  } else if (!noEnrich && !envUrl) {
    console.warn(
      'Aviso: sem credenciais Supabase — EAN/DUN não foram preenchidos a partir de "Todos os Produtos". Coloque .env ou use --enrich-ean-dun após configurar.',
    )
  }

  if (sqlOnly) {
    const sql = generatePostgresImportSql(staging, dataYmd, dataHoraIso)
    if (outPath) {
      fs.writeFileSync(outPath, sql, 'utf8')
      console.log('SQL gravado em:', outPath, `(${staging.length} linhas)`)
    } else {
      process.stdout.write(sql)
    }
    return
  }

  if (!envUrl || !envKey) {
    console.error(
      'Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente ou em frontend/.env (ou use --sql-only).',
    )
    process.exit(1)
  }

  const supabase = createClient(envUrl, envKey)

  const { data: confRows, error: confErr } = await supabase.from('conferentes').select('id,nome')
  if (confErr) throw confErr
  const confByNome = new Map(
    (confRows ?? []).map((r) => [String(r.nome ?? '').trim().toLowerCase(), String(r.id)]),
  )

  const payloads = []
  const planilhaMeta = []

  for (const s of staging) {
    const conferente_id = confByNome.get(String(s.conferente_nome).toLowerCase())
    if (!conferente_id) {
      throw new Error(`Conferente não encontrado no banco: "${s.conferente_nome}". Cadastre em conferentes.`)
    }

    payloads.push({
      data_contagem: dataYmd,
      data_hora_contagem: dataHoraIso,
      conferente_id,
      produto_id: null,
      codigo_interno: s.codigo_interno,
      descricao: s.descricao,
      unidade_medida: s.unidade_medida,
      quantidade_up: s.quantidade_up,
      up_adicional: s.up_adicional,
      lote: s.lote,
      observacao: s.observacao,
      data_fabricacao: s.data_fabricacao,
      data_validade: s.data_validade,
      ean: s.ean,
      dun: s.dun,
      foto_base64: null,
      origem: 'inventario',
      inventario_repeticao: s.inventario_repeticao,
      inventario_numero_contagem: s.inventario_numero_contagem,
    })

    planilhaMeta.push({
      grupo: s.grupo_armazem,
      rua: String(s.rua),
      posicao: s.posicao,
      nivel: s.nivel,
      numero_contagem: s.numero_contagem_planilha,
    })
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

  console.log(
    'OK:',
    payloads.length,
    'registros em contagens_estoque.',
    planilhaRows.length
      ? `${planilhaRows.length} em inventario_planilha_linhas (onde grupo foi reconhecido).`
      : '',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
