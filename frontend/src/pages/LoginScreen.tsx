import { useState, useEffect, useRef, type FormEvent, type RefObject } from 'react'
import logoUltrapao from '../assets/logo-ultrapao.png'
import { supabase } from '../lib/supabaseClient'
import './LoginScreen.css'

function supabaseProjectRefFromEnv(): string {
  const raw = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  if (!raw) return ''
  try {
    return new URL(raw).hostname.replace(/\.supabase\.co$/i, '')
  } catch {
    return ''
  }
}

type AuthEdgeOk = { ok: true; data: NonNullable<FnAuthPayload> }
type AuthEdgeFail = { ok: false; message: string }
type DirectLoginOk = { ok: true; userId: string | null }
type DirectLoginFail = { ok: false; message: string }

const INTERNAL_EMAIL_DOMAIN = 'internal.local'
const LEGACY_EMAIL_DOMAIN = 'ultrapao.com.br'

/**
 * Chamada direta à Edge Function com Authorization + apikey (recomendado na doc).
 * Distingue 401 do gateway (Verify JWT ligado) de 401 com JSON { ok:false } da própria função (credenciais).
 */
async function invokeAuthUsernameEdge(
  fn: 'login-username' | 'register-username',
  body: Record<string, unknown>,
): Promise<AuthEdgeOk | AuthEdgeFail> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  const ref = supabaseProjectRefFromEnv()
  if (!base || !anon) {
    return { ok: false, message: 'Falta VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no ambiente do site.' }
  }
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`${base}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    window.clearTimeout(timeoutId)
    const text = await res.text()
    let data: FnAuthPayload = null
    if (text) {
      try {
        data = JSON.parse(text) as FnAuthPayload
      } catch {
        data = null
      }
    }
    if (res.ok && data && data.ok === true) {
      return { ok: true, data }
    }
    if (data && data.ok === false && data.error) {
      return { ok: false, message: mapAuthError(data.error) }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message:
          `O Supabase bloqueou «${fn}» (${res.status}). No projeto «${ref || 'seu-ref'}», abra Edge Functions → ${fn} → desligue «Verify JWT» / «Enforce JWT» e faça Deploy. ` +
          'Com isso ligado, o gateway exige JWT de utilizador autenticado; a chave anónima não serve para login/cadastro.',
      }
    }
    const transport = mapInvokeTransportError(text || undefined)
    if (transport) return { ok: false, message: transport }
    return {
      ok: false,
      message: data?.error ? mapAuthError(data.error) : `Erro ${res.status} ao chamar ${fn}. Tente de novo.`,
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, message: `Tempo esgotado ao chamar ${fn}.` }
    }
    return { ok: false, message: mapInvokeTransportError(m) || 'Falha de rede. Tente de novo.' }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

/** Normaliza o login: minúsculas, espaços viram ponto (ex.: «diego isidoro» → «diego.isidoro»). */
function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function isValidUsernameFormat(u: string): boolean {
  if (u.length < 2 || u.includes('@')) return false
  return /^[a-z0-9._-]+$/.test(u)
}

function loginEmailCandidates(username: string): string[] {
  const u = normalizeUsername(username)
  const prefix = u.includes('.') ? u.split('.')[0].trim() : ''
  const raw = [
    `${u}@${INTERNAL_EMAIL_DOMAIN}`,
    `${u}@${LEGACY_EMAIL_DOMAIN}`,
    prefix ? `${prefix}@${INTERNAL_EMAIL_DOMAIN}` : '',
    prefix ? `${prefix}@${LEGACY_EMAIL_DOMAIN}` : '',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const em of raw) {
    const v = em.trim().toLowerCase()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

async function tryDirectAuthLogin(username: string, password: string): Promise<DirectLoginOk | DirectLoginFail> {
  const candidates = loginEmailCandidates(username)
  let lastError: string | null = null
  for (const email of candidates) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data.session) {
      return { ok: true, userId: data.session.user?.id ?? null }
    }
    const msg = error?.message ? mapAuthError(error.message) : ''
    if (msg && msg !== 'Usuário ou senha incorretos.') {
      lastError = msg
    }
  }
  return { ok: false, message: lastError ?? 'Usuário ou senha incorretos.' }
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
  inputRef?: RefObject<HTMLInputElement | null>
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
  inputRef,
}: PasswordFieldProps) {
  return (
    <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1f2937' }}>
        {label}
      </span>
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          id={id}
          ref={inputRef}
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
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#111827',
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
            color: '#64748b',
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
    m.includes('err_failed') ||
    m.includes('cors')
  ) {
    return (
      'O pedido ao Supabase foi bloqueado (muitas vezes o navegador mostra “CORS”, mas a causa é o gateway a exigir JWT no OPTIONS). ' +
      'No painel Supabase: Edge Functions → register-username e login-username → definições → desligue “Verify JWT” / “Enforce JWT”. ' +
      'Ou faça deploy pela CLI na pasta do projeto: supabase functions deploy register-username e login-username (já vão com verify_jwt = false em config.toml).'
    )
  }
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
  const [success, setSuccess] = useState<string | null>(null)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)

  const resetMessages = () => {
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    setError(null)
  }, [mode])

  useEffect(() => {
    if (mode !== 'register') return
    setError(null)
  }, [username, password, passwordConfirm, mode])

  useEffect(() => {
    if (mode !== 'login' || !success) return
    const t = window.setTimeout(() => {
      passwordInputRef.current?.focus()
    }, 100)
    return () => window.clearTimeout(t)
  }, [mode, success])

  useEffect(() => {
    document.body.classList.add('login-screen-active')
    return () => document.body.classList.remove('login-screen-active')
  }, [])

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
      // Fluxo de login simplificado: somente Auth direto (sem Edge Function no caminho crítico).
      const direct = await tryDirectAuthLogin(u, password)
      if (!direct.ok) {
        setError(direct.message)
        return
      }
      if (direct.userId) void mirrorSenhaPlainToUsuarios(direct.userId, password)
    } catch {
      const fallback = await tryDirectAuthLogin(u, password)
      if (fallback.ok) {
        if (fallback.userId) void mirrorSenhaPlainToUsuarios(fallback.userId, password)
        return
      }
      setError(fallback.message || 'Erro ao entrar. Tente novamente.')
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
      const result = await invokeAuthUsernameEdge('register-username', { username: u, password })
      if (!result.ok) {
        setError(result.message)
        return
      }
      const payload = result.data
      if (!payload?.ok) {
        setError(
          'Não foi possível cadastrar. Publique register-username no Supabase e rode o SQL alter_usuarios_username.sql.',
        )
        return
      }
      setMode('login')
      setPassword('')
      setPasswordConfirm('')
      setError(null)
      setSuccess('Conta criada com sucesso. Agora faça login com o mesmo usuário e senha.')
    } catch {
      setError('Erro ao cadastrar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const showInfoText = mode === 'login' ? success : null

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
        background: 'transparent',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '28px 24px 32px',
          borderRadius: 16,
          border: '1px solid #d1d5db',
          background: '#ffffff',
          boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img className="login-screen-logo" src={logoUltrapao} alt="Ultra Pão Alimentos" />
          <h1 style={{ margin: 0, fontSize: 'clamp(20px, 4vw, 24px)', color: '#92400e', fontWeight: 700 }}>
            Painel de Contagem de Estoque
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: '#4b5563', lineHeight: 1.45 }}>
            {mode === 'login' ? 'Entre com usuário e senha' : 'Cadastre usuário e senha (sem e-mail no formulário)'}
          </p>
          {mode === 'register' ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
              O acesso é só nome de usuário e senha. O servidor usa um identificador interno.
            </p>
          ) : null}
        </div>

        {showInfoText ? (
          <div
            role="status"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: '#dcfce7',
              border: '1px solid #16a34a',
              color: '#14532d',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {showInfoText}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: '#fee2e2',
              border: '1px solid #dc2626',
              color: '#991b1b',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        ) : null}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1f2937' }}>
              {mode === 'register' ? 'Nome de usuário' : 'Usuário'}
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              disabled={loading}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={mode === 'register' ? 'ex.: diego.isidoro' : 'ex.: diego ou nome completo cadastrado'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 12px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#111827',
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
            inputRef={passwordInputRef}
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
                color: '#64748b',
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
