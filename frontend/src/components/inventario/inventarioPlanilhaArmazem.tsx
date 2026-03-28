import type { Dispatch, SetStateAction } from 'react'
import { inventarioAbaTitulo } from './inventarioPlanilhaModel'

export { inventarioAbaTitulo, filtrarItensPlanilhaInventario } from './inventarioPlanilhaModel'

export {
  InventarioPlanilhaTabela,
  InventarioPlanilhaArmazemDesktopTable,
  type ChecklistEditDraft,
  type InventarioPlanilhaTabelaProps,
  type InventarioPlanilhaArmazemDesktopTableProps,
} from './InventarioPlanilhaTabela'

type ArmazemGrupoTab = { contagem: number }

/** Abas do inventário (uma página = uma “aba” como na planilha). */
export function InventarioPlanilhaAbas(props: {
  armazemGrupos: ArmazemGrupoTab[]
  checklistPageSafe: number
  setChecklistPage: Dispatch<SetStateAction<number>>
}) {
  const { armazemGrupos, checklistPageSafe, setChecklistPage } = props
  return (
    <div style={{ marginTop: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text, #888)', marginBottom: 8 }}>
        Abas (como na planilha de inventário — uma aba por página)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {armazemGrupos.map((g, i) => {
          const active = checklistPageSafe === i + 1
          return (
            <button
              key={g.contagem}
              type="button"
              onClick={() => setChecklistPage(i + 1)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: active ? '2px solid var(--border, #ccc)' : '1px solid var(--border, #666)',
                background: active ? 'rgba(255,255,255,.1)' : 'transparent',
                color: 'var(--text, #eee)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 800 : 600,
                maxWidth: 300,
                textAlign: 'left',
              }}
            >
              {inventarioAbaTitulo(g.contagem)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
