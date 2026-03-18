import { useState } from 'react'
import type React from 'react'
import './App.css'
import ContagemEstoque from './pages/ContagemEstoque'
import RelatorioContagem from './pages/RelatorioContagem'

type View = 'contagem' | 'relatorio'

export default function App() {
  const [view, setView] = useState<View>('contagem')

  return (
    <div>
      <div style={{ padding: '14px 16px', textAlign: 'center' }}>
        <h1 style={{ margin: '8px 0 4px', fontSize: 26 }}>Painel de Contagem de Estoque</h1>
        <div style={{ color: 'var(--text)', fontSize: 13 }}>
          Selecione a opção acima para cadastrar as contagens ou visualizar o relatório completo.
        </div>
      </div>

      <header
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={() => setView('contagem')}
          style={viewBtnStyle(view === 'contagem')}
        >
          Contagem
        </button>
        <button
          type="button"
          onClick={() => setView('relatorio')}
          style={viewBtnStyle(view === 'relatorio')}
        >
          Relatório completo
        </button>
      </header>

      {view === 'contagem' ? <ContagemEstoque /> : <RelatorioContagem />}
    </div>
  )
}

function viewBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #222',
    background: active ? '#111' : 'transparent',
    color: active ? 'white' : 'var(--text-h)',
    cursor: 'pointer',
  }
}
