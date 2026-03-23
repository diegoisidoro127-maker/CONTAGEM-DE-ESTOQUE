var WEBHOOK_VERSION = 'no-auto-create-v2'

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Contagem Estoque')
      .addItem('Juntar colunas agora', 'executarConsolidacaoManual')
      .addItem('Status consolidação auto', 'statusConsolidacaoAuto')
      .addToUi()
  } catch (e) {}
}

function executarConsolidacaoManual() {
  var res = consolidarColunasDuplicadas()
  Logger.log('executarConsolidacaoManual: ' + JSON.stringify(res))
  return res
}

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
  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      message: 'Use POST com JSON (text/plain) para gravar.',
      version: WEBHOOK_VERSION,
      mode: 'no_auto_column_create',
    }),
  ).setMimeType(ContentService.MimeType.JSON)
}

/**
 * Executar MANUALMENTE 1x no Apps Script para consolidar colunas de data duplicadas.
 * Mantém a coluna mais à esquerda de cada dia e remove as demais.
 * Se houver valores em duplicadas, soma na coluna "keeper".
 */
function consolidarColunasDuplicadas() {
  var ss = SpreadsheetApp.openById('1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk')
  var sheet = ss.getSheetByName('CONTAGEM DE ESTOQUE FISICA')
  if (!sheet) throw new Error('Aba CONTAGEM DE ESTOQUE FISICA não encontrada.')

  var HEADER_ROW = 1
  var FIRST_DATE_COL = 3
  var NOTE_PREFIX = 'YMD:'
  var tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : Session.getScriptTimeZone()
  var lastCol = sheet.getLastColumn()
  var lastRow = Math.max(sheet.getLastRow(), 2)

  function normalizeToYMD(cellValue) {
    if (cellValue === null || cellValue === undefined || cellValue === '') return ''
    if (cellValue instanceof Date) return Utilities.formatDate(cellValue, tz, 'yyyy-MM-dd')
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

  function headerCellToYMD(col) {
    var r = sheet.getRange(HEADER_ROW, col)
    var note = String(r.getNote() || '')
    if (note.indexOf(NOTE_PREFIX) >= 0) {
      var n = note.replace(NOTE_PREFIX, '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n
    }
    var raw = r.getValue()
    var y = normalizeToYMD(raw)
    if (y) return y
    return normalizeToYMD(r.getDisplayValue())
  }

  var firstByDay = {}
  var duplicates = [] // { day, keeperCol, dupCol }

  for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
    var ymd = headerCellToYMD(c)
    if (!ymd) continue
    if (!firstByDay[ymd]) {
      firstByDay[ymd] = c
      sheet.getRange(HEADER_ROW, c).setNote(NOTE_PREFIX + ymd)
    } else {
      duplicates.push({ day: ymd, keeperCol: firstByDay[ymd], dupCol: c })
    }
  }

  // Soma os valores da duplicada na keeper e deleta colunas duplicadas da direita para a esquerda.
  for (var i = duplicates.length - 1; i >= 0; i--) {
    var d = duplicates[i]
    var keeperRange = sheet.getRange(2, d.keeperCol, lastRow - 1, 1)
    var dupRange = sheet.getRange(2, d.dupCol, lastRow - 1, 1)
    var keeperVals = keeperRange.getValues()
    var dupVals = dupRange.getValues()

    for (var r = 0; r < keeperVals.length; r++) {
      var a = Number(keeperVals[r][0] || 0)
      var b = Number(dupVals[r][0] || 0)
      var sum = a + b
      keeperVals[r][0] = sum === 0 ? '' : sum
    }
    keeperRange.setValues(keeperVals)
    sheet.deleteColumn(d.dupCol)
  }

  return { ok: true, removidas: duplicates.length, mapeadas: Object.keys(firstByDay).length }
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
  // Modo "corrige na hora do input":
  // antes de gravar, consolida colunas duplicadas existentes.
  // Isso garante que cada dia fique em UMA coluna no momento do envio.
  try {
    consolidarColunasDuplicadas()
  } catch (e0) {
    // Não bloqueia a gravação principal se a consolidação falhar pontualmente.
  }

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
  var INDEX_SHEET_NAME = '_IDX_DATAS'

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

  function canonicalDateKeyFromDisplay(str) {
    var s = String(str || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u2007|\u202F/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!s) return ''

    var m1 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m1) {
      var dd = String(m1[1]).padStart(2, '0')
      var mm = String(m1[2]).padStart(2, '0')
      return m1[3] + '-' + mm + '-' + dd
    }

    var m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3]

    // Fallback extremo: remove tudo, tenta ddmmyyyy ou yyyymmdd.
    var digits = s.replace(/\D/g, '')
    if (digits.length >= 8) {
      if (/^\d{8}$/.test(digits)) {
        var p1 = digits.slice(0, 4)
        var p2 = digits.slice(4, 6)
        var p3 = digits.slice(6, 8)
        if (Number(p1) > 1900 && Number(p2) >= 1 && Number(p2) <= 12 && Number(p3) >= 1 && Number(p3) <= 31) {
          return p1 + '-' + p2 + '-' + p3
        }
        var d = digits.slice(0, 2)
        var m = digits.slice(2, 4)
        var y = digits.slice(4, 8)
        if (Number(y) > 1900 && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
          return y + '-' + m + '-' + d
        }
      }
    }
    return ''
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

  function getOrCreateIndexSheet() {
    var idx = ss.getSheetByName(INDEX_SHEET_NAME)
    if (!idx) {
      idx = ss.insertSheet(INDEX_SHEET_NAME)
      idx.getRange(1, 1).setValue('ymd')
      idx.getRange(1, 2).setValue('col')
      idx.hideSheet()
    }
    return idx
  }

  function readMappedCol(ymd) {
    try {
      var idx = getOrCreateIndexSheet()
      var last = idx.getLastRow()
      if (last < 2) return null
      var vals = idx.getRange(2, 1, last - 1, 2).getValues()
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]) === ymd) {
          var c = parseInt(String(vals[i][1] || ''), 10)
          if (c >= FIRST_DATE_COL) return c
        }
      }
    } catch (e) {}
    return null
  }

  function writeMappedCol(ymd, col) {
    try {
      var idx = getOrCreateIndexSheet()
      var last = idx.getLastRow()
      if (last < 2) {
        idx.getRange(2, 1).setValue(ymd)
        idx.getRange(2, 2).setValue(col)
        return
      }
      var vals = idx.getRange(2, 1, last - 1, 2).getValues()
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]) === ymd) {
          idx.getRange(2 + i, 2).setValue(col)
          return
        }
      }
      idx.getRange(last + 1, 1).setValue(ymd)
      idx.getRange(last + 1, 2).setValue(col)
    } catch (e) {}
  }

  function isColumnHeaderForDay(col, ymd) {
    try {
      if (!col || col < FIRST_DATE_COL) return false
      var rr = sheet.getRange(HEADER_ROW, col)
      var note = String(rr.getNote ? rr.getNote() : '')
      if (note.indexOf(NOTE_PREFIX + ymd) >= 0) return true
      var y = headerCellToYMD(col)
      return !!y && y === ymd
    } catch (e) {
      return false
    }
  }

  /**
   * Reconstrói o índice de datas pelo cabeçalho atual.
   * Evita mapeamentos quebrados quando colunas são deletadas/consolidadas.
   */
  function refreshDateIndexFromHeader() {
    try {
      var idx = getOrCreateIndexSheet()
      var lastCol = getHeaderScanLastCol()
      var map = {}

      for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
        var y = headerCellToYMD(c)
        if (!y) continue
        if (!map[y]) map[y] = c
      }

      idx.clearContents()
      idx.getRange(1, 1).setValue('ymd')
      idx.getRange(1, 2).setValue('col')

      var keys = Object.keys(map).sort()
      if (keys.length <= 0) return

      var out = []
      for (var i = 0; i < keys.length; i++) {
        var ymd = keys[i]
        var col = map[ymd]
        out.push([ymd, col])
        setYmdNote(col, ymd)
        setColumnCache(ymd, col)
      }
      idx.getRange(2, 1, out.length, 2).setValues(out)
    } catch (e) {}
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

  // Fallback textual: identifica coluna por string do cabeçalho, mesmo com formatação incomum.
  function findDateColumnByText(ymd) {
    var lastCol = Math.max(getHeaderScanLastCol(), FIRST_DATE_COL)
    var dispUnpadded = ymdToDisplayBR(ymd)
    var dispPadded = ymdToDisplayBRPadded(ymd)

    for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
      var dv = String(sheet.getRange(HEADER_ROW, c).getDisplayValue() || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u2007|\u202F/g, ' ')
        .trim()
      if (!dv) continue
      var key = canonicalDateKeyFromDisplay(dv)
      if (key === ymd || dv === dispUnpadded || dv === dispPadded || dv.indexOf(dispPadded) >= 0 || dv.indexOf(ymd) >= 0) {
        setYmdNote(c, ymd)
        return c
      }
    }
    return null
  }

  function ensureDateColumn(ymd) {
    // 0) Mapeamento estável no sheet de índice (evita depender do parsing do cabeçalho sempre)
    var mapped = readMappedCol(ymd)
    // Regra principal: se existe mapeamento no índice, usa a coluna mapeada.
    // O índice é reconstruído no início de cada request para evitar drift após deleções.
    if (mapped && mapped >= FIRST_DATE_COL) {
      // Se o cabeçalho ficou inconsistente, reescreve a célula com a data correta.
      if (!isColumnHeaderForDay(mapped, ymd)) {
        var p0 = ymd.split('-')
        var dt0 = new Date(parseInt(p0[0], 10), parseInt(p0[1], 10) - 1, parseInt(p0[2], 10), 12, 0, 0)
        var hc0 = sheet.getRange(HEADER_ROW, mapped)
        hc0.setValue(dt0)
        hc0.setNumberFormat('dd/mm/yyyy')
      }
      setYmdNote(mapped, ymd)
      setColumnCache(ymd, mapped)
      return mapped
    }

    var found = getColumnFromCache(ymd)
    // Cache também passa a ser confiado diretamente.
    if (found && found >= FIRST_DATE_COL) {
      setYmdNote(found, ymd)
      writeMappedCol(ymd, found)
      return found
    }

    found = findDateColumn(ymd)
    if (found) {
      setColumnCache(ymd, found)
      writeMappedCol(ymd, found)
      return found
    }

    found = findDateColumnByText(ymd)
    if (found) {
      setColumnCache(ymd, found)
      writeMappedCol(ymd, found)
      return found
    }

    Utilities.sleep(150)
    refreshDateIndexFromHeader()
    mapped = readMappedCol(ymd)
    if (mapped && mapped >= FIRST_DATE_COL) {
      setYmdNote(mapped, ymd)
      setColumnCache(ymd, mapped)
      return mapped
    }

    found = findDateColumn(ymd)
    if (found) {
      setColumnCache(ymd, found)
      writeMappedCol(ymd, found)
      return found
    }

    found = findDateColumnByText(ymd)
    if (found) {
      setColumnCache(ymd, found)
      writeMappedCol(ymd, found)
      return found
    }

    found = getColumnFromCache(ymd)
    if (found) return found

    // Modo travado: não cria coluna automaticamente no webhook.
    // Isso elimina a causa raiz de duplicação de colunas.
    return null
  }

  /**
   * Procura TODAS as colunas que representam esse dia (mesmo que existam duplicadas),
   * mantém a mais à esquerda e remove as duplicadas somando valores na célula.
   * Retorna a coluna "keeper" (mais à esquerda) ou null se não encontrar.
   */
  function consolidateColumnsForDay(ymd) {
    var lastCol = getHeaderScanLastCol()
    var lastRow = Math.max(sheet.getLastRow(), 2)
    var note = NOTE_PREFIX + ymd

    // Captura colunas duplicadas do dia (ordem crescente).
    var matches = []
    for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
      try {
        var r = sheet.getRange(HEADER_ROW, c)
        var n = String(r.getNote ? r.getNote() : '')
        if (n.indexOf(note) >= 0) {
          matches.push(c)
          continue
        }
        var y = headerCellToYMD(c)
        if (y && y === ymd) matches.push(c)
      } catch (e) {
        // ignora coluna com erro de leitura
      }
    }

    // Remove duplicadas (da direita para esquerda).
    if (matches.length <= 0) return null
    matches.sort(function (a, b) {
      return a - b
    })
    var keeperCol = matches[0]

    // Soma valores para a coluna keeper antes de deletar colunas.
    var keeperRange = sheet.getRange(2, keeperCol, lastRow - 1, 1)
    var keeperVals = keeperRange.getValues()

    // Soma e apaga duplicadas da direita para a esquerda.
    // Apagar sempre da direita evita que os índices das colunas do "keeper" mudem.
    for (var j = matches.length - 1; j >= 1; j--) {
      var dupCol = matches[j]
      var dupRange = sheet.getRange(2, dupCol, lastRow - 1, 1)
      var dupVals = dupRange.getValues()

      for (var r = 0; r < keeperVals.length; r++) {
        var a = Number(keeperVals[r][0] || 0)
        var b = Number(dupVals[r][0] || 0)
        var sum = a + b
        keeperVals[r][0] = sum === 0 ? '' : sum
      }

      sheet.deleteColumn(dupCol)
    }

    keeperRange.setValues(keeperVals)
    setYmdNote(keeperCol, ymd)
    return keeperCol
  }

  /**
   * Consolidação completa das colunas de data da aba atual.
   * Mantém a coluna mais à esquerda por dia e remove duplicadas somando valores.
   * Versão local para rodar automaticamente em TODO input.
   */
  function consolidateAllDateColumnsCurrentSheet() {
    var lastCol = getHeaderScanLastCol()
    var lastRow = Math.max(sheet.getLastRow(), 2)
    var firstByDay = {}
    var duplicates = [] // { day, keeperCol, dupCol }

    for (var c = FIRST_DATE_COL; c <= lastCol; c++) {
      var ymd = headerCellToYMD(c)
      if (!ymd) {
        var rawDisplay = sheet.getRange(HEADER_ROW, c).getDisplayValue()
        ymd = canonicalDateKeyFromDisplay(rawDisplay)
      }
      if (!ymd) continue
      if (!firstByDay[ymd]) {
        firstByDay[ymd] = c
        setYmdNote(c, ymd)
      } else {
        duplicates.push({ day: ymd, keeperCol: firstByDay[ymd], dupCol: c })
      }
    }

    for (var i = duplicates.length - 1; i >= 0; i--) {
      var d = duplicates[i]
      var keeperRange = sheet.getRange(2, d.keeperCol, lastRow - 1, 1)
      var dupRange = sheet.getRange(2, d.dupCol, lastRow - 1, 1)
      var keeperVals = keeperRange.getValues()
      var dupVals = dupRange.getValues()

      for (var r = 0; r < keeperVals.length; r++) {
        var a = Number(keeperVals[r][0] || 0)
        var b = Number(dupVals[r][0] || 0)
        var sum = a + b
        keeperVals[r][0] = sum === 0 ? '' : sum
      }
      keeperRange.setValues(keeperVals)
      sheet.deleteColumn(d.dupCol)
    }

    refreshDateIndexFromHeader()
    return duplicates.length
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

  function processOne(rec) {
    // Blindagem máxima: consolida SEMPRE antes de processar cada input.
    consolidateAllDateColumnsCurrentSheet()

    var thisTipo = String(rec.tipo || tipo || 'upsert')
    var thisCodigo = String(rec.codigo_interno || incomingCodigo || '').trim().toLowerCase()
    var thisDescricao = String(rec.descricao || incomingDescricao || '').trim().toLowerCase()
    var thisQtd = Number(rec.quantidade_contada ?? incomingQtd ?? 0)
    if (!thisCodigo || !thisDescricao) return

    incomingCodigo = thisCodigo
    incomingDescricao = thisDescricao
    incomingQtd = thisQtd

    var thisYmd = targetYmd
    if (rec.data_hora_contagem || rec.data_contagem) {
      var thisIso = rec.data_hora_contagem ? instantIsoToYmdInTz(rec.data_hora_contagem, tz) : ''
      var thisClient = incomingStringToYMD(String(rec.data_contagem || ''))
      thisYmd = thisClient || thisIso || targetYmd
    }

    var productRow = findProductRow()

    if (thisTipo === 'clear_qty') {
      // Em exclusão, NUNCA cria coluna nova.
      var clearCol = consolidateColumnsForDay(thisYmd)
      if (!clearCol) clearCol = findDateColumn(thisYmd)
      if (clearCol) {
        writeMappedCol(thisYmd, clearCol)
        if (productRow) sheet.getRange(productRow, clearCol).setValue('')
      }
      return
    }

    // Para upsert/edit, pode garantir/crear coluna do dia se não existir.
    var dateCol = consolidateColumnsForDay(thisYmd)
    if (!dateCol) dateCol = ensureDateColumn(thisYmd)
    if (!dateCol) {
      throw new Error('Coluna da data ' + thisYmd + ' não encontrada. Crie o cabeçalho dessa data e tente novamente.')
    }
    writeMappedCol(thisYmd, dateCol)

    if (thisTipo === 'edit_qty') {
      if (productRow) sheet.getRange(productRow, dateCol).setValue(thisQtd)
      return
    }

    if (!productRow) {
      var newRow = Math.max(sheet.getLastRow(), HEADER_ROW) + 1
      sheet.getRange(newRow, COL_CODIGO).setValue(rec.codigo_interno || thisCodigo)
      sheet.getRange(newRow, COL_DESC).setValue(rec.descricao || thisDescricao)
      sheet.getRange(newRow, dateCol).setValue(thisQtd)
    } else {
      sheet.getRange(productRow, dateCol).setValue(thisQtd)
    }
  }

  if (Array.isArray(data.records) && data.records.length > 0) {
    refreshDateIndexFromHeader()
    for (var k = 0; k < data.records.length; k++) {
      processOne(data.records[k] || {})
    }
    // Garantia final no mesmo request: sai sempre consolidado.
    consolidateAllDateColumnsCurrentSheet()
    return ContentService.createTextOutput(JSON.stringify({ ok: true, processed: data.records.length, version: WEBHOOK_VERSION })).setMimeType(
      ContentService.MimeType.JSON,
    )
  }

  refreshDateIndexFromHeader()
  processOne(data)
  // Garantia final no mesmo request: sai sempre consolidado.
  consolidateAllDateColumnsCurrentSheet()

  return ContentService.createTextOutput(JSON.stringify({ ok: true, version: WEBHOOK_VERSION })).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/**
 * Runner seguro para trigger de tempo.
 * Execute esta função via gatilho para manter a planilha consolidada continuamente.
 */
function consolidarColunasDuplicadasAuto() {
  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(30000)
    consolidarColunasDuplicadas()
  } catch (e) {
    // Não propaga erro para evitar desativação silenciosa do trigger.
    Logger.log('consolidarColunasDuplicadasAuto erro: ' + (e && e.message ? e.message : e))
  } finally {
    try {
      lock.releaseLock()
    } catch (e2) {}
  }
}

