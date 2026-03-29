/**
 * Lógica compartilhada: Excel do relatório → linhas para SQL ou Supabase.
 */

import * as XLSX from 'xlsx'

export const INVENTARIO_ARMAZEM_ABA_TITULOS = {
  1: 'CAMARA 11 - RUA V',
  2: 'CAMARA 11 - RUA U',
  3: 'CAMARA 12 - RUA X',
  4: 'CAMARA 12 - RUA Y',
  5: 'CAMARA 13 - RUA W',
  6: 'CAMARA 13 - RUA Z',
  7: 'CAMARA 21 - RUA A',
  8: 'CAMARA 21 - RUA B',
}
export const RUA_BY_GRUPO = { 1: 'V', 2: 'U', 3: 'X', 4: 'Y', 5: 'W', 6: 'Z', 7: 'A', 8: 'B' }

export function grupoFromCamaraRua(camara, rua) {
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

export function parseRodada(contagemCell) {
  const s = String(contagemCell ?? '')
  const m = s.match(/(\d+)\s*°?\s*CONTAGEM/i)
  if (m) return Math.min(4, Math.max(1, Number(m[1])))
  const n = Number.parseInt(s, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 4) return n
  return 1
}

export function parseDateBR(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  const y = m[3]
  return `${y}-${mo}-${d}`
}

/** Número serial Excel (dias desde 1899-12-30) → YYYY-MM-DD */
export function excelSerialToYmd(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n < 1) return null
  const utc = new Date((n - 25569) * 86400 * 1000)
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString().slice(0, 10)
}

/** Célula de data: Date (sheet cellDates), serial Excel, ou texto dd/mm/aaaa */
export function parseDateCell(val) {
  if (val == null || val === '') return null
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }
  if (typeof val === 'number' && val > 20000 && val < 60000) {
    return excelSerialToYmd(val)
  }
  return parseDateBR(val)
}

export function ymdFromFilename(name) {
  const m = String(name).match(/(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * @returns {{ staging: Array<Record<string, unknown>>, dataHoraIso: string, warnings: string[] }}
 */
export function buildStagingFromXlsxBuffer(buf, dataYmd) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (rows.length < 2) throw new Error('Planilha vazia.')

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
    throw new Error('Cabeçalho inválido: precisa Conferente, Código do produto, Quantidade contada.')
  }

  const dataHoraIso = new Date(`${dataYmd}T12:00:00`).toISOString()
  const staging = []
  const warnings = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const nomeConf = String(row[iConf] ?? '').trim()
    if (!nomeConf) continue

    const codigo_interno = String(row[iCod] ?? '').trim()
    const qtdRaw = row[iQtd]
    const q = Number(String(qtdRaw).replace(',', '.'))
    if (!codigo_interno || !Number.isFinite(q) || q < 0) continue

    const grupo = grupoFromCamaraRua(row[iCam], row[iRua])
    if (grupo == null) {
      warnings.push(`Linha ${r + 1}: grupo não mapeado (Câmara="${row[iCam]}" Rua="${row[iRua]}") — só contagens_estoque.`)
    }

    const numeroRodada = parseRodada(row[iCont])
    const df = iFab >= 0 ? parseDateCell(row[iFab]) : null
    const dv = iVen >= 0 ? parseDateCell(row[iVen]) : null
    const upRaw = iUp >= 0 ? String(row[iUp] ?? '').trim() : ''
    let up_adicional = null
    if (upRaw !== '') {
      const u = Number(upRaw.replace(',', '.'))
      if (Number.isFinite(u) && u >= 0) up_adicional = u
    }

    staging.push({
      lin: r + 1,
      conferente_nome: nomeConf,
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
      origem: 'inventario',
      inventario_repeticao: null,
      inventario_numero_contagem: numeroRodada,
      grupo_armazem: grupo,
      rua: String(row[iRua] ?? '').trim() || (grupo != null ? RUA_BY_GRUPO[grupo] : '') || '',
      posicao: iPos >= 0 ? Number(row[iPos]) || 0 : 0,
      nivel: iNiv >= 0 ? Number(row[iNiv]) || 0 : 0,
      numero_contagem_planilha: numeroRodada,
    })
  }

  return { staging, dataHoraIso, warnings }
}

