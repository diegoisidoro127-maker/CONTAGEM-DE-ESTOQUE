import { useState, type FormEvent } from 'react'
import logoUltrapao from '../assets/logo-ultrapao.png'
import { supabase } from '../lib/supabaseClient'
import './LoginScreen.css'

/** Domínio usado para montar o e-mail do Auth a partir do nome de usuário no cadastro. */
const AUTH_EMAIL_DOMAIN = 'ultrapao.com.br'

function resolveAuthEmail(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (t.includes('@')) return t
  return `${t}@${AUTH_EMAIL_DOMAIN}`
}

function EyeOpenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeClosedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

type PasswordFieldProps = {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  disabled: boolean
  show: boolean
  onToggleShow: () => void
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  show,
  onToggleShow,
}: PasswordFieldProps) {
  return (
    <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-h, #f3f4f6)' }}>
        {label}
      </span>
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 44px 12px 12px',
            borderRadius: 10,
            border: '1px solid var(--border, #444)',
            background: 'var(--code-bg, #1f2028)',
            color: 'var(--text-h, #fff)',
            fontSize: 16,
          }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          disabled={disabled}
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          title={show ? 'Ocultar senha' : 'Mostrar senha'}
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            padding: 8,
            border: 'none',
            background: 'transparent',
            color: 'var(--text, #9ca3af)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
          }}
        >
          {show ? <EyeClosedIcon /> : <EyeOpenIcon />}
        </button>
      </div>
    </label>
  )
}

function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
    return 'Usuário ou senha incorretos.'
  }
  if (m.includes('email not confirmed')) {
    return 'Confirme seu e-mail (link enviado pelo sistema) antes de entrar.'
  }
  if (m.includes('user already registered')) {
    return 'Este usuário já está cadastrado. Use Entrar ou recuperação de senha no Supabase.'
  }
  if (m.includes('password')) {
    return 'Senha inválida. Use pelo menos 6 caracteres (regra do Supabase).'
  }
  return message || 'Não foi possível concluir. Tente novamente.'
}

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const resetMessages = () => {
    setError(null)
    setInfo(null)
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    resetMessages()
    const authEmail = resolveAuthEmail(email)
    if (!authEmail || !password) {
      setError('Preencha usuário e senha.')
      return
    }
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      })
      if (err) setError(mapAuthError(err.message))
    } catch (unknownErr) {
      setError(unknownErr instanceof Error ? unknownErr.message : 'Erro ao entrar.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    resetMessages()
    if (!email.trim() || !password) {
      setError('Preencha o nome de usuário e a senha.')
      return
    }
    const authEmail = resolveAuthEmail(email)
    if (!authEmail) {
      setError('Nome de usuário inválido.')
      return
    }
    if (password !== passwordConfirm) {
      setError('As senhas não coincidem.')
      return
    }
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    setLoading(true)
    try {
      const nomeUsuario = email.includes('@') ? email.trim().split('@')[0]! : email.trim()
      const { error: err } = await supabase.auth.signUp({
        email: authEmail,
        password,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          data: { nome: nomeUsuario },
        },
      })
      if (err) {
        setError(mapAuthError(err.message))
        return
      }
      setInfo(
        'Cadastro enviado. Se o projeto exige confirmação por e-mail, abra a caixa de entrada e clique no link antes de entrar.',
      )
      setMode('login')
      setPasswordConfirm('')
    } catch (unknownErr) {
      setError(unknownErr instanceof Error ? unknownErr.message : 'Erro ao cadastrar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px 40px',
        boxSizing: 'border-box',
        background: 'var(--bg, #16171d)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '28px 24px 32px',
          borderRadius: 16,
          border: '1px solid var(--border, #2e303a)',
          background: 'var(--code-bg, #1f2028)',
          boxShadow: 'var(--shadow, 0 12px 40px rgba(0,0,0,.35))',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img className="login-screen-logo" src={logoUltrapao} alt="Ultra Pão Alimentos" />
          <h1 style={{ margin: 0, fontSize: 'clamp(20px, 4vw, 24px)', color: '#ffd95c', fontWeight: 700 }}>
            Painel de Contagem de Estoque
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--text, #9ca3af)', lineHeight: 1.45 }}>
            {mode === 'login' ? 'Entre com seu usuário e senha' : 'Crie sua conta com nome de usuário e senha'}
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(127, 29, 29, 0.35)',
              border: '1px solid #b91c1c',
              color: '#fecaca',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(22, 101, 52, 0.35)',
              border: '1px solid #15803d',
              color: '#bbf7d0',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {info}
          </div>
        ) : null}

        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-h, #f3f4f6)' }}>
              {mode === 'register' ? 'Nome de usuário' : 'Usuário'}
            </span>
            <input
              type="text"
              autoComplete="username"
              value={email}
              disabled={loading}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ex.: diego.isidoro"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 12px',
                borderRadius: 10,
                border: '1px solid var(--border, #444)',
                background: 'var(--bg, #16171d)',
                color: 'var(--text-h, #fff)',
                fontSize: 16,
              }}
            />
            {mode === 'register' ? (
              <span
                style={{
                  display: 'block',
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--text, #9ca3af)',
                  lineHeight: 1.35,
                }}
              >
                O acesso será registrado como <strong style={{ color: 'var(--text-h, #e5e7eb)' }}>usuário@{AUTH_EMAIL_DOMAIN}</strong>
                .
              </span>
            ) : null}
          </label>

          <PasswordField
            id="auth-password"
            label="Senha"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={loading}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
          />

          {mode === 'register' ? (
            <PasswordField
              id="register-password-confirm"
              label="Confirmar senha"
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              autoComplete="new-password"
              disabled={loading}
              show={showPasswordConfirm}
              onToggleShow={() => setShowPasswordConfirm((v) => !v)}
            />
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '14px 18px',
              borderRadius: 10,
              border: '1px solid #dca900',
              background: 'linear-gradient(180deg, #ffd95c 0%, #e6b400 100%)',
              color: '#1a1300',
              fontSize: 16,
              fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.85 : 1,
            }}
          >
            {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Cadastrar'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          {mode === 'login' ? (
            <button
              type="button"
              onClick={() => {
                resetMessages()
                setMode('register')
              }}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: '#4f8eff',
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Não tem conta? Cadastre-se
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                resetMessages()
                setMode('login')
                setPasswordConfirm('')
              }}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #9ca3af)',
                fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Já tenho conta — entrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