/**
 * Instala trigger para rodar a consolidação a cada 1 minuto.
 * Execute manualmente 1x no editor.
 */
function instalarTriggerConsolidacaoMinuto() {
  removerTriggerConsolidacaoMinuto()
  ScriptApp.newTrigger('consolidarColunasDuplicadasAuto').timeBased().everyMinutes(1).create()
}

/**
 * Remove triggers antigos dessa rotina para evitar duplicidade.
 */
function removerTriggerConsolidacaoMinuto() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i]
    if (t.getHandlerFunction && t.getHandlerFunction() === 'consolidarColunasDuplicadasAuto') {
      ScriptApp.deleteTrigger(t)
    }
  }
}

/**
 * Configuração recomendada (execute manualmente 1x):
 * - remove triggers antigos
 * - cria trigger novo a cada 1 minuto
 * - retorna status para conferência
 */
function configurarConsolidacaoAuto() {
  instalarTriggerConsolidacaoMinuto()
  return statusConsolidacaoAuto()
}

/**
 * Diagnóstico rápido dos triggers de consolidação.
 */
function statusConsolidacaoAuto() {
  var triggers = ScriptApp.getProjectTriggers()
  var out = []
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i]
    if (t.getHandlerFunction && t.getHandlerFunction() === 'consolidarColunasDuplicadasAuto') {
      out.push({
        handler: t.getHandlerFunction(),
        eventType: String(t.getEventType ? t.getEventType() : ''),
        uniqueId: String(t.getUniqueId ? t.getUniqueId() : ''),
      })
    }
  }
  Logger.log('statusConsolidacaoAuto: ' + JSON.stringify(out))
  return { ok: true, total: out.length, triggers: out }
}