export function sqlEscape(s) {
  if (s == null) return 'NULL'
  return "'" + String(s).replace(/'/g, "''") + "'"
}

export function sqlDateOrNull(ymd) {
  if (!ymd) return 'NULL'
  return `'${ymd}'::date`
}

function sqlNum(n) {
  if (n == null || Number.isNaN(n)) return 'NULL'
  return String(n)
}

/**
 * SQL para rodar no Supabase (transação): staging com UUID por linha → contagens_estoque → inventario_planilha_linhas.
 * Conferentes: JOIN por trim(nome) = staging.conferente_nome (igual ao app).
 */
export function generatePostgresImportSql(staging, dataYmd, dataHoraIso) {
  if (staging.length === 0) throw new Error('Nenhuma linha.')

  const tsLit = sqlEscape(dataHoraIso) + '::timestamptz'
  const lines = staging.map((row) => {
    const parts = [
      'gen_random_uuid()',
      String(row.lin),
      sqlEscape(row.conferente_nome),
      sqlEscape(row.codigo_interno),
      sqlEscape(row.descricao),
      row.unidade_medida == null ? 'NULL' : sqlEscape(row.unidade_medida),
      sqlNum(row.quantidade_up),
      row.up_adicional == null ? 'NULL' : sqlNum(row.up_adicional),
      row.lote == null ? 'NULL' : sqlEscape(row.lote),
      row.observacao == null ? 'NULL' : sqlEscape(row.observacao),
      row.data_fabricacao == null ? 'NULL' : sqlDateOrNull(row.data_fabricacao),
      row.data_validade == null ? 'NULL' : sqlDateOrNull(row.data_validade),
      row.ean == null ? 'NULL' : sqlEscape(row.ean),
      row.dun == null ? 'NULL' : sqlEscape(row.dun),
      sqlEscape(row.origem),
      row.inventario_repeticao == null ? 'NULL' : String(row.inventario_repeticao),
      String(row.inventario_numero_contagem),
      row.grupo_armazem == null ? 'NULL' : String(row.grupo_armazem),
      sqlEscape(row.rua),
      String(row.posicao),
      String(row.nivel),
      String(row.numero_contagem_planilha),
    ]
    return `  (${parts.join(', ')})`
  })

  return `-- Import relatório → contagens_estoque + inventario_planilha_linhas
-- Gerado automaticamente. data_contagem=${dataYmd}
-- Conferentes devem existir com nome igual ao Excel (trim).
-- Se faltar coluna origem/inventario_* em contagens_estoque, remova essas colunas do INSERT abaixo.

BEGIN;

CREATE TEMP TABLE _rel_import_staging (
  id uuid NOT NULL,
  lin int NOT NULL,
  conferente_nome text NOT NULL,
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  unidade_medida text,
  quantidade_up numeric NOT NULL,
  up_adicional numeric,
  lote text,
  observacao text,
  data_fabricacao date,
  data_validade date,
  ean text,
  dun text,
  origem text,
  inventario_repeticao int,
  inventario_numero_contagem int,
  grupo_armazem int,
  rua text,
  posicao int,
  nivel int,
  numero_contagem_planilha int
) ON COMMIT DROP;

INSERT INTO _rel_import_staging (
  id, lin, conferente_nome, codigo_interno, descricao, unidade_medida, quantidade_up, up_adicional,
  lote, observacao, data_fabricacao, data_validade, ean, dun, origem, inventario_repeticao,
  inventario_numero_contagem, grupo_armazem, rua, posicao, nivel, numero_contagem_planilha
) VALUES
${lines.join(',\n')};

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _rel_import_staging s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conferentes c WHERE trim(c.nome) = trim(s.conferente_nome)
    )
  ) THEN
    RAISE EXCEPTION 'Conferente não encontrado em public.conferentes (nome deve ser igual ao da planilha, após trim).';
  END IF;
END
$guard$;

INSERT INTO public.contagens_estoque (
  id,
  data_contagem,
  data_hora_contagem,
  conferente_id,
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
  foto_base64,
  origem,
  inventario_repeticao,
  inventario_numero_contagem
)
SELECT
  s.id,
  ${sqlDateOrNull(dataYmd)},
  ${tsLit},
  c.id,
  NULL::uuid,
  s.codigo_interno,
  s.descricao,
  s.unidade_medida,
  s.quantidade_up,
  s.up_adicional,
  s.lote,
  s.observacao,
  s.data_fabricacao,
  s.data_validade,
  s.ean,
  s.dun,
  NULL,
  s.origem,
  s.inventario_repeticao,
  s.inventario_numero_contagem
FROM _rel_import_staging s
JOIN public.conferentes c ON trim(c.nome) = trim(s.conferente_nome);

INSERT INTO public.inventario_planilha_linhas (
  conferente_id,
  data_inventario,
  grupo_armazem,
  rua,
  posicao,
  nivel,
  numero_contagem,
  codigo_interno,
  descricao,
  inventario_repeticao,
  quantidade,
  data_fabricacao,
  data_validade,
  lote,
  up_quantidade,
  observacao,
  produto_id,
  contagens_estoque_id
)
SELECT
  c.id,
  ${sqlDateOrNull(dataYmd)},
  s.grupo_armazem,
  s.rua,
  s.posicao,
  s.nivel,
  s.numero_contagem_planilha,
  s.codigo_interno,
  s.descricao,
  s.inventario_repeticao,
  s.quantidade_up,
  s.data_fabricacao,
  s.data_validade,
  s.lote,
  s.up_adicional,
  s.observacao,
  NULL::uuid,
  s.id
FROM _rel_import_staging s
JOIN public.conferentes c ON trim(c.nome) = trim(s.conferente_nome)
WHERE s.grupo_armazem IS NOT NULL;

COMMIT;
`
}
