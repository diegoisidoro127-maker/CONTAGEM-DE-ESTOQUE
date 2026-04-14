import { useState, useEffect, type FormEvent } from 'react'
import logoUltrapao from '../assets/logo-ultrapao.png'
import { supabase } from '../lib/supabaseClient'
import './LoginScreen.css'

/**
 * O gateway das Edge Functions pode exigir JWT (verify_jwt). Sem sessão de utilizador,
 * enviamos o JWT anónimo do projeto — é o mesmo valor de VITE_SUPABASE_ANON_KEY (já público no front).
 * Isto evita 401 no preflight/POST quando verify_jwt não foi desligado no painel.
 */
function edgeInvokeOptions(): { headers?: Record<string, string> } {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!anon) return {}
  return { headers: { Authorization: `Bearer ${anon}` } }
}

/** Normaliza o login: minusculas, sem @ (e-mail fica só no servidor). */
function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

function isValidUsernameFormat(u: string): boolean {
  if (u.length < 2 || u.includes('@')) return false
  return /^[a-z0-9._-]+$/.test(u)
}

/**
 * Grava a senha em texto na linha de `public.usuarios` para aparecer no Table Editor.
 * O login continua pelo Auth (hash em auth.users). Uso interno apenas — risco se o banco vazar.
 */
async function mirrorSenhaPlainToUsuarios(userId: string, plainPassword: string) {
  const { error } = await supabase.from('usuarios').update({ senha: plainPassword }).eq('id', userId)
  if (error && import.meta.env.DEV) console.warn('[usuarios.senha]', error.message)
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

/** Supabase / GoTrue pode devolver vários textos para limite de taxa. */
function isRateLimitedMessage(message: string | undefined | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('rate limit') ||
    m.includes('too many') ||
    m.includes('over_email_send') ||
    m.includes('email rate limit') ||
    m.includes('429') ||
    m.includes('throttl')
  )
}

function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (isRateLimitedMessage(message)) {
    return 'Não foi possível concluir agora. Tente de novo em instantes.'
  }
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
    return 'Usuário ou senha incorretos.'
  }
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
    return 'Conta ainda não liberada no servidor. Tente de novo ou peça suporte.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Este usuário já existe. Use Entrar.'
  }
  if (m.includes('password')) {
    return 'Senha inválida. Use pelo menos 6 caracteres.'
  }
  return message || 'Não foi possível concluir. Tente novamente.'
}

type FnAuthPayload = {
  ok?: boolean
  error?: string
  access_token?: string
  refresh_token?: string
} | null

/** Rede / CORS / função ausente: o cliente Supabase costuma devolver isto quando o preflight OPTIONS falha (ex.: verify_jwt ligado no gateway). */
function mapInvokeTransportError(message: string | undefined): string | null {
  if (!message) return null
  const m = message.toLowerCase()
  if (
    m.includes('failed to send') ||
    m.includes('edge function') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('err_failed')
  ) {
    return (
      'Servidor Supabase não respondeu à função Edge (rede ou CORS). ' +
      'Publique login-username e register-username e use verify_jwt = false (supabase/config.toml). ' +
      'No painel: Edge Functions → cada função → desative exigir JWT para chamadas sem login.'
    )
  }
  return null
}

function messageFromFn(data: FnAuthPayload, invokeError: { message?: string } | null): string | null {
  if (data?.ok === true) return null
  if (data?.ok === false) return mapAuthError(data.error || '')
  const transport = mapInvokeTransportError(invokeError?.message)
  if (transport) return transport
  if (invokeError?.message) return mapAuthError(invokeError.message)
  return null
}

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetMessages = () => {
    setError(null)
  }

  useEffect(() => {
    setError(null)
  }, [mode])

  useEffect(() => {
    if (mode !== 'register') return
    setError(null)
  }, [username, password, passwordConfirm, mode])

  const finishAfterSession = async (userId: string) => {
    await mirrorSenhaPlainToUsuarios(userId, password)
    setPassword('')
    setPasswordConfirm('')
    setUsername('')
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    resetMessages()
    const u = normalizeUsername(username)
    if (!u || !password) {
      setError('Preencha usuário e senha.')
      return
    }
    if (!isValidUsernameFormat(u)) {
      setError('Use 2+ caracteres: letras minúsculas, números, ponto, traço ou sublinhado (sem @).')
      return
    }
    setLoading(true)
    try {
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('login-username', {
        body: { username: u, password },
        ...edgeInvokeOptions(),
      })
      const payload = fnData as FnAuthPayload
      const errMsg = messageFromFn(payload, fnErr)
      if (errMsg) {
        setError(errMsg)
        return
      }
      if (!payload?.ok || !payload.access_token || !payload.refresh_token) {
        setError(
          'Não foi possível entrar. Publique login-username no Supabase (supabase functions deploy login-username).',
        )
        return
      }
      const { data: sessData, error: sessErr } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      })
      if (sessErr) {
        setError(mapAuthError(sessErr.message))
        return
      }
      const uid = sessData.session?.user?.id
      if (uid) void mirrorSenhaPlainToUsuarios(uid, password)
    } catch {
      setError('Erro ao entrar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    resetMessages()
    const u = normalizeUsername(username)
    if (!u || !password) {
      setError('Preencha o nome de usuário e a senha.')
      return
    }
    if (!isValidUsernameFormat(u)) {
      setError('Use 2+ caracteres: letras minúsculas, números, ponto, traço ou sublinhado (sem @).')
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
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('register-username', {
        body: { username: u, password },
        ...edgeInvokeOptions(),
      })
      const payload = fnData as FnAuthPayload
      const errMsg = messageFromFn(payload, fnErr)
      if (errMsg) {
        setError(errMsg)
        return
      }
      if (!payload?.ok) {
        setError(
          'Não foi possível cadastrar. Publique register-username no Supabase e rode o SQL alter_usuarios_username.sql.',
        )
        return
      }
      if (payload.access_token && payload.refresh_token) {
        const { data: sessData, error: sessErr } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        })
        if (sessErr) {
          setError(mapAuthError(sessErr.message))
          return
        }
        const uid = sessData.session?.user?.id
        if (uid) await finishAfterSession(uid)
        return
      }
      setError('Conta criada. Use Entrar com o mesmo usuário e senha.')
      setPassword('')
      setPasswordConfirm('')
    } catch {
      setError('Erro ao cadastrar. Tente novamente.')
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
            {mode === 'login' ? 'Entre com usuário e senha' : 'Cadastre usuário e senha (sem e-mail no formulário)'}
          </p>
          {mode === 'register' ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text, #6b7280)', lineHeight: 1.4 }}>
              O acesso é só nome de usuário e senha. O servidor usa um identificador interno.
            </p>
          ) : null}
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
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-h, #f3f4f6)' }}>
              {mode === 'register' ? 'Nome de usuário' : 'Usuário'}
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              disabled={loading}
              onChange={(e) => setUsername(e.target.value)}
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
