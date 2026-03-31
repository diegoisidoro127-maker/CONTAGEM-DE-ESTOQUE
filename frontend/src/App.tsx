import { useEffect, useState } from 'react'
import { readLastListWasInventario, writeLastListScreen } from './lib/checklistVisibleCols'
import type React from 'react'
import './App.css'
import BaseProdutos from './pages/BaseProdutos'
import ContagemEstoque from './pages/ContagemEstoque'
import RelatorioContagem from './pages/RelatorioContagem'
import logoUltrapao from './assets/logo-ultrapao.png'

type View = 'home' | 'contagem' | 'relatorio' | 'todas' | 'inventario' | 'baseDados'
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

  useEffect(() => {
    if (view === 'contagem' || view === 'inventario') {
      writeLastListScreen(view === 'inventario' ? 'inventario' : 'contagem')
    }
  }, [view])

  // Na Base de dados, mostra só um atalho (último modo usado: contagem ou inventário).
  const preferredChecklistView: 'contagem' | 'inventario' = readLastListWasInventario()
    ? 'inventario'
    : 'contagem'
  const showContagemBtn = view === 'baseDados' ? preferredChecklistView === 'contagem' : view !== 'inventario'
  const showInventarioBtn = view === 'baseDados' ? preferredChecklistView === 'inventario' : view !== 'contagem'

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
          <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(22px, 5vw, 28px)', color: '#ffd95c' }}>
            Painel de Contagem de Estoque
          </h1>
          <p
            style={{
              margin: '0 0 28px',
              fontSize: 14,
              lineHeight: 1.45,
              color: '#ffd95c',
              maxWidth: 420,
            }}
          >
            Escolha <strong>Contagem diária</strong> ou <strong>Inventário</strong> (mesmas abas do painel; no inventário cada produto aparece três vezes na lista).
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
            <button
              type="button"
              onClick={() => setView('home')}
              style={viewNavBtnStyle(false, NAV_ACCENT.inicio)}
            >
              <NavIcon emoji="🏠" anim="pulse" />
              Início
            </button>
            {showContagemBtn ? (
              <button
                type="button"
                onClick={() => setView('contagem')}
                style={viewNavBtnStyle(view === 'contagem', NAV_ACCENT.contagem)}
              >
                <NavIcon emoji="📋" anim="bounce" />
                Contagem
              </button>
            ) : null}
            {showInventarioBtn ? (
              <button
                type="button"
                onClick={() => setView('inventario')}
                style={viewNavBtnStyle(view === 'inventario', NAV_ACCENT.inventario)}
              >
                <NavIcon emoji="📦" anim="float" />
                Inventário
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setView('relatorio')}
              style={viewNavBtnStyle(view === 'relatorio', NAV_ACCENT.relatorio)}
            >
              <NavIcon emoji="📊" anim="glow" />
              Relatório completo
            </button>
            <button
              type="button"
              onClick={() => setView('todas')}
              style={viewNavBtnStyle(view === 'todas', NAV_ACCENT.todas)}
            >
              <NavIcon emoji="📑" anim="bounce" />
              Todas as contagens
            </button>
            <button
              type="button"
              onClick={() => setView('baseDados')}
              style={viewNavBtnStyle(view === 'baseDados', NAV_ACCENT.base)}
            >
              <NavIcon emoji="🗄️" anim="pulse" />
              Base de dados
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              style={viewNavBtnStyle(false, NAV_ACCENT.tema)}
            >
              <NavIcon emoji={theme === 'dark' ? '☀️' : '🌙'} anim="tilt" />
              {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            </button>
          </header>

          {view === 'contagem' ? (
            <ContagemEstoque key="contagem" />
          ) : view === 'inventario' ? (
            <ContagemEstoque key="inventario" inventario />
          ) : view === 'baseDados' ? (
            <BaseProdutos key="baseDados" />
          ) : view === 'relatorio' ? (
            <RelatorioContagem
              key="relatorio"
              mode="periodo"
              listColumnPrefsInventario={readLastListWasInventario()}
            />
          ) : (
            <RelatorioContagem
              key="todas"
              mode="dia"
              listColumnPrefsInventario={readLastListWasInventario()}
            />
          )}
        </>
      )}
    </div>
  )
}

/** Cores dos títulos da barra (claro + escuro). */
const NAV_ACCENT = {
  inicio: '#ffd95c',
  contagem: '#4f8eff',
  inventario: '#26c6da',
  relatorio: '#c084fc',
  todas: '#66bb6a',
  base: '#ffb74d',
  tema: '#ffd95c',
} as const

type NavIconAnim = 'pulse' | 'bounce' | 'float' | 'glow' | 'tilt'

function NavIcon({ emoji, anim }: { emoji: string; anim: NavIconAnim }) {
  return (
    <span className={`app-nav-icon app-nav-icon--${anim}`} aria-hidden>
      {emoji}
    </span>
  )
}

function navActiveTextColor(accent: string): string {
  if (accent === '#ffd95c' || accent === '#ffb74d') return '#141109'
  return '#ffffff'
}

function viewNavBtnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: `1px solid ${active ? accent : 'var(--border, #222)'}`,
    background: active ? accent : 'transparent',
    color: active ? navActiveTextColor(accent) : accent,
    cursor: 'pointer',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  }
}

const homePrimaryBtnStyle: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  border: '1px solid #dca900',
  background: 'linear-gradient(180deg, #ffd95c 0%, #e6b400 100%)',
  color: '#1a1300',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
}

const homeSecondaryBtnStyle: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  border: '1px solid #1b6eff',
  background: 'linear-gradient(180deg, #45a6ff 0%, #1b6eff 100%)',
  color: '#f5fbff',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
}

const homeGhostBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: '#ffd95c',
  fontSize: 13,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
}
