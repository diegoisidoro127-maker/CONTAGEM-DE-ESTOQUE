import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    // Permite que o Vite Preview aceite o domínio do Render
    // (evita erro: host ... not allowed).
    allowedHosts: 'all',
  },
})
