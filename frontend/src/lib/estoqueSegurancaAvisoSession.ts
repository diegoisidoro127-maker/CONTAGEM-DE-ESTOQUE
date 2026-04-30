/** Sessão do navegador: aviso automático de alertas (Estoque de Segurança). */
export const SESSION_KEY_AUTO_AVIISO = 'estoque-seguranca.diario-auto-aberto'
/** Sessão do navegador: usuário já reconheceu os alertas (sininho “lido”). */
export const SESSION_KEY_ALERTAS_VISTOS = 'estoque-seguranca.alertas-modal-visto'

export function clearEstoqueSegurancaAvisoSessionKeys() {
  try {
    sessionStorage.removeItem(SESSION_KEY_AUTO_AVIISO)
    sessionStorage.removeItem(SESSION_KEY_ALERTAS_VISTOS)
  } catch {
    /* private mode */
  }
}
