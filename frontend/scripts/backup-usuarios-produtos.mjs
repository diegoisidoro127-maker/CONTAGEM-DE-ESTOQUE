/**
 * Backup local (JSON + CSV) das tabelas críticas:
 *   - public.usuarios
 *   - public."Todos os Produtos"
 * e, por padrão, lista resumida de auth.users (útil para recriar contas).
 *
 * Saída: frontend/backups/ (não versionar no Git — pasta em .gitignore)
 *
 * Pré-requisito: chave service_role (Dashboard → Settings → API), não use anon.
 *
 * PowerShell (na pasta frontend):
 *   $env:SUPABASE_URL="https://SEU-REF.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   npm run backup:usuarios-produtos
 *
 * Opcional: BACKUP_SKIP_AUTH=1 para não listar auth (só usuarios + produtos).
 *
 * Molde do schema (DDL): copie/versione a pasta do repo ../supabase/sql/ separadamente.
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
        const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (k && process.env[k] === undefined) process.env[k] = v
      }
    } catch {
      /* ignore */
    }
  }
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(rows) {
  if (!rows.length) return ''
  const cols = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row || {}).forEach((k) => acc.add(k))
      return acc
    }, new Set()),
  )
  const header = cols.join(',')
  const lines = rows.map((row) => cols.map((c) => csvEscape(row?.[c])).join(','))
  return [header, ...lines].join('\n')
}

async function fetchAllRows(admin, table, pageSize = 1000) {
  const out = []
  for (let from = 0; from < 200000; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await admin.from(table).select('*').range(from, to)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

async function fetchAllAuthUsers(admin, pageSize = 200) {
  const out = []
  for (let page = 1; page < 500; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize })
    if (error) throw new Error(`auth.users: ${error.message}`)
    const users = data?.users ?? []
    if (!users.length) break
    for (const u of users) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        user_metadata: u.user_metadata ?? null,
      })
    }
    if (users.length < pageSize) break
  }
  return out
}

async function main() {
  loadDotEnv()
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !serviceKey) {
    console.error('Defina SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY antes de rodar.')
    process.exit(1)
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const outDir = path.join(process.cwd(), 'backups')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  const usuarios = await fetchAllRows(admin, 'usuarios')
  const produtos = await fetchAllRows(admin, 'Todos os Produtos')
  const skipAuth = ['1', 'true', 'yes'].includes(
    String(process.env.BACKUP_SKIP_AUTH || '').toLowerCase(),
  )
  const authUsers = skipAuth ? [] : await fetchAllAuthUsers(admin)

  const files = [
    { name: `usuarios-${stamp}.json`, content: JSON.stringify(usuarios, null, 2) },
    { name: `usuarios-${stamp}.csv`, content: toCsv(usuarios) },
    { name: `todos-os-produtos-${stamp}.json`, content: JSON.stringify(produtos, null, 2) },
    { name: `todos-os-produtos-${stamp}.csv`, content: toCsv(produtos) },
  ]
  if (!skipAuth) {
    files.push(
      { name: `auth-users-${stamp}.json`, content: JSON.stringify(authUsers, null, 2) },
      { name: `auth-users-${stamp}.csv`, content: toCsv(authUsers) },
    )
  }
  for (const f of files) {
    fs.writeFileSync(path.join(outDir, f.name), f.content, 'utf8')
  }

  console.log(`Backup concluído em ${outDir}`)
  console.log(
    `usuarios: ${usuarios.length} | Todos os Produtos: ${produtos.length}` +
      (skipAuth ? ' | auth: ignorado (BACKUP_SKIP_AUTH)' : ` | auth.users: ${authUsers.length}`),
  )
  console.log('Lembre: o DDL do banco está em supabase/sql/ no repositório — mantenha o Git atualizado.')
}

main().catch((e) => {
  console.error(e?.message || e)
  process.exit(1)
})

