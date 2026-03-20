/**
 * Google Apps Script – Web App (implantar como Web app, executar como EU, acesso: Qualquer pessoa)
 * URL de implantação deve terminar em /exec (não use o link do editor /edit).
 *
 * O painel envia o corpo como JSON com Content-Type: text/plain (evita bloqueio CORS no navegador).
 * No doPost, use sempre JSON.parse(e.postData.contents).
 */
function doPost(e) {
  let data
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : '{}'
    data = JSON.parse(raw)
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: 'JSON inválido' }),
    ).setMimeType(ContentService.MimeType.JSON)
  }

  const ss = SpreadsheetApp.openById('1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk')
  const nomeAba = data.aba || 'CONTAGEM DE ESTOQUE FISICA'
  let sheet = ss.getSheetByName(nomeAba)
  if (!sheet) sheet = ss.insertSheet(nomeAba)

  const tipo = String(data.tipo || 'upsert') // upsert | edit_qty | clear_qty

  // Colunas (ordem usada no appendRow antigo):
  // A: data/hora, B: data_contagem (YYYY-MM-DD), C: codigo_interno, D: descricao,
  // E: quantidade_contada, F: up, G: lote, H: observacao, I: conferente.
  const values = sheet.getDataRange().getValues()
  const incomingDataContagem = String(data.data_contagem || '').trim()
  const incomingCodigo = String(data.codigo_interno || '').trim().toLowerCase()
  const incomingDescricao = String(data.descricao || '').trim().toLowerCase()
  const incomingQtd = Number(data.quantidade_contada ?? 0)

  const matches = []
  // começa em 1 para ignorar o cabeçalho (linha 1)
  for (let r = 1; r < values.length; r++) {
    const row = values[r]
    const rowDataContagem = String(row[1] ?? '').trim()
    const rowCodigo = String(row[2] ?? '').trim().toLowerCase()
    const rowDescricao = String(row[3] ?? '').trim().toLowerCase()

    if (rowDataContagem === incomingDataContagem && rowCodigo === incomingCodigo && rowDescricao === incomingDescricao) {
      matches.push(r + 1) // numeração de linha 1-index
    }
  }

  if (matches.length > 0) {
    if (tipo === 'clear_qty') {
      // Limpa apenas a quantidade na planilha (E), sem remover a linha.
      matches.forEach((rowNum) => sheet.getRange(rowNum, 5).setValue(''))
    } else if (tipo === 'edit_qty') {
      // Atualiza somente a quantidade (E) na linha existente.
      const firstRow = matches[0]
      sheet.getRange(firstRow, 5).setValue(incomingQtd)

      // Se houver duplicadas, remove só as duplicadas (para não inflar).
      matches
        .slice(1)
        .sort((a, b) => b - a)
        .forEach((rowNum) => sheet.deleteRow(rowNum))
    } else {
      // upsert (padrão): atualiza a linha e remove duplicadas, mantendo uma única linha.
      const firstRow = matches[0]
      sheet.getRange(firstRow, 1).setValue(data.data_hora_contagem || '')
      sheet.getRange(firstRow, 5).setValue(incomingQtd) // quantidade_contada
      sheet.getRange(firstRow, 6).setValue(data.up ?? '')
      sheet.getRange(firstRow, 7).setValue(data.lote ?? '')
      sheet.getRange(firstRow, 8).setValue(data.observacao ?? '')
      sheet.getRange(firstRow, 9).setValue(data.conferente ?? '')

      matches
        .slice(1)
        .sort((a, b) => b - a)
        .forEach((rowNum) => sheet.deleteRow(rowNum))
    }
  } else {
    // Para edit_qty/clear_qty não vamos criar linha nova.
    // Isso evita “criar outra coluna”/duplicar quando a linha já existe, mas não achamos por detalhe.
    if (tipo === 'upsert') {
      sheet.appendRow([
        data.data_hora_contagem || '',
        data.data_contagem || '',
        data.codigo_interno || '',
        data.descricao || '',
        incomingQtd,
        data.up ?? '',
        data.lote ?? '',
        data.observacao ?? '',
        data.conferente ?? '',
      ])
    } else if (tipo === 'edit_qty') {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: 'Linha não encontrada para edit_qty' }),
      ).setMimeType(ContentService.MimeType.JSON)
    }
    // clear_qty: não faz nada
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON,
  )
}
