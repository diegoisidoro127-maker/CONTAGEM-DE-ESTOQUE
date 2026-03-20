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

  // Ajuste as colunas conforme sua planilha (ex.: A= data/hora, B=código, …)
  sheet.appendRow([
    data.data_hora_contagem || '',
    data.data_contagem || '',
    data.codigo_interno || '',
    data.descricao || '',
    data.quantidade_contada ?? '',
    data.up ?? '',
    data.lote ?? '',
    data.observacao ?? '',
    data.conferente || '',
  ])

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON,
  )
}
