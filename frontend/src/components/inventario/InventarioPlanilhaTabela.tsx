import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type { OfflineChecklistItem } from '../../lib/offlineContagemSession'
import { isVencimentoAntesFabricacao } from '../../lib/contagemDatasValidacao'
import {
  CHECKLIST_QTY_NAV_ATTR,
  handleChecklistFieldNavKeyDown,
} from '../../lib/checklistFieldNavigation'
import { ChecklistQtyCalcButton } from '../ChecklistCalculatorModal'
import { getInventarioRuaArmazem, inventarioArmazemPosNivel } from './inventarioPlanilhaModel'

export type ChecklistEditDraft = {
  codigo_interno: string
  descricao: string
  quantidade_contada: string
}

export type InventarioPlanilhaTabelaProps = {
  items: OfflineChecklistItem[]
  armazemItemsSorted: OfflineChecklistItem[]
  armazemContagem: number | null
  planilhaQtdContagemHeader: string
  showChecklistColumn: (id: string) => boolean
  thStyle: CSSProperties
  tdStyle: CSSProperties
  buttonStyle: CSSProperties
  checklistQtdInputStyle: CSSProperties
  checklistEditingKey: string | null
  checklistEditDraft: ChecklistEditDraft | null
  setChecklistEditDraft: Dispatch<SetStateAction<ChecklistEditDraft | null>>
  checklistSavedFlashKey: string | null
  saveChecklistEdit: () => void
  cancelChecklistEdit: () => void
  openChecklistEdit: (it: OfflineChecklistItem) => void
  updateOfflineItemFields: (key: string, patch: Partial<OfflineChecklistItem>) => void
  updateOfflineItemQty: (key: string, value: string) => void
  handleLimparQuantidadeOffline: (key: string) => void
  openPhotoModalForCodigo: (codigo: string) => void
  removePhotoFromChecklistItem: (it: OfflineChecklistItem) => void
  /** Modo planilha em branco: ao sair do campo código, preenche descrição a partir do cadastro. */
  onPlanilhaCodigoBlur?: (key: string, codigo: string) => void
  /** Nome do conferente da sessão (mesmo em todas as linhas). */
  conferenteLabel: string
  /** Rodada selecionada (1–4): preenche a coluna de quantidade quando o campo está vazio. */
  inventarioNumeroContagemRodada: 1 | 2 | 3 | 4
  /** Abre calculadora para inserir o resultado na quantidade da linha em edição / visualização. */
  openQtyCalculator?: (onApply: (value: string) => void, productHint?: string) => void
}

/**
 * Tabela HTML só do inventário físico no modo armazém (colunas como na planilha Excel).
 * A checklist de contagem diária / tabela clássica fica em `ContagemEstoque`.
 */
