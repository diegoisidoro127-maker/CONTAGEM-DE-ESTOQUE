import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const missingEnvError = new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Render/ENV do Vite.')

// Importante: não podemos "throw" durante o build (Render pode não injetar env no build da mesma forma).
// Em vez disso, retornamos um "client dummy" que só falha quando alguém tentar usar.
export const supabase: any = (() => {
  if (!url || !anonKey) {
    return {
      from: () => {
        throw missingEnvError
      },
    }
  }

  return createClient(url, anonKey)
})()

