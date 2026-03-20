/**
 * Google Apps Script – Web App (Deploy > Web app, executar como EU, acesso: Qualquer pessoa)
 * URL deve terminar em /exec
 *
 * Layout esperado na aba (igual sua planilha "CONTAGEM DE ESTOQUE FISICA"):
 * - Linha 1: A = CÓDIGO, B = DESCRIÇÃO, colunas C em diante = datas (uma coluna por dia)
 * - Linhas 2+: uma linha por produto; quantidades ficam na interseção produto × data
 *
 * O painel envia JSON com Content-Type: text/plain (evita CORS).
 * Campos: tipo (upsert | edit_qty | clear_qty), data_contagem (YYYY-MM-DD), codigo_interno, descricao, quantidade_contada, ...
 */

function doPost(e) {
  let data
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : '{}'
    data = JSON.parse(raw)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'JSON inválido' })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  const ss = SpreadsheetApp.openById('1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk')
  const nomeAba = data.aba || 'CONTAGEM DE ESTOQUE FISICA'
  let sheet = ss.getSheetByName(nomeAba)
  if (!sheet) sheet = ss.insertSheet(nomeAba)

  const tipo = String(data.tipo || 'upsert')
  const tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : Session.getScriptTimeZone()

  const HEADER_ROW = 1
  const COL_CODIGO = 1
  const COL_DESC = 2
  const FIRST_DATE_COL = 3

  const incomingCodigo = String(data.codigo_interno || '').trim().toLowerCase()
  const incomingDescricao = String(data.descricao || '').trim().toLowerCase()
  const incomingDataContagem = String(data.data_contagem || '').trim()
  const incomingQtd = Number(data.quantidade_contada ?? 0)

  function normalizeToYMD(cellValue) {
    if (!cellValue && cellValue !== 0) return ''
    if (cellValue instanceof Date) {
      return Utilities.formatDate(cellValue, tz, 'yyyy-MM-dd')
    }
    const str = String(cellValue).trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    const d = new Date(str)
    if (Number.isNaN(d.getTime())) return ''
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd')
  }

  const targetYmd = normalizeToYMD(incomingDataContagem)
  if (!targetYmd) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'data_contagem inválida' })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  /** Primeira coluna na linha 1 cujo cabeçalho é essa data (evita duplicar colunas com a mesma data). */
  function findFirstDateColumn(ymd) {
    const lastCol = sheet.getLastColumn()
    for (let c = FIRST_DATE_COL; c <= lastCol; c++) {
      const v = sheet.getRange(HEADER_ROW, c).getValue()
      if (normalizeToYMD(v) === ymd) return c
    }
    return null
  }

  /** Cria uma nova coluna de data no fim (só se ainda não existir coluna para esse dia). */
  function ensureDateColumn(ymd) {
    let c = findFirstDateColumn(ymd)
    if (c) return c
    const lastCol = Math.max(sheet.getLastColumn(), FIRST_DATE_COL - 1)
    const newCol = lastCol + 1
    const parts = ymd.split('-')
    const y = parseInt(parts[0], 10)
    const mo = parseInt(parts[1], 10) - 1
    const d = parseInt(parts[2], 10)
    const dt = new Date(y, mo, d)
    sheet.getRange(HEADER_ROW, newCol).setValue(dt)
    sheet.getRange(HEADER_ROW, newCol).setNumberFormat('dd/mm/yyyy')
    return newCol
  }

  function findProductRow() {
    const lastRow = sheet.getLastRow()
    for (let r = HEADER_ROW + 1; r <= lastRow; r++) {
      const ca = String(sheet.getRange(r, COL_CODIGO).getValue()).trim().toLowerCase()
      const cb = String(sheet.getRange(r, COL_DESC).getValue()).trim().toLowerCase()
      if (ca === incomingCodigo && cb === incomingDescricao) return r
    }
    return null
  }

  const dateCol = ensureDateColumn(targetYmd)
  const productRow = findProductRow()

  if (tipo === 'clear_qty') {
    if (productRow) {
      sheet.getRange(productRow, dateCol).setValue('')
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
  }

  if (tipo === 'edit_qty') {
    if (!productRow) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: 'Produto não encontrado na planilha para edit_qty' }),
      ).setMimeType(ContentService.MimeType.JSON)
    }
    sheet.getRange(productRow, dateCol).setValue(incomingQtd)
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
  }

  // upsert (salvar contagem)
  if (!productRow) {
    const newRow = Math.max(sheet.getLastRow(), HEADER_ROW) + 1
    sheet.getRange(newRow, COL_CODIGO).setValue(data.codigo_interno || '')
    sheet.getRange(newRow, COL_DESC).setValue(data.descricao || '')
    sheet.getRange(newRow, dateCol).setValue(incomingQtd)
  } else {
    sheet.getRange(productRow, dateCol).setValue(incomingQtd)
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}
