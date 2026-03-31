/**
 * Referência: mudanças no Google Apps Script do webhook (planilha).
 *
 * Problema: em clear_qty o código fazia setValue(0), então a planilha mostrava 0
 * em vez de célula vazia — desalinhado com o Postgres (clear_qty = limpar célula).
 *
 * Veja também: supabase/functions/sheet-outbox-sync (campo quantidade_contada_text).
 */

// Versão sugerida (troque a constante no topo do seu script):
// var WEBHOOK_VERSION = 'no-auto-create-v3-clear-empty'

// =====================================================================
// Em processOne(rec): substituir a atribuição única thisQtd por:
// =====================================================================
//    var thisQtd = 0
//    if (
//      rec.quantidade_contada_text !== undefined &&
//      rec.quantidade_contada_text !== null &&
//      String(rec.quantidade_contada_text).trim() !== ''
//    ) {
//      thisQtd = Number(String(rec.quantidade_contada_text).replace(',', '.'))
//    } else if (rec.quantidade_contada !== undefined && rec.quantidade_contada !== null) {
//      thisQtd = Number(rec.quantidade_contada)
//    } else {
//      thisQtd = Number(incomingQtd ?? 0)
//    }
//    if (!Number.isFinite(thisQtd)) thisQtd = 0
//
// E remover a linha antiga:
//    var thisQtd = Number(rec.quantidade_contada ?? incomingQtd ?? 0)

// =====================================================================
// Em processOne(rec): substituir o bloco if (thisTipo === 'clear_qty') por:
// =====================================================================
//    if (thisTipo === 'clear_qty') {
//      var clearCol = consolidateColumnsForDayNoSum(thisYmd)
//      if (!clearCol) clearCol = findDateColumn(thisYmd)
//      if (clearCol) {
//        writeMappedCol(thisYmd, clearCol)
//        if (productRow) {
//          sheet.getRange(productRow, clearCol).clearContent()
//        }
//      }
//      return
//    }
