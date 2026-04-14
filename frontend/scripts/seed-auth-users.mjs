/**
 * Cria usuários no Supabase Auth (e espelha senha em public.usuarios, como no app).
 *
 * Credenciais criadas/atualizadas:
 *   diego     / diego123     → diego@ultrapao.com.br
 *   leticia   / leticia123   → leticia@ultrapao.com.br
 *
 * Uso (na pasta frontend), com service role do painel Supabase (Settings → API):
 *   PowerShell:
 *     $env:SUPABASE_URL="https://xxxx.supabase.co"
 *     $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbG..."
 *     node scripts/seed-auth-users.mjs
 *
 * Ou coloque SUPABASE_SERVICE_ROLE_KEY e VITE_SUPABASE_URL em frontend/.env (não commite a service role).
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function loadDotEnv() {
  const tryPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '..', '.env'),
  ]
  for (const p of tryPaths) {
    try {
      const raw = fs.readFileSync(p, 'utf8')
      for (const line of raw.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq <= 0) continue
        const k = t.slice(0, eq).trim()
        let v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (k && process.env[k] === undefined) process.env[k] = v
      }
    } catch {
      /* ignore */
    }
  }
}

async function findUserIdByEmail(admin, email) {
  const target = email.toLowerCase()
  let page = 1
  const perPage = 200
  for (let i = 0; i < 100; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const found = data.users.find((u) => (u.email || '').toLowerCase() === target)
    if (found) return found.id
    if (data.users.length < perPage) break
    page++
  }
  return null
}

const USERS = [
  { login: 'diego', email: 'diego@ultrapao.com.br', password: 'diego123' },
  { login: 'leticia', email: 'leticia@ultrapao.com.br', password: 'leticia123' },
]

async function main() {
  loadDotEnv()
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !serviceKey) {
    console.error(
      'Defina SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (Project Settings → API no Supabase).',
    )
    process.exit(1)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const u of USERS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { nome: u.login },
    })

    let userId = data?.user?.id

    if (error) {
      const msg = (error.message || '').toLowerCase()
      const dup = msg.includes('already') || msg.includes('registered') || msg.includes('exists')
      if (!dup) {
        console.error(`${u.login}:`, error.message)
        continue
      }
      const id = await findUserIdByEmail(admin, u.email)
      if (!id) {
        console.error(`${u.login}: conta já existe mas não foi possível localizar o ID.`)
        continue
      }
      const { error: upErr } = await admin.auth.admin.updateUserById(id, {
        password: u.password,
        email_confirm: true,
        user_metadata: { nome: u.login },
      })
      if (upErr) {
        console.error(`${u.login} (atualizar):`, upErr.message)
        continue
      }
      userId = id
      console.log(`${u.login}: senha e perfil atualizados (já existia).`)
    } else {
      console.log(`${u.login}: criado no Auth.`)
    }

    if (userId) {
      const { error: dbErr } = await admin.from('usuarios').update({ senha: u.password, nome: u.login }).eq('id', userId)
      if (dbErr) {
        console.warn(`${u.login}: usuarios —`, dbErr.message, '(trigger pode ainda não ter criado a linha; rode o SQL create_usuarios.sql)')
      } else {
        console.log(`${u.login}: espelho em public.usuarios OK.`)
      }
    }
  }

  console.log('\nNo app, use só o nome de usuário (diego / leticia) e a senha — o domínio @ultrapao.com.br é só interno ao Auth.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