export function InventarioPlanilhaTabela(props: InventarioPlanilhaTabelaProps) {
  const {
    items,
    armazemItemsSorted,
    armazemContagem,
    planilhaQtdContagemHeader,
    showChecklistColumn,
    thStyle,
    tdStyle,
    buttonStyle,
    checklistQtdInputStyle,
    checklistEditingKey,
    checklistEditDraft,
    setChecklistEditDraft,
    checklistSavedFlashKey,
    saveChecklistEdit,
    cancelChecklistEdit,
    openChecklistEdit,
    updateOfflineItemFields,
    updateOfflineItemQty,
    handleLimparQuantidadeOffline,
    openPhotoModalForCodigo,
    removePhotoFromChecklistItem,
    onPlanilhaCodigoBlur,
    conferenteLabel,
    inventarioNumeroContagemRodada,
    openQtyCalculator,
  } = props

  const qtdPlanilhaRodada = (it: OfflineChecklistItem) => {
    const t = String(it.quantidade_contada ?? '').trim()
    return t === '' ? String(inventarioNumeroContagemRodada) : t
  }

  const ruaPlanilha = getInventarioRuaArmazem(armazemContagem)

  /** Texto amarelo no painel da planilha + cabeçalho congelado ao rolar. */
  const corPainelAmarelo = '#fff59d'
  const thPlanilha: CSSProperties = {
    ...thStyle,
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: '#4a4a1c',
    color: corPainelAmarelo,
    borderBottom: '1px solid rgba(255, 235, 59, 0.35)',
    boxShadow: '0 1px 0 rgba(0,0,0,.2)',
  }
  const tdPlanilha: CSSProperties = {
    ...tdStyle,
    color: corPainelAmarelo,
    borderBottom: '1px solid rgba(255, 235, 59, 0.12)',
  }
  const inputPlanilha: CSSProperties = {
    ...checklistQtdInputStyle,
    color: corPainelAmarelo,
    background: 'rgba(0,0,0,0.28)',
    borderColor: 'rgba(255, 235, 59, 0.45)',
  }
  const tdPlanilhaQtd: CSSProperties = {
    ...tdPlanilha,
    whiteSpace: 'normal',
    verticalAlign: 'top',
    minWidth: 200,
    overflow: 'visible',
  }
  const planilhaQtdCellWrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    maxWidth: 220,
  }
  const inputPlanilhaQtdCell: CSSProperties = {
    ...inputPlanilha,
    width: '100%',
    maxWidth: 200,
    minWidth: 0,
  }

  return (
    <div
      style={{
        overflow: 'auto',
        overflowX: 'auto',
        maxHeight: 'min(72vh, 640px)',
        marginTop: 0,
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1660 }}>
        <thead>
          <tr>
            <th style={thPlanilha}>RUA</th>
            <th style={thPlanilha}>POS</th>
            <th style={thPlanilha}>NIVEL</th>
            {showChecklistColumn('conferente') ? <th style={thPlanilha}>Conferente</th> : null}
            <th style={thPlanilha}>CÓDIGO</th>
            <th style={thPlanilha}>DESCRIÇÃO</th>
            {showChecklistColumn('unidade') ? <th style={thPlanilha}>UNIDADE</th> : null}
            {showChecklistColumn('quantidade') ? (
              <th style={thPlanilha}>{planilhaQtdContagemHeader}</th>
            ) : null}
            {showChecklistColumn('data_fabricacao') ? <th style={thPlanilha}>FABRICAÇÃO</th> : null}
            {showChecklistColumn('data_validade') ? <th style={thPlanilha}>VENCIMENTO</th> : null}
            {showChecklistColumn('lote') ? <th style={thPlanilha}>LOTE</th> : null}
            {showChecklistColumn('up') ? <th style={thPlanilha}>UP</th> : null}
            {showChecklistColumn('observacao') ? <th style={thPlanilha}>Observação</th> : null}
            {showChecklistColumn('ean') ? <th style={thPlanilha}>EAN</th> : null}
            {showChecklistColumn('dun') ? <th style={thPlanilha}>DUN</th> : null}
            {showChecklistColumn('foto') ? <th style={thPlanilha}>Foto</th> : null}
            {showChecklistColumn('acoes') ? <th style={thPlanilha}>Ações</th> : null}
          </tr>
        </thead>
        <tbody data-checklist-nav-root onKeyDown={handleChecklistFieldNavKeyDown}>
          {items.map((it) => {
            const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
            const isEditing = checklistEditingKey === it.key && checklistEditDraft
            const pn =
              armazemItemsSorted.length > 0 ? inventarioArmazemPosNivel(armazemItemsSorted, it) : { pos: 0, nivel: 0 }
            const datasOrdemInvalida = isVencimentoAntesFabricacao(it.data_fabricacao, it.data_validade)
            return (
              <tr
                key={it.key}
                style={
                  datasOrdemInvalida
                    ? {
                        background: 'rgba(120, 20, 20, 0.42)',
                        boxShadow: 'inset 0 0 0 1px rgba(255, 120, 120, 0.5)',
                      }
                    : undefined
                }
              >
                {isEditing && checklistEditDraft ? (
                  <>
                    <td style={tdPlanilha}>{ruaPlanilha}</td>
                    <td style={tdPlanilha}>{pn.pos}</td>
                    <td style={tdPlanilha}>{pn.nivel}</td>
                    {showChecklistColumn('conferente') ? (
                      <td style={{ ...tdPlanilha, maxWidth: 140 }} title="Conferente da sessão">
                        {conferenteLabel}
                      </td>
                    ) : null}
                    <td style={tdPlanilha}>
                      <input
                        value={checklistEditDraft.codigo_interno}
                        onChange={(e) =>
                          setChecklistEditDraft((d) => (d ? { ...d, codigo_interno: e.target.value } : d))
                        }
                        onBlur={() => onPlanilhaCodigoBlur?.(it.key, checklistEditDraft.codigo_interno)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                        style={{ ...inputPlanilha, width: '100%', minWidth: 100 }}
                        aria-label="Código do produto"
                      />
                    </td>
                    <td style={{ ...tdPlanilha, whiteSpace: 'normal', maxWidth: 420 }}>
                      <textarea
                        value={checklistEditDraft.descricao}
                        onChange={(e) =>
                          setChecklistEditDraft((d) => (d ? { ...d, descricao: e.target.value } : d))
                        }
                        rows={2}
                        style={{
                          ...inputPlanilha,
                          width: '100%',
                          minWidth: 160,
                          resize: 'vertical',
                          fontFamily: 'inherit',
                        }}
                        aria-label="Descrição"
                      />
                    </td>
                    {showChecklistColumn('unidade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.unidade_medida ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 72, minWidth: 56 }}
                          placeholder="—"
                          aria-label="Unidade de medida"
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('quantidade') ? (
                      <td style={tdPlanilhaQtd}>
                        <div style={planilhaQtdCellWrap}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              String(checklistEditDraft.quantidade_contada ?? '').trim() === ''
                                ? String(inventarioNumeroContagemRodada)
                                : checklistEditDraft.quantidade_contada
                            }
                            onChange={(e) =>
                              setChecklistEditDraft((d) =>
                                d ? { ...d, quantidade_contada: e.target.value } : d,
                              )
                            }
                            {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                            style={inputPlanilhaQtdCell}
                            placeholder="—"
                            aria-label="Quantidade"
                          />
                          {openQtyCalculator ? (
                            <ChecklistQtyCalcButton
                              buttonStyle={buttonStyle}
                              onClick={() =>
                                openQtyCalculator(
                                  (v) =>
                                    setChecklistEditDraft((d) => (d ? { ...d, quantidade_contada: v } : d)),
                                  `${checklistEditDraft.codigo_interno} — ${checklistEditDraft.descricao}`,
                                )
                              }
                            />
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                    {showChecklistColumn('data_fabricacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_fabricacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de fabricação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('data_validade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_validade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_validade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de vencimento ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('lote') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.lote ?? ''}
                          onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 88 }}
                          placeholder="—"
                          aria-label={`Lote ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('up') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.up_quantidade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { up_quantidade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: '100%', minWidth: 72 }}
                          placeholder="—"
                          aria-label={`UP ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('observacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.observacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { observacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 180 }}
                          placeholder="—"
                          aria-label={`Observação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('ean') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.ean ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              ean: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 130, minWidth: 100 }}
                          placeholder="—"
                          aria-label={`EAN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('dun') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.dun ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              dun: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 130, minWidth: 100 }}
                          placeholder="—"
                          aria-label={`DUN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('foto') ? (
                      <td style={tdPlanilha}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td>
                    ) : null}
                    {showChecklistColumn('acoes') ? (
                      <td style={{ ...tdPlanilha, whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#0b5', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => saveChecklistEdit()}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => cancelChecklistEdit()}
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </>
                ) : (
                  <>
                    <td style={tdPlanilha}>{ruaPlanilha}</td>
                    <td style={tdPlanilha}>{pn.pos}</td>
                    <td style={tdPlanilha}>{pn.nivel}</td>
                    {showChecklistColumn('conferente') ? (
                      <td style={{ ...tdPlanilha, maxWidth: 140 }} title="Conferente da sessão">
                        {conferenteLabel}
                      </td>
                    ) : null}
                    <td style={tdPlanilha}>
                      {onPlanilhaCodigoBlur ? (
                        <input
                          value={it.codigo_interno}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { codigo_interno: e.target.value })
                          }
                          onBlur={() => onPlanilhaCodigoBlur(it.key, it.codigo_interno)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 100 }}
                          placeholder="Digite o código"
                          aria-label="Código do produto"
                        />
                      ) : (
                        <>
                          {it.codigo_interno}
                          {it.inventario_repeticao ? (
                            <span style={{ marginLeft: 6, fontSize: 11, color: '#0a7', fontWeight: 700 }}>
                              ({it.inventario_repeticao}ª)
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td style={{ ...tdPlanilha, whiteSpace: 'normal', maxWidth: 420 }}>{it.descricao}</td>
                    {showChecklistColumn('unidade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.unidade_medida ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 72, minWidth: 56 }}
                          placeholder="—"
                          aria-label={`Unidade ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('quantidade') ? (
                      <td style={tdPlanilhaQtd}>
                        <div style={planilhaQtdCellWrap}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={qtdPlanilhaRodada(it)}
                            onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                            {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                            style={inputPlanilhaQtdCell}
                            placeholder="—"
                            aria-label={`Quantidade ${it.codigo_interno}${it.inventario_repeticao ? ` ${it.inventario_repeticao}ª` : ''}`}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {openQtyCalculator ? (
                              <ChecklistQtyCalcButton
                                buttonStyle={buttonStyle}
                                onClick={() =>
                                  openQtyCalculator(
                                    (v) => updateOfflineItemQty(it.key, v),
                                    `${it.codigo_interno} — ${it.descricao}`,
                                  )
                                }
                              />
                            ) : null}
                            {checklistSavedFlashKey === it.key ? (
                              <span style={{ fontSize: 11, color: '#0a0', fontWeight: 700 }}>Salvo</span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    ) : null}
                    {showChecklistColumn('data_fabricacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_fabricacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_fabricacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de fabricação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('data_validade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_validade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_validade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de vencimento ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('lote') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.lote ?? ''}
                          onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 88 }}
                          placeholder="—"
                          aria-label={`Lote ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('up') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.up_quantidade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { up_quantidade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: '100%', minWidth: 72 }}
                          placeholder="—"
                          aria-label={`UP ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('observacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.observacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { observacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 180 }}
                          placeholder="—"
                          aria-label={`Observação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('ean') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.ean ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              ean: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 130, minWidth: 100 }}
                          placeholder="—"
                          aria-label={`EAN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('dun') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.dun ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              dun: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 130, minWidth: 100 }}
                          placeholder="—"
                          aria-label={`DUN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('foto') ? (
                      <td style={tdPlanilha}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td>
                    ) : null}
                    {showChecklistColumn('acoes') ? (
                      <td style={{ ...tdPlanilha, whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => openChecklistEdit(it)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => handleLimparQuantidadeOffline(it.key)}
                          >
                            Limpar
                          </button>
                          <button
                            type="button"
                            style={{
                              ...buttonStyle,
                              background: hasPhoto ? '#0b5' : '#444',
                              fontSize: 12,
                              padding: '6px 10px',
                            }}
                            onClick={() => openPhotoModalForCodigo(it.codigo_interno)}
                            title={hasPhoto ? 'Ver/atualizar foto' : 'Anexar foto'}
                          >
                            {hasPhoto ? 'Foto (ok)' : 'Sem foto'}
                          </button>
                          {hasPhoto ? (
                            <button
                              type="button"
                              style={{ ...buttonStyle, background: '#a85a00', fontSize: 12, padding: '6px 10px' }}
                              onClick={() => removePhotoFromChecklistItem(it)}
                              title="Remover foto anexada"
                            >
                              Remover foto
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** @deprecated Use `InventarioPlanilhaTabela` */
export const InventarioPlanilhaArmazemDesktopTable = InventarioPlanilhaTabela
export type InventarioPlanilhaArmazemDesktopTableProps = InventarioPlanilhaTabelaProps
