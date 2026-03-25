import { useEffect, useState } from 'react'
import type React from 'react'
import './App.css'
import ContagemEstoque from './pages/ContagemEstoque'
import RelatorioContagem from './pages/RelatorioContagem'
import logoUltrapao from './assets/logo-ultrapao.png'

type View = 'home' | 'contagem' | 'relatorio' | 'todas' | 'inventario'
type Theme = 'dark' | 'light'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('ui-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ui-theme', theme)
  }, [theme])

  return (
    <div>
      {view === 'home' ? (
        <div
          style={{
            minHeight: '100svh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 20px 32px',
            boxSizing: 'border-box',
            textAlign: 'center',
          }}
        >
          <img
            src={logoUltrapao}
            alt="Ultra Pão Alimentos"
            style={{ width: 120, height: 'auto', borderRadius: 10, marginBottom: 16 }}
          />
          <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(22px, 5vw, 28px)', color: 'var(--text-h)' }}>
            Painel de Contagem de Estoque
          </h1>
          <p
            style={{
              margin: '0 0 28px',
              fontSize: 14,
              lineHeight: 1.45,
              color: 'var(--text)',
              maxWidth: 420,
            }}
          >
            Escolha <strong>Contagem diária</strong> para registrar no painel com abas, ou{' '}
            <strong>Inventário</strong> (em breve).
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              width: '100%',
              maxWidth: 340,
            }}
          >
            <button
              type="button"
              onClick={() => setView('contagem')}
              style={homePrimaryBtnStyle}
            >
              Contagem diária
            </button>
            <button
              type="button"
              onClick={() => setView('inventario')}
              style={homeSecondaryBtnStyle}
            >
              Inventário
            </button>
          </div>

          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            style={{ ...homeGhostBtnStyle, marginTop: 28 }}
          >
            {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
        </div>
      ) : view === 'inventario' ? (
        <div
          style={{
            minHeight: '100svh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <img
            src={logoUltrapao}
            alt="Ultra Pão Alimentos"
            style={{ width: 72, height: 'auto', borderRadius: 8, marginBottom: 16, opacity: 0.9 }}
          />
          <h2 style={{ margin: '0 0 10px', fontSize: 22, color: 'var(--text-h)' }}>Inventário</h2>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--text)', maxWidth: 380 }}>
            Este módulo será configurado em seguida. Por enquanto, use <strong>Contagem diária</strong> no início.
          </p>
          <button type="button" onClick={() => setView('home')} style={homePrimaryBtnStyle}>
            Voltar ao início
          </button>
        </div>
      ) : (
        <>
          <header
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              flexWrap: 'wrap',
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              marginBottom: 12,
            }}
          >
            <button type="button" onClick={() => setView('home')} style={viewBtnStyle(false)}>
              Início
            </button>
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
            <button
              type="button"
              onClick={() => setView('todas')}
              style={viewBtnStyle(view === 'todas')}
            >
              Todas as contagens
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              style={viewBtnStyle(false)}
            >
              {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            </button>
          </header>

          {view === 'contagem' ? (
            <ContagemEstoque />
          ) : view === 'relatorio' ? (
            <RelatorioContagem key="relatorio" mode="periodo" />
          ) : (
            <RelatorioContagem key="todas" mode="dia" />
          )}
        </>
      )}
    </div>
  )
}

function viewBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--border, #222)',
    background: active ? '#111' : 'transparent',
    color: active ? '#fff' : 'var(--text-h)',
    cursor: 'pointer',
  }
}

const homePrimaryBtnStyle: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  border: '1px solid var(--border, #333)',
  background: 'var(--code-bg, #111)',
  color: 'var(--text-h, #fff)',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
}

const homeSecondaryBtnStyle: React.CSSProperties = {
  ...homePrimaryBtnStyle,
  background: 'transparent',
  color: 'var(--text-h)',
  fontWeight: 500,
}

const homeGhostBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
}
