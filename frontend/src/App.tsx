import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { readLastListWasInventario, writeLastListScreen } from './lib/checklistVisibleCols'
import type React from 'react'
import './App.css'
import logoUltrapao from './assets/logo-ultrapao.png'
import BaseProdutos from './pages/BaseProdutos'
import ContagemEstoque from './pages/ContagemEstoque'
import LoginScreen from './pages/LoginScreen'
import RelatorioContagem from './pages/RelatorioContagem'
import { isSupabaseConfigured, supabase } from './lib/supabaseClient'

type View = 'home' | 'contagem' | 'relatorio' | 'todas' | 'inventario' | 'baseDados'
type Theme = 'dark' | 'light'

/** Evita tela vazia se algum filho lançar no render; mostra mensagem e opção de recarregar. */
class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Painel]', error.message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            maxWidth: 560,
            margin: '0 auto',
            textAlign: 'left',
            color: 'var(--text, #e5e7eb)',
          }}
        >
          <h2 style={{ color: '#f87171', marginTop: 0 }}>Erro ao exibir esta aba</h2>
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--border, #444)',
              background: 'var(--code-bg, #2a2a2a)',
              color: 'var(--text-h, #fff)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Recarregar página
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const authEnabled = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)

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
    if (!authEnabled) return
    let alive = true
    // Ao abrir o link, sempre começa na tela de login (sem reusar sessão antiga).
    void supabase.auth.signOut().finally(() => {
      if (!alive) return
      setSession(null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, s: Session | null) => {
      if (!alive) return
      setSession(s)
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [authEnabled])

  useEffect(() => {
    if (view === 'contagem' || view === 'inventario') {
      writeLastListScreen(view === 'inventario' ? 'inventario' : 'contagem')
    }
  }, [view])

  /** Último modo de lista (contagem diária vs inventário): em todas as abas do painel só aparece o atalho desse modo. */
  const preferredChecklistView: 'contagem' | 'inventario' = readLastListWasInventario()
    ? 'inventario'
    : 'contagem'
  const showContagemBtn = preferredChecklistView === 'contagem'
  const showInventarioBtn = preferredChecklistView === 'inventario'

  if (authEnabled && !session) {
    return <LoginScreen />
  }

  return (
    <div>
      {view === 'home' ? (
        <div
          className="home-animated-wrap"
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
            className="home-animated-logo"
            src={logoUltrapao}
            alt="Ultra Pão Alimentos"
            style={{ width: 120, height: 'auto', borderRadius: 10, marginBottom: 16 }}
          />
          <h1
            className="home-animated-title"
            style={{ margin: '0 0 12px', fontSize: 'clamp(22px, 5vw, 28px)', color: '#ffd95c' }}
          >
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
            {authEnabled ? (
              <button
                type="button"
                onClick={() => void supabase.auth.signOut()}
                style={{
                  ...homeSecondaryBtnStyle,
                  marginTop: 4,
                  border: '1px solid var(--border, #444)',
                  background: 'transparent',
                  color: 'var(--text, #e5e7eb)',
                }}
                title="Encerra a sessão e volta à tela de login"
              >
                Sair — voltar ao login
              </button>
            ) : null}
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
            {authEnabled && session ? (
              <button
                type="button"
                onClick={() => void supabase.auth.signOut()}
                style={viewNavBtnStyle(false, '#94a3b8')}
                title="Encerrar sessão"
              >
                Sair
              </button>
            ) : null}
          </header>

          {view === 'contagem' ? (
            <PanelErrorBoundary>
              <ContagemEstoque key="contagem" />
            </PanelErrorBoundary>
          ) : view === 'inventario' ? (
            <PanelErrorBoundary>
              <ContagemEstoque key="inventario" inventario />
            </PanelErrorBoundary>
          ) : view === 'baseDados' ? (
            <BaseProdutos key="baseDados" />
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
