import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Garante que dev/proxy também não bloqueie o host
    allowedHosts: true,
  },
  preview: {
    // Permite que o Vite Preview aceite o domínio do Render
    // (evita erro: host ... not allowed).
    // (nota: isso é necessário porque o Render usa um Host diferente do localhost)
    allowedHosts: true,
  },
})
