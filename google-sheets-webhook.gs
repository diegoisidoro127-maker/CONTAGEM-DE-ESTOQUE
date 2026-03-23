/**
 * Web App — A=CÓDIGO, B=DESCRIÇÃO, C+=datas
 *
 * targetYmd: calculado NO SERVIDOR a partir de data_hora_contagem (ISO) + fuso da PLANILHA.
 * Assim salvar/editar/excluir sempre usam o mesmo "dia" que o Google Sheets espera.
 *
 * Ordem: cache → notas YMD → parse cabeçalho → display dd/mm/aaaa → criar coluna.
 */

function doPost(e) {
  var data
  try {
    var raw = e.postData && e.postData.contents ? e.postData.contents : '{}'
    data = JSON.parse(raw)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'JSON inválido' })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(30000)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Planilha ocupada, tente de novo.' })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  try {
    return doPostLocked(data)
  } finally {
    lock.releaseLock()
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Use POST com JSON (text/plain) para gravar.' })).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/**
 * Dia civil yyyy-MM-dd no fuso da planilha (não confiar só na string data_contagem do cliente).
 */
function instantIsoToYmdInTz(isoLike, timeZone) {
  if (!isoLike) return ''
  var d = new Date(String(isoLike))
  if (isNaN(d.getTime())) return ''
  return Utilities.formatDate(d, timeZone, 'yyyy-MM-dd')
}

function doPostLocked(data) {
  var ss = SpreadsheetApp.openById('1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk')
  var nomeAba = data.aba || 'CONTAGEM DE ESTOQUE FISICA'
  var sheet = ss.getSheetByName(nomeAba)
  if (!sheet) sheet = ss.insertSheet(nomeAba)

  var props = PropertiesService.getScriptProperties()
  var tipo = String(data.tipo || 'upsert')
  var tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : Session.getScriptTimeZone()

  var HEADER_ROW = 1
  var COL_CODIGO = 1
  var COL_DESC = 2
  var FIRST_DATE_COL = 3
  var NOTE_PREFIX = 'YMD:'

  var incomingCodigo = String(data.codigo_interno || '').trim().toLowerCase()
  var incomingDescricao = String(data.descricao || '').trim().toLowerCase()
  var incomingQtd = Number(data.quantidade_contada ?? 0)

  function cacheKey(ymd) {
    return 'dcol_' + ss.getId() + '_' + sheet.getSheetId() + '_' + ymd
  }

  function normalizeToYMD(cellValue) {
    if (cellValue === null || cellValue === undefined || cellValue === '') return ''
    if (cellValue instanceof Date) {
      return Utilities.formatDate(cellValue, tz, 'yyyy-MM-dd')
    }
    if (typeof cellValue === 'number' && cellValue > 20000 && cellValue < 600000) {
      var serial = Math.floor(cellValue)
      var ms = (serial - 25569) * 86400 * 1000
      var d = new Date(ms)
      if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd')
    }
    var str = String(cellValue).trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
    var m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m) {
      var dd = String(m[1]).padStart(2, '0')
      var mm = String(m[2]).padStart(2, '0')
      return m[3] + '-' + mm + '-' + dd
    }
    var d2 = new Date(str)
    if (isNaN(d2.getTime())) return ''
    return Utilities.formatDate(d2, tz, 'yyyy-MM-dd')
  }

  function incomingStringToYMD(s) {
    if (!s) return ''
    var str = String(s)
      .replace(/^\uFEFF/, '')
      .trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
    var m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return m[3] + '-' + m[2] + '-' + m[1]
    return normalizeToYMD(str)
  }

  /**
   * Coluna da planilha deve bater com o painel.
   * 1) Se vier data_contagem (yyyy-mm-dd), usa (mesmo critério do React).
   * 2) Senão, deriva do ISO no fuso da planilha.
   * Se ambos existirem e diferirem, prioriza data_contagem para não criar coluna “paralela”.
   */
  var fromIso = data.data_hora_contagem ? instantIsoToYmdInTz(data.data_hora_contagem, tz) : ''
  var fromClient = incomingStringToYMD(String(data.data_contagem || ''))
  var targetYmd = fromClient || fromIso
  if (fromClient && fromIso && fromClient !== fromIso) {
    targetYmd = fromClient
  }
  if (!targetYmd) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'data_hora_contagem/data_contagem inválidos' })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  function ymdToDisplayBR(ymd) {
    var p = ymd.split('-')
    if (p.length !== 3) return ''
    return String(parseInt(p[2], 10)) + '/' + String(parseInt(p[1], 10)) + '/' + p[0]
  }

  function ymdToDisplayBRPadded(ymd) {
    var p = ymd.split('-')
    if (p.length !== 3) return ''
    var dd = String(parseInt(p[2], 10))
    var mm = String(parseInt(p[1], 10))
    var pad2 = function (x) {
      return x.length < 2 ? '0' + x : x
    }
    return pad2(dd) + '/' + pad2(mm) + '/' + p[0]
  }

  function headerCellToYMD(col) {
    var r = sheet.getRange(HEADER_ROW, col)
    var raw = r.getValue()
    if (raw instanceof Date) return normalizeToYMD(raw)
    if (typeof raw === 'number' && raw > 20000 && raw < 600000) return normalizeToYMD(raw)

    var disp = String(r.getDisplayValue() || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u2007|\u202F/g, ' ')
      .trim()
    if (disp) {
      var m1 = disp.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (m1) {
        var d0 = String(m1[1]).padStart(2, '0')
        var mo0 = String(m1[2]).padStart(2, '0')
        return m1[3] + '-' + mo0 + '-' + d0
      }
      var m2 = disp.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (m2) return m2[0]
    }
    return normalizeToYMD(raw)
  }

  function getHeaderScanLastCol() {
    var lc = sheet.getLastColumn()
    try {
      var dr = sheet.getDataRange()
      if (dr) lc = Math.max(lc, dr.getLastColumn())
    } catch (e) {}
    try {
      var maxW = Math.min(sheet.getMaxColumns(), 2000)
      var row = sheet.getRange(HEADER_ROW, FIRST_DATE_COL, HEADER_ROW, maxW).getValues()[0]
      for (var i = row.length - 1; i >= 0; i--) {
        if (row[i] !== '' && row[i] !== null && row[i] !== undefined) {
          lc = Math.max(lc, FIRST_DATE_COL + i)
          break
        }
      }
    } catch (e2) {}
    return Math.max(lc, FIRST_DATE_COL)
  }

  function getColumnFromCache(ymd) {
    var v = props.getProperty(cacheKey(ymd))
    if (!v) return null
    var col = parseInt(v, 10)
    if (!col || col < FIRST_DATE_COL) {
      props.deleteProperty(cacheKey(ymd))
      return null
    }
    var r = sheet.getRange(HEADER_ROW, col)
    var empty = r.getValue() === '' && String(r.getDisplayValue() || '').trim() === ''
    if (empty) {
      props.deleteProperty(cacheKey(ymd))
      return null
    }
    return col
  }

  function setColumnCache(ymd, col) {
    props.setProperty(cacheKey(ymd), String(col))
  }

  function setYmdNote(col, ymd) {
    sheet.getRange(HEADER_ROW, col).setNote(NOTE_PREFIX + ymd)
  }

  function findDateColumn(ymd) {
    var lastCol = Math.max(getHeaderScanLastCol(), FIRST_DATE_COL)
    lastCol = Math.max(lastCol, 200)
    var marker = NOTE_PREFIX + ymd
    var dispUnpadded = ymdToDisplayBR(ymd)
    var dispPadded = ymdToDisplayBRPadded(ymd)

    var notes = sheet.getRange(HEADER_ROW, FIRST_DATE_COL, HEADER_ROW, lastCol).getNotes()[0]
    for (var i = 0; i < notes.length; i++) {
      var n = String(notes[i] || '')
      if (n.indexOf(marker) >= 0) return FIRST_DATE_COL + i
    }

    for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
      var y = headerCellToYMD(c)
      if (y && y === ymd) {
        setYmdNote(c, ymd)
        return c
      }
    }

    for (var c2 = FIRST_DATE_COL; c2 <= lastCol; c2++) {
      var dv = String(sheet.getRange(HEADER_ROW, c2).getDisplayValue() || '')
        .replace(/\u00A0/g, ' ')
        .trim()
      if (dv === dispUnpadded || dv === dispPadded) {
        setYmdNote(c2, ymd)
        return c2
      }
    }

    return null
  }

  function ensureDateColumn(ymd) {
    var found = getColumnFromCache(ymd)
    if (found) return found

    found = findDateColumn(ymd)
    if (found) {
      setColumnCache(ymd, found)
      return found
    }

    Utilities.sleep(150)
    found = findDateColumn(ymd)
    if (found) {
      setColumnCache(ymd, found)
      return found
    }

    found = getColumnFromCache(ymd)
    if (found) return found

    var lastCol = getHeaderScanLastCol()
    var newCol = Math.max(lastCol + 1, FIRST_DATE_COL)
    var parts = ymd.split('-')
    var y = parseInt(parts[0], 10)
    var mo = parseInt(parts[1], 10) - 1
    var d = parseInt(parts[2], 10)
    var dt = new Date(y, mo, d, 12, 0, 0)
    var cell = sheet.getRange(HEADER_ROW, newCol)
    cell.setValue(dt)
    cell.setNumberFormat('dd/mm/yyyy')
    setYmdNote(newCol, ymd)
    setColumnCache(ymd, newCol)
    return newCol
  }

  function findProductRow() {
    var lastRow = sheet.getLastRow()
    for (var r = HEADER_ROW + 1; r <= lastRow; r++) {
      var ca = String(sheet.getRange(r, COL_CODIGO).getValue()).trim().toLowerCase()
      var cb = String(sheet.getRange(r, COL_DESC).getValue()).trim().toLowerCase()
      if (ca === incomingCodigo && cb === incomingDescricao) return r
    }
    return null
  }

  var dateCol = ensureDateColumn(targetYmd)
  var productRow = findProductRow()

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

  if (!productRow) {
    var newRow = Math.max(sheet.getLastRow(), HEADER_ROW) + 1
    sheet.getRange(newRow, COL_CODIGO).setValue(data.codigo_interno || '')
    sheet.getRange(newRow, COL_DESC).setValue(data.descricao || '')
    sheet.getRange(newRow, dateCol).setValue(incomingQtd)
  } else {
    sheet.getRange(productRow, dateCol).setValue(incomingQtd)
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}
